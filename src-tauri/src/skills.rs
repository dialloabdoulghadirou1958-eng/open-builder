use serde::{Deserialize, Serialize};
use std::io::Read;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const MAX_SCRIPT_BYTES: usize = 256 * 1024;
const MAX_ARG_COUNT: usize = 32;
const MAX_ARG_BYTES: usize = 8 * 1024;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;
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
        return Err(format!(
            "script args must be <= {} bytes each",
            MAX_ARG_BYTES
        ));
    }
    interpreter_for(&req.script_path)
        .ok_or_else(|| "unsupported script extension; allowed: .py, .js, .mjs, .sh".to_string())
}

struct CapturedStream {
    text: String,
    truncated: bool,
}

fn read_capped_stream<R: Read>(mut reader: R) -> CapturedStream {
    let mut captured: Vec<u8> = Vec::with_capacity(MAX_OUTPUT_BYTES.min(8192));
    let mut truncated = false;
    let mut buf = [0u8; 8192];

    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                let remaining = MAX_OUTPUT_BYTES.saturating_sub(captured.len());
                if remaining > 0 {
                    captured.extend_from_slice(&buf[..n.min(remaining)]);
                }
                if n > remaining {
                    truncated = true;
                }
            }
            Err(_) => {
                truncated = true;
                break;
            }
        }
    }

    CapturedStream {
        text: String::from_utf8_lossy(&captured).to_string(),
        truncated,
    }
}

fn append_truncation_note(mut text: String, stream_name: &str, truncated: bool) -> String {
    if truncated {
        if !text.is_empty() && !text.ends_with('\n') {
            text.push('\n');
        }
        text.push_str(&format!(
            "[{stream_name} truncated after {MAX_OUTPUT_BYTES} bytes]"
        ));
    }
    text
}

fn join_reader(
    handle: thread::JoinHandle<CapturedStream>,
    stream_name: &str,
) -> Result<String, String> {
    let captured = handle
        .join()
        .map_err(|_| format!("failed to collect {stream_name} output"))?;
    Ok(append_truncation_note(
        captured.text,
        stream_name,
        captured.truncated,
    ))
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
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("failed to capture {program} stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| format!("failed to capture {program} stderr"))?;
        let stdout_reader = thread::spawn(move || read_capped_stream(stdout));
        let stderr_reader = thread::spawn(move || read_capped_stream(stderr));

        let started = Instant::now();
        loop {
            if let Some(status) = child
                .try_wait()
                .map_err(|err| format!("failed to poll {program}: {err}"))?
            {
                let stdout = join_reader(stdout_reader, "stdout")?;
                let stderr = join_reader(stderr_reader, "stderr")?;
                return Ok(SkillScriptResult {
                    stdout,
                    stderr,
                    exit_code: status.code().unwrap_or(-1),
                });
            }
            if started.elapsed() > SCRIPT_TIMEOUT {
                let _ = child.kill();
                let _ = child.wait();
                let stdout = join_reader(stdout_reader, "stdout")?;
                let stderr = join_reader(stderr_reader, "stderr")?;
                return Ok(SkillScriptResult {
                    stdout,
                    stderr: [
                        stderr,
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
