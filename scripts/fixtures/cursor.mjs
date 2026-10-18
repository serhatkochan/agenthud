import { spawn } from "node:child_process";

export async function emitCursorFixture(command, input) {
  const encoded = command.split("-EncodedCommand ")[1];
  if (!encoded || command.length >= 7800)
    throw new Error("Invalid fixture command");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (value) => (stdout += value));
    child.stderr.on("data", (value) => (stderr += value));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("observer timed out"));
    }, 10000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(typeof input === "string" ? input : JSON.stringify(input));
  });
}
