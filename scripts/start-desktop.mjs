import electron from "electron";
import { spawn } from "node:child_process";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ["."], {
  stdio: "inherit",
  env,
  windowsHide: true,
});
child.on("error", () => {
  console.error("AgentHUD başlatılamadı. Önce pnpm build çalıştır.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 0;
});
