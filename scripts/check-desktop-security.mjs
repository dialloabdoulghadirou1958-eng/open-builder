import { readFileSync } from "node:fs";

const tauriConfig = JSON.parse(
  readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const capabilities = JSON.parse(
  readFileSync(
    new URL("../src-tauri/capabilities/default.json", import.meta.url),
    "utf8",
  ),
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

if (failures.length > 0) {
  for (const failure of failures) console.error(`security: ${failure}`);
  process.exit(1);
}

console.log("Desktop security checks passed.");
