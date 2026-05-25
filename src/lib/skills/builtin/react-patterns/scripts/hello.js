// Smoke-test script for the skills runtime.
// In the web sandbox: `args` and `console` are injected as locals; the body runs
// inside an async function. In Tauri: this runs via `node -e <code>` with the
// remaining args appended.
const target = (typeof args !== "undefined" && args[0]) || "world";
console.log("hello, " + target + "!");
console.log("argv:", JSON.stringify(typeof args !== "undefined" ? args : process.argv.slice(2)));
