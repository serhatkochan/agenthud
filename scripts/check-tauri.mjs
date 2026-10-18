import { spawn } from "node:child_process";
import { resolve } from "node:path";
const child = spawn(
  resolve(process.argv[2] || "src-tauri/target/debug/agenthud.exe"),
  ["--live-check"],
  { windowsHide: true, stdio: "inherit" },
);
child.once("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.once("exit", (code) => {
  process.exitCode = code ?? 1;
});
