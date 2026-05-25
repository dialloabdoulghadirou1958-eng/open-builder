mod proxy;
mod sse;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(sse::SseState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            sse::sse_connect,
            sse::sse_disconnect,
        ]);

    let builder = proxy::register_proxy_protocol(builder);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
