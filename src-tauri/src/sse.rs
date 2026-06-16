use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};

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
    connections: Mutex<HashMap<String, tauri::async_runtime::JoinHandle<()>>>,
}

impl Default for SseState {
    fn default() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
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
    is_url_allowed(&url)?;
    let event_name = format!("sse://{id}");

    let task = tauri::async_runtime::spawn(async move {
        // Build the request
        let http_method: reqwest::Method = method
            .parse()
            .unwrap_or(reqwest::Method::POST);

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
                let _ = app.emit(&event_name, SsePayload::Connected {
                    status,
                    headers: resp_headers,
                });

                // Stream body chunks
                let mut stream = resp.bytes_stream();
                while let Some(chunk_result) = stream.next().await {
                    match chunk_result {
                        Ok(bytes) => {
                            let _ = app.emit(&event_name, SsePayload::Chunk {
                                bytes: bytes.to_vec(),
                            });
                        }
                        Err(e) => {
                            let _ = app.emit(&event_name, SsePayload::Error {
                                message: e.to_string(),
                            });
                            break;
                        }
                    }
                }

                // Stream complete
                let _ = app.emit(&event_name, SsePayload::Done);
            }
            Err(e) => {
                let _ = app.emit(&event_name, SsePayload::Error {
                    message: e.to_string(),
                });
            }
        }
    });

    // Store the JoinHandle for cancellation via sse_disconnect
    state.connections.lock().unwrap().insert(id, task);

    Ok(())
}

/// Cancel an active SSE connection.
#[tauri::command]
pub async fn sse_disconnect(
    state: tauri::State<'_, SseState>,
    id: String,
) -> Result<(), String> {
    if let Some(handle) = state.connections.lock().unwrap().remove(&id) {
        handle.abort();
    }
    Ok(())
}
