use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::proxy::is_url_allowed;

/// Shared reqwest client for SSE connections — NO timeout.
/// Streaming responses can last indefinitely (long reasoning chains, etc.).
static SSE_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .build()
        .expect("failed to create SSE HTTP client")
});
const MAX_ACTIVE_SSE_CONNECTIONS: usize = 8;
const MAX_SSE_ID_CHARS: usize = 128;
const MAX_SSE_HEADERS: usize = 80;
const MAX_SSE_HEADER_CHARS: usize = 8 * 1024;
const MAX_SSE_BODY_BYTES: usize = 4 * 1024 * 1024;
const MAX_SSE_EVENT_CHUNK_BYTES: usize = 256 * 1024;

// ─── Event Payload ───────────────────────────────────────────────────────────

#[derive(Clone, Serialize)]
#[serde(tag = "type")]
pub enum SsePayload {
    /// Connection established — carries HTTP status code and response headers.
    Connected {
        status: u16,
        headers: HashMap<String, String>,
    },
    /// A chunk of bytes from the response body.
    Chunk { bytes: Vec<u8> },
    /// Stream completed normally.
    Done,
    /// An error occurred.
    Error { message: String },
}

// ─── Connection State ────────────────────────────────────────────────────────

pub struct SseState {
    /// Active connections: id → JoinHandle (for abort on disconnect).
    /// Uses std::sync::Mutex because the lock is never held across .await.
    connections: Arc<Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>>,
}

impl Default for SseState {
    fn default() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

fn validate_sse_id(id: &str) -> Result<(), String> {
    if id.is_empty() {
        return Err("SSE connection id is required".to_string());
    }
    if id.len() > MAX_SSE_ID_CHARS {
        return Err(format!(
            "SSE connection id exceeds {} characters",
            MAX_SSE_ID_CHARS
        ));
    }
    if !id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("SSE connection id contains invalid characters".to_string());
    }
    Ok(())
}

fn validate_sse_request(
    id: &str,
    method: &str,
    headers: &HashMap<String, String>,
    body: Option<&str>,
) -> Result<reqwest::Method, String> {
    validate_sse_id(id)?;
    let http_method: reqwest::Method = method
        .parse()
        .map_err(|_| format!("invalid SSE HTTP method: {method}"))?;
    if headers.len() > MAX_SSE_HEADERS {
        return Err(format!("too many SSE headers (max {MAX_SSE_HEADERS})"));
    }
    for (key, value) in headers {
        if key.len() > MAX_SSE_HEADER_CHARS || value.len() > MAX_SSE_HEADER_CHARS {
            return Err(format!(
                "SSE header names and values must be <= {} bytes",
                MAX_SSE_HEADER_CHARS
            ));
        }
    }
    if body.map(|text| text.len()).unwrap_or(0) > MAX_SSE_BODY_BYTES {
        return Err(format!(
            "SSE request body exceeds {} bytes",
            MAX_SSE_BODY_BYTES
        ));
    }
    Ok(http_method)
}

fn emit_chunked(app: &AppHandle, event_name: &str, bytes: &[u8]) {
    for chunk in bytes.chunks(MAX_SSE_EVENT_CHUNK_BYTES) {
        let _ = app.emit(
            event_name,
            SsePayload::Chunk {
                bytes: chunk.to_vec(),
            },
        );
    }
}

// ─── Commands ────────────────────────────────────────────────────────────────

/// Start an SSE streaming connection.
///
/// The command returns immediately. Actual data is delivered via Tauri events
/// on the channel `sse://{id}`.
#[tauri::command]
pub async fn sse_connect(
    app: AppHandle,
    state: tauri::State<'_, SseState>,
    id: String,
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<(), String> {
    let http_method = validate_sse_request(&id, &method, &headers, body.as_deref())?;
    is_url_allowed(&url)?;
    let event_name = format!("sse://{id}");
    let connections = state.connections.clone();
    let id_for_cleanup = id.clone();

    {
        let mut active = connections
            .lock()
            .map_err(|_| "SSE connection lock poisoned".to_string())?;
        if active.len() >= MAX_ACTIVE_SSE_CONNECTIONS && !active.contains_key(&id) {
            return Err(format!(
                "too many active SSE connections (max {MAX_ACTIVE_SSE_CONNECTIONS})"
            ));
        }
        if let Some(existing) = active.remove(&id) {
            existing.abort();
        }
    }

    let cleanup_connections = connections.clone();
    let task = tauri::async_runtime::spawn(async move {
        let mut builder = SSE_CLIENT.request(http_method, &url);

        for (k, v) in &headers {
            builder = builder.header(k.as_str(), v.as_str());
        }

        if let Some(b) = body {
            builder = builder.body(b);
        }

        // Send the request
        match builder.send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();

                // Collect response headers
                let mut resp_headers = HashMap::new();
                for (key, value) in resp.headers().iter() {
                    if let Ok(v) = value.to_str() {
                        resp_headers.insert(key.as_str().to_string(), v.to_string());
                    }
                }

                // Emit Connected event
                let _ = app.emit(
                    &event_name,
                    SsePayload::Connected {
                        status,
                        headers: resp_headers,
                    },
                );

                // Stream body chunks
                let mut stream = resp.bytes_stream();
                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(bytes) => {
                            emit_chunked(&app, &event_name, &bytes);
                        }
                        Err(e) => {
                            let _ = app.emit(
                                &event_name,
                                SsePayload::Error {
                                    message: e.to_string(),
                                },
                            );
                            break;
                        }
                    }
                }

                // Stream complete
                let _ = app.emit(&event_name, SsePayload::Done);
            }
            Err(e) => {
                let _ = app.emit(
                    &event_name,
                    SsePayload::Error {
                        message: e.to_string(),
                    },
                );
            }
        }
        if let Ok(mut active) = cleanup_connections.lock() {
            active.remove(&id_for_cleanup);
        }
    });

    // Store the JoinHandle for cancellation via sse_disconnect
    state
        .connections
        .lock()
        .map_err(|_| "SSE connection lock poisoned".to_string())?
        .insert(id, task);

    Ok(())
}

/// Cancel an active SSE connection.
#[tauri::command]
pub async fn sse_disconnect(state: tauri::State<'_, SseState>, id: String) -> Result<(), String> {
    validate_sse_id(&id)?;
    if let Some(handle) = state
        .connections
        .lock()
        .map_err(|_| "SSE connection lock poisoned".to_string())?
        .remove(&id)
    {
        handle.abort();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_sse_connection_id() {
        assert!(validate_sse_id("a-valid_id-123").is_ok());
        assert!(validate_sse_id("").is_err());
        assert!(validate_sse_id("bad/id").is_err());
        assert!(validate_sse_id(&"x".repeat(MAX_SSE_ID_CHARS + 1)).is_err());
    }

    #[test]
    fn validates_sse_request_budget() {
        let mut headers = HashMap::new();
        headers.insert("authorization".to_string(), "Bearer token".to_string());

        assert!(validate_sse_request("id-1", "POST", &headers, Some("{}")).is_ok());
        assert!(validate_sse_request("id-1", "BAD METHOD", &headers, None).is_err());

        let too_many_headers = (0..=MAX_SSE_HEADERS)
            .map(|i| (format!("x-{i}"), "v".to_string()))
            .collect::<HashMap<_, _>>();
        assert!(validate_sse_request("id-1", "POST", &too_many_headers, None).is_err());

        let huge_body = "x".repeat(MAX_SSE_BODY_BYTES + 1);
        assert!(validate_sse_request("id-1", "POST", &headers, Some(&huge_body)).is_err());
    }
}
