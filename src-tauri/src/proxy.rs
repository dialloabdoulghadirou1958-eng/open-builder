use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use serde::Serialize;
use tauri::http::{Request as TauriRequest, Response as TauriResponse};

/// Shared reqwest client with 5-minute timeout (for long LLM responses).
static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .expect("failed to create HTTP client")
});
static PROXY_ALLOWED_HOSTS: LazyLock<Mutex<Vec<String>>> = LazyLock::new(|| Mutex::new(Vec::new()));
const MAX_PROXY_RESPONSE_BYTES: usize = 25 * 1024 * 1024;

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
        Err(format!(
            "host \"{host}\" is not allowed by the proxy policy"
        ))
    }
}

fn infer_scheme_from_host(host: &str) -> &'static str {
    let hostname = host.trim_matches(&['[', ']'][..]).to_lowercase();
    if hostname == "localhost" {
        return "http";
    }
    if hostname.parse::<std::net::IpAddr>().is_ok() {
        return "http";
    }
    "https"
}

fn format_authority(host: &str, port: Option<u16>) -> String {
    let host_part = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    match port {
        Some(port) => format!("{host_part}:{port}"),
        None => host_part,
    }
}

/// Parse the proxy URL to extract the real target URL.
///
/// Input:  `proxy://api.openai.com/v1/chat/completions?stream=true`
/// Output: `https://api.openai.com/v1/chat/completions?stream=true`
///
/// Input:  `proxy://localhost:11434/v1/chat/completions`
/// Output: `http://localhost:11434/v1/chat/completions`
fn parse_proxy_url(uri: &str) -> Result<String, String> {
    let parsed = reqwest::Url::parse(uri).map_err(|err| format!("invalid proxy URI: {err}"))?;
    if parsed.scheme() != "proxy" {
        return Err("proxy URI must use proxy://".to_string());
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| "proxy target URL has no host".to_string())?;
    let scheme = infer_scheme_from_host(host);
    let authority = format_authority(host, parsed.port());
    let path = parsed.path();
    let query = match parsed.query() {
        Some(query) => format!("?{query}"),
        None => String::new(),
    };
    Ok(format!("{scheme}://{authority}{path}{query}"))
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
    #[derive(Serialize)]
    struct ProxyError<'a> {
        error: &'a str,
        detail: &'a str,
    }

    let body = serde_json::to_vec(&ProxyError { error, detail }).unwrap_or_else(|_| {
        br#"{"error":"Proxy error","detail":"failed to serialize error"}"#.to_vec()
    });
    let mut headers = HashMap::new();
    headers.insert("content-type".to_string(), "application/json".to_string());
    build_cors_response(status, body, headers)
}

async fn collect_limited_response_body(resp: reqwest::Response) -> Result<Vec<u8>, String> {
    if let Some(length) = resp.content_length() {
        if length > MAX_PROXY_RESPONSE_BYTES as u64 {
            return Err(format!(
                "response body exceeds {} bytes",
                MAX_PROXY_RESPONSE_BYTES
            ));
        }
    }

    let mut body = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|err| format!("failed to read proxy response: {err}"))?;
        if body.len().saturating_add(chunk.len()) > MAX_PROXY_RESPONSE_BYTES {
            return Err(format!(
                "response body exceeds {} bytes",
                MAX_PROXY_RESPONSE_BYTES
            ));
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
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

            match collect_limited_response_body(resp).await {
                Ok(body_bytes) => build_cors_response(status, body_bytes, headers),
                Err(e) => error_response(502, "Proxy response too large", &e),
            }
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
pub fn register_proxy_protocol(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.register_asynchronous_uri_scheme_protocol("proxy", |_app, request, responder| {
        tauri::async_runtime::spawn(async move {
            let response = handle_proxy(request).await;
            responder.respond(response);
        });
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_proxy_url_preserves_host_port_path_and_query() {
        assert_eq!(
            parse_proxy_url("proxy://api.openai.com/v1/chat?stream=true").unwrap(),
            "https://api.openai.com/v1/chat?stream=true"
        );
        assert_eq!(
            parse_proxy_url("proxy://localhost:11434/v1/chat").unwrap(),
            "http://localhost:11434/v1/chat"
        );
        assert_eq!(
            parse_proxy_url("proxy://[::1]:11434/v1/chat").unwrap(),
            "http://[::1]:11434/v1/chat"
        );
    }

    #[test]
    fn error_response_escapes_json_detail() {
        let response = error_response(400, "Invalid proxy URL", "bad \"url\"\nnext");
        let value: serde_json::Value =
            serde_json::from_slice(response.body()).expect("valid JSON error body");

        assert_eq!(value["error"], "Invalid proxy URL");
        assert_eq!(value["detail"], "bad \"url\"\nnext");
    }
}
