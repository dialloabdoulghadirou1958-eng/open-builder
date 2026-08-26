import { readFileSync } from "node:fs";

const tauriConfig = JSON.parse(
  readFileSync(
    new URL("../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
const capabilities = JSON.parse(
  readFileSync(
    new URL("../src-tauri/capabilities/default.json", import.meta.url),
    "utf8",
  ),
);
const tauriLib = readFileSync(
  new URL("../src-tauri/src/lib.rs", import.meta.url),
  "utf8",
);
const skillImporter = readFileSync(
  new URL("../src/lib/skills/importer.ts", import.meta.url),
  "utf8",
);
const settingsSystem = readFileSync(
  new URL("../src/store/settings/system.ts", import.meta.url),
  "utf8",
);

const failures = [];

if (!tauriConfig.app?.security?.csp) {
  failures.push("Tauri CSP must not be null or empty.");
}

const permissions = JSON.stringify(capabilities.permissions ?? []);
if (permissions.includes("shell:allow-execute")) {
  failures.push("Desktop capabilities must not grant shell:allow-execute.");
}
if (permissions.includes('"$HOME/**"')) {
  failures.push("Desktop capabilities must not grant recursive $HOME access.");
}

const csp = tauriConfig.app?.security?.csp ?? "";
if (!csp.includes("proxy-http:") || !csp.includes("proxy-https:")) {
  failures.push(
    "Tauri CSP must use explicit proxy-http and proxy-https schemes.",
  );
}

const mobileHandler = tauriLib.match(
  /#\[cfg\(mobile\)\][\s\S]*?generate_handler!\[([\s\S]*?)\]\);/,
)?.[1];
if (!mobileHandler) {
  failures.push("A dedicated mobile invoke handler must be present.");
} else if (
  /skills::|mcp_stdio::|mcp_remote::|mcp_oauth::/.test(mobileHandler)
) {
  failures.push(
    "Mobile invoke handler must not expose Skill scripts or desktop MCP commands.",
  );
}

if (!/developerSkillScriptsEnabled:\s*false/.test(settingsSystem)) {
  failures.push("Desktop Skill scripts must default to disabled.");
}

const streamIndex = skillImporter.indexOf('internalStream("uint8array")');
const zipPreflightIndex = skillImporter.indexOf(
  "assertSkillZipCentralDirectory(buffer, subpath)",
);
const jsZipLoadIndex = skillImporter.indexOf("JSZip.loadAsync(buffer)");
const trackerIndex = skillImporter.indexOf("budget.createFileTracker(path)");
const trackChunkIndex = skillImporter.indexOf(
  "tracker.trackChunk(chunk.byteLength)",
);
const bufferChunkIndex = skillImporter.indexOf("chunks.push(chunk)");
const pauseIndex = skillImporter.indexOf("stream.pause()");
const resumeIndex = skillImporter.indexOf(".resume()", streamIndex);
if (
  zipPreflightIndex < 0 ||
  jsZipLoadIndex < zipPreflightIndex ||
  streamIndex < 0 ||
  trackerIndex < streamIndex ||
  trackChunkIndex < trackerIndex ||
  bufferChunkIndex < trackChunkIndex ||
  pauseIndex < streamIndex ||
  skillImporter.includes('entry.file.async("uint8array")') ||
  resumeIndex < bufferChunkIndex
) {
  failures.push(
    "Skill ZIP metadata must be preflighted before JSZip, and chunks budgeted before buffering.",
  );
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`security: ${failure}`);
  process.exit(1);
}

console.log("Desktop security checks passed.");
