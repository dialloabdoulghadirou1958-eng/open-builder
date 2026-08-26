#[cfg(desktop)]
mod mcp_oauth;
#[cfg(desktop)]
mod mcp_remote;
#[cfg(desktop)]
mod mcp_stdio;
mod proxy;
#[cfg(desktop)]
mod skills;
mod sse;

use serde::Serialize;
#[cfg(desktop)]
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct McpPlatformCapabilities {
    remote_streaming: bool,
    stdio: bool,
    oauth_loopback: bool,
    skill_scripts: bool,
}

#[tauri::command]
fn mcp_platform_capabilities() -> McpPlatformCapabilities {
    McpPlatformCapabilities {
        remote_streaming: cfg!(desktop),
        stdio: cfg!(desktop),
        oauth_loopback: cfg!(desktop),
        skill_scripts: cfg!(desktop),
    }
}

#[cfg(desktop)]
fn cleanup_mcp_state(app: &tauri::AppHandle) {
    app.state::<skills::SkillScriptState>().shutdown_now();
    app.state::<mcp_remote::McpRemoteState>().shutdown_now();
    app.state::<mcp_oauth::McpOAuthState>().shutdown_now();
    let stdio = app.state::<mcp_stdio::McpStdioState>();
    tauri::async_runtime::block_on(stdio.shutdown_gracefully());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(sse::SseState::default());

    #[cfg(desktop)]
    let builder = builder
        .manage(mcp_stdio::McpStdioState::default())
        .manage(mcp_remote::McpRemoteState::default())
        .manage(mcp_oauth::McpOAuthState::default())
        .manage(skills::SkillScriptState::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            mcp_platform_capabilities,
            proxy::set_proxy_policy,
            skills::run_skill_script,
            skills::cancel_skill_script,
            skills::cancel_all_skill_scripts,
            sse::sse_connect,
            sse::sse_ack,
            sse::sse_disconnect,
            sse::sse_disconnect_all,
            mcp_stdio::mcp_stdio_connect,
            mcp_stdio::mcp_stdio_connection_epoch,
            mcp_stdio::mcp_stdio_list_tools,
            mcp_stdio::mcp_stdio_call_tool,
            mcp_stdio::mcp_stdio_cancel,
            mcp_stdio::mcp_stdio_disconnect,
            mcp_stdio::mcp_stdio_disconnect_all,
            mcp_remote::mcp_remote_set_policy,
            mcp_remote::mcp_remote_policy_epoch,
            mcp_remote::mcp_remote_clear_policies,
            mcp_remote::mcp_remote_connect,
            mcp_remote::mcp_remote_ack,
            mcp_remote::mcp_remote_disconnect,
            mcp_oauth::mcp_oauth_start_loopback,
            mcp_oauth::mcp_oauth_cancel_loopback,
        ]);

    #[cfg(mobile)]
    let builder = builder.invoke_handler(tauri::generate_handler![
        greet,
        mcp_platform_capabilities,
        proxy::set_proxy_policy,
        sse::sse_connect,
        sse::sse_ack,
        sse::sse_disconnect,
        sse::sse_disconnect_all,
    ]);

    let builder = proxy::register_proxy_protocol(builder);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|_app, _event| {
        #[cfg(desktop)]
        if matches!(
            _event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            cleanup_mcp_state(_app);
        }
    });
}
