use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use tauri::http::{Request as TauriRequest, Response as TauriResponse};

/// Shared reqwest client with 5-minute timeout (for long LLM responses).
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .expect("failed to create HTTP client")
});
static PROXY_ALLOWED_HOSTS: LazyLock<Mutex<Vec<String>>> =
    LazyLock::new(|| Mutex::new(Vec::new()));

#[derive(serde::Deserialize)]
pub struct ProxyPolicy {
    allowed_hosts: Vec<String>,
}

#[tauri::command]
pub fn set_proxy_policy(policy: ProxyPolicy) -> Result<(), String> {
    let hosts = policy
        .allowed_hosts
        .into_iter()
        .map(|host| host.trim().to_lowercase())
        .filter(|host| !host.is_empty())
        .collect::<Vec<_>>();
    *PROXY_ALLOWED_HOSTS
        .lock()
        .map_err(|_| "proxy policy lock poisoned".to_string())? = hosts;
    Ok(())
}

fn is_loopback_host(host: &str) -> bool {
    if host == "localhost" {
        return true;
    }
    host.parse::<std::net::IpAddr>()
        .map(|ip| ip.is_loopback())
        .unwrap_or(false)
}

fn is_host_allowed(host: &str, allowed_hosts: &[String]) -> bool {
    let host = host.trim_matches(&['[', ']'][..]).to_lowercase();
    if allowed_hosts.is_empty() {
        return is_loopback_host(&host);
    }
    allowed_hosts.iter().any(|allowed| {
        if allowed == &host {
            return true;
        }
        if let Some(suffix) = allowed.strip_prefix("*.") {
            return host.ends_with(&format!(".{suffix}")) && host.len() > suffix.len() + 1;
        }
        false
    })
}

pub fn is_url_allowed(target_url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(target_url)
        .map_err(|err| format!("invalid proxy target URL: {err}"))?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "proxy target URL has no host".to_string())?;
    let allowed_hosts = PROXY_ALLOWED_HOSTS
        .lock()
        .map_err(|_| "proxy policy lock poisoned".to_string())?;
    if is_host_allowed(host, &allowed_hosts) {
        Ok(())
    } else {
        Err(format!("host \"{host}\" is not allowed by the proxy policy"))
    }
}

/// Determine the target scheme based on the host.
/// - `localhost`, `127.0.0.1`, `[::1]`, or any pure IP address → HTTP
/// - Domain names → HTTPS
fn infer_scheme(host: &str) -> &'static str {
    // Strip port if present: "localhost:11434" → "localhost"
    let hostname = host.split(':').next().unwrap_or(host);

    if hostname == "localhost" {
        return "http";
    }

    // Check if hostname is an IP address (v4 or v6)
    if hostname.parse::<std::net::IpAddr>().is_ok() {
        return "http";
    }
    // Also handle bracket-wrapped IPv6 like [::1]
    if hostname.starts_with('[') && hostname.ends_with(']') {
        return "http";
    }

    "https"
}

/// Parse the proxy URL to extract the real target URL.
///
/// Input:  `proxy://api.openai.com/v1/chat/completions?stream=true`
/// Output: `https://api.openai.com/v1/chat/completions?stream=true`
///
/// Input:  `proxy://localhost:11434/v1/chat/completions`
/// Output: `http://localhost:11434/v1/chat/completions`
fn parse_proxy_url(uri: &str) -> Result<String, String> {
    let after_scheme = uri
        .strip_prefix("proxy://")
        .ok_or_else(|| format!("Invalid proxy URI: {uri}"))?;

    if after_scheme.is_empty() {
        return Err("Empty proxy target".to_string());
    }

    // Split into host (with optional port) and path+query
    // "api.openai.com/v1/chat/completions?stream=true"
    //  → host_with_port = "api.openai.com"
    //  → path_and_query = "/v1/chat/completions?stream=true"
    let (host_with_port, path_and_query) = match after_scheme.find('/') {
        Some(idx) => (&after_scheme[..idx], &after_scheme[idx..]),
        None => (after_scheme, ""),
    };

    let scheme = infer_scheme(host_with_port);
    Ok(format!("{scheme}://{host_with_port}{path_and_query}"))
}

