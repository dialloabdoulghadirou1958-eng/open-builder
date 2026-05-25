/// <reference lib="webworker" />

// NOT A REAL SANDBOX. `new Function(...)` runs the script with full access to
// Worker globals (fetch, WebSocket, crypto, postMessage, etc.). `console` is
// captured only for stdout/stderr capture, not isolation. Skill scripts in the
// Web runtime must be treated as fully trusted code with network access.

interface RunRequest {
  type: "run";
  code: string;
  args: string[];
}

interface RunResponse {
  type: "result";
  stdout: string;
  stderr: string;
  exitCode: number;
}

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function format(parts: unknown[]): string {
  return parts
    .map((p) => {
      if (typeof p === "string") return p;
      try {
        return JSON.stringify(p);
      } catch {
        return String(p);
      }
    })
    .join(" ");
}

async function run(code: string, args: string[]): Promise<RunResponse> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const sandboxConsole = {
    log: (...a: unknown[]) => stdout.push(format(a)),
    info: (...a: unknown[]) => stdout.push(format(a)),
    debug: (...a: unknown[]) => stdout.push(format(a)),
    warn: (...a: unknown[]) => stderr.push(format(a)),
    error: (...a: unknown[]) => stderr.push(format(a)),
  };

  try {
    const factory = new Function(
      "args",
      "console",
      `return (async () => {\n${code}\n})();`,
    );
    const result = await factory(args, sandboxConsole);
    if (result !== undefined) {
      stdout.push(format([result]));
    }
    return {
      type: "result",
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
      exitCode: 0,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.stack || err.message : String(err);
    stderr.push(msg);
    return {
      type: "result",
      stdout: stdout.join("\n"),
      stderr: stderr.join("\n"),
      exitCode: 1,
    };
  }
}

ctx.addEventListener("message", async (event: MessageEvent<RunRequest>) => {
  const data = event.data;
  if (!data || data.type !== "run") return;
  const response = await run(data.code, data.args);
  ctx.postMessage(response);
});
