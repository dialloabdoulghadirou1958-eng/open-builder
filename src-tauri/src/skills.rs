use serde::{Deserialize, Serialize};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const MAX_SCRIPT_BYTES: usize = 256 * 1024;
const MAX_ARG_COUNT: usize = 32;
const MAX_ARG_BYTES: usize = 8 * 1024;
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Deserialize)]
pub struct SkillScriptRequest {
    script_path: String,
    script_content: String,
    args: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct SkillScriptResult {
    stdout: String,
    stderr: String,
    exit_code: i32,
}

fn extension(path: &str) -> Option<&str> {
    path.rsplit_once('.').map(|(_, ext)| ext)
}

fn interpreter_for(path: &str) -> Option<(&'static str, &'static str)> {
    match extension(path)? {
        "py" => Some(("python3", "-c")),
        "js" | "mjs" => Some(("node", "-e")),
        "sh" => Some(("sh", "-c")),
        _ => None,
    }
}

fn validate_request(req: &SkillScriptRequest) -> Result<(&'static str, &'static str), String> {
    if req.script_path.trim().is_empty() {
        return Err("script path is required".to_string());
    }
    if req.script_path.starts_with('/') || req.script_path.contains("..") {
        return Err("script path must be a relative skill path".to_string());
    }
    if req.script_content.len() > MAX_SCRIPT_BYTES {
        return Err(format!("script exceeds {} bytes", MAX_SCRIPT_BYTES));
    }
    if req.args.len() > MAX_ARG_COUNT {
        return Err(format!("too many script args (max {})", MAX_ARG_COUNT));
    }
    if req.args.iter().any(|arg| arg.len() > MAX_ARG_BYTES) {
        return Err(format!("script args must be <= {} bytes each", MAX_ARG_BYTES));
    }
    interpreter_for(&req.script_path)
        .ok_or_else(|| "unsupported script extension; allowed: .py, .js, .mjs, .sh".to_string())
}

#[tauri::command]
pub async fn run_skill_script(req: SkillScriptRequest) -> Result<SkillScriptResult, String> {
    let (program, eval_flag) = validate_request(&req)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut child = Command::new(program)
            .arg(eval_flag)
            .arg(req.script_content)
            .args(req.args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|err| format!("failed to start {program}: {err}"))?;

        let started = Instant::now();
        loop {
            if let Some(_status) = child
                .try_wait()
                .map_err(|err| format!("failed to poll {program}: {err}"))?
            {
                let output = child
                    .wait_with_output()
                    .map_err(|err| format!("failed to collect {program} output: {err}"))?;
                return Ok(SkillScriptResult {
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                    exit_code: output.status.code().unwrap_or(-1),
                });
            }
            if started.elapsed() > SCRIPT_TIMEOUT {
                let _ = child.kill();
                let output = child
                    .wait_with_output()
                    .map_err(|err| format!("failed to collect timed out {program} output: {err}"))?;
                return Ok(SkillScriptResult {
                    stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                    stderr: [
                        String::from_utf8_lossy(&output.stderr).to_string(),
                        format!("script timed out after {}s", SCRIPT_TIMEOUT.as_secs()),
                    ]
                    .into_iter()
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n"),
                    exit_code: 124,
                });
            }
            std::thread::sleep(Duration::from_millis(50));
        }
    })
    .await
    .map_err(|err| format!("script task failed: {err}"))?
}