/// Build an HTTP response with CORS headers injected.
fn build_cors_response(
    status: u16,
    body: Vec<u8>,
    extra_headers: HashMap<String, String>,
) -> TauriResponse<Vec<u8>> {
    let mut builder = TauriResponse::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Allow-Methods",
            "GET, POST, PUT, DELETE, PATCH, OPTIONS, HEAD",
        )
        .header("Access-Control-Allow-Headers", "*")
        .header("Access-Control-Expose-Headers", "*")
        .header("Access-Control-Max-Age", "86400");

    for (k, v) in &extra_headers {
        builder = builder.header(k.as_str(), v.as_str());
    }

    builder.body(body).unwrap()
}

/// Build a JSON error response with CORS headers.
fn error_response(status: u16, error: &str, detail: &str) -> TauriResponse<Vec<u8>> {
    let body = format!(r#"{{"error":"{error}","detail":"{detail}"}}"#).into_bytes();
    let mut headers = HashMap::new();
    headers.insert("content-type".to_string(), "application/json".to_string());
    build_cors_response(status, body, headers)
}

/// Handle a single proxy request.
async fn handle_proxy(request: TauriRequest<Vec<u8>>) -> TauriResponse<Vec<u8>> {
    // 1. Parse the target URL
    let uri = request.uri().to_string();
    let target_url = match parse_proxy_url(&uri) {
        Ok(url) => url,
        Err(e) => return error_response(400, "Invalid proxy URL", &e),
    };
    if let Err(e) = is_url_allowed(&target_url) {
        return error_response(403, "Proxy target blocked", &e);
    }

    // 2. Handle CORS preflight
    if request.method() == "OPTIONS" {
        return build_cors_response(204, Vec::new(), HashMap::new());
    }

    // 3. Build the reqwest request
    let method: reqwest::Method = request
        .method()
        .as_str()
        .parse()
        .unwrap_or(reqwest::Method::GET);

    let mut builder = HTTP_CLIENT.request(method, &target_url);

    // Forward request headers, filtering out browser-internal ones
    for (key, value) in request.headers() {
        let k = key.as_str().to_lowercase();
        if k == "host" || k == "origin" {
            continue;
        }
        if let Ok(v) = value.to_str() {
            builder = builder.header(key.as_str(), v);
        }
    }

    // Forward request body
    let body = request.body().clone();
    if !body.is_empty() {
        builder = builder.body(body);
    }

    // 4. Send the request and build the response
    match builder.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();

            // Collect response headers (skip original CORS headers, we inject our own)
            let mut headers = HashMap::new();
            for (key, value) in resp.headers().iter() {
                let k = key.as_str().to_lowercase();
                if !k.starts_with("access-control-") {
                    if let Ok(v) = value.to_str() {
                        headers.insert(k, v.to_string());
                    }
                }
            }

            let body_bytes = resp.bytes().await.unwrap_or_default().to_vec();
            build_cors_response(status, body_bytes, headers)
        }
        Err(e) => {
            if e.is_timeout() {
                error_response(504, "Proxy request timed out", &e.to_string())
            } else {
                error_response(502, "Proxy connection failed", &e.to_string())
            }
        }
    }
}

/// Register the `proxy://` custom protocol on the Tauri builder.
pub fn register_proxy_protocol(
    builder: tauri::Builder<tauri::Wry>,
) -> tauri::Builder<tauri::Wry> {
    builder.register_asynchronous_uri_scheme_protocol("proxy", |_app, request, responder| {
        tauri::async_runtime::spawn(async move {
            let response = handle_proxy(request).await;
            responder.respond(response);
        });
    })
}
