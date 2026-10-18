import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

export function loadAltReader() {
  if (process.platform !== "win32")
    throw new Error("windows-input-unavailable");
  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  const keyState = user32.func("__stdcall", "GetAsyncKeyState", "short", [
    "int",
  ]);
  // Ctrl excludes AltGr, which is used to type characters on Turkish keyboards.
  return () =>
    (keyState(0x12) & 0x8000) !== 0 && (keyState(0x11) & 0x8000) === 0;
}
