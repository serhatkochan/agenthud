import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let api;

export function loadWindowApi() {
  if (api) return api;
  if (process.platform !== "win32")
    throw new Error("windows-focus-unavailable");
  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  const kernel32 = koffi.load("kernel32.dll");
  const callback = koffi.proto(
    "int __stdcall AgentHudEnumWindows(uintptr_t hwnd, intptr_t value)",
  );
  const enumerate = user32.func("__stdcall", "EnumWindows", "int", [
    koffi.pointer(callback),
    "intptr_t",
  ]);
  const visible = user32.func("__stdcall", "IsWindowVisible", "int", [
    "uintptr_t",
  ]);
  const exists = user32.func("__stdcall", "IsWindow", "int", ["uintptr_t"]);
  const owner = user32.func("__stdcall", "GetWindow", "uintptr_t", [
    "uintptr_t",
    "uint",
  ]);
  const getPid = user32.func("__stdcall", "GetWindowThreadProcessId", "uint", [
    "uintptr_t",
    "void *",
  ]);
  const getText = user32.func("__stdcall", "GetWindowTextW", "int", [
    "uintptr_t",
    "void *",
    "int",
  ]);
  const isMinimized = user32.func("__stdcall", "IsIconic", "int", [
    "uintptr_t",
  ]);
  const show = user32.func("__stdcall", "ShowWindow", "int", [
    "uintptr_t",
    "int",
  ]);
  const foreground = user32.func("__stdcall", "SetForegroundWindow", "int", [
    "uintptr_t",
  ]);
  const current = user32.func(
    "__stdcall",
    "GetForegroundWindow",
    "uintptr_t",
    [],
  );
  const ancestor = user32.func("__stdcall", "GetAncestor", "uintptr_t", [
    "uintptr_t",
    "uint",
  ]);
  const open = kernel32.func("__stdcall", "OpenProcess", "uintptr_t", [
    "uint",
    "int",
    "uint",
  ]);
  const times = kernel32.func("__stdcall", "GetProcessTimes", "int", [
    "uintptr_t",
    "void *",
    "void *",
    "void *",
    "void *",
  ]);
  const close = kernel32.func("__stdcall", "CloseHandle", "int", ["uintptr_t"]);
  function pid(handle) {
    const output = Buffer.alloc(4);
    return getPid(handle, output) ? output.readUInt32LE() : 0;
  }
  function title(handle) {
    const output = Buffer.alloc(2048);
    const length = getText(handle, output, 1024);
    return length > 0 ? output.toString("utf16le", 0, length * 2).trim() : "";
  }
  function birth(id) {
    const processHandle = open(0x1000, 0, id);
    if (!processHandle) return null;
    try {
      const created = Buffer.alloc(8);
      return times(
        processHandle,
        created,
        Buffer.alloc(8),
        Buffer.alloc(8),
        Buffer.alloc(8),
      )
        ? created.readBigUInt64LE().toString()
        : null;
    } finally {
      close(processHandle);
    }
  }
  function inspect(handle) {
    if (!exists(handle)) return null;
    const id = pid(handle);
    const created = birth(id);
    if (!id || !created) return null;
    return {
      handle: String(handle),
      pid: id,
      creationId: created,
      title: title(handle),
    };
  }
  function isForeground(handle) {
    const selected = current();
    return (
      String(selected) === String(handle) ||
      String(ancestor(selected, 3)) === String(handle)
    );
  }
  api = {
    list(allowedPids) {
      const result = [];
      enumerate((handle) => {
        try {
          if (
            !visible(handle) ||
            owner(handle, 4) ||
            !allowedPids.has(pid(handle))
          )
            return 1;
          const window = inspect(handle);
          if (window?.title) result.push(window);
          return result.length < 128 ? 1 : 0;
        } catch {
          return 1;
        }
      }, 0);
      return result;
    },
    async focus(target) {
      let handle;
      try {
        handle = BigInt(target.handle);
      } catch {
        return "stale";
      }
      const latest = inspect(handle);
      if (
        !latest ||
        latest.pid !== target.pid ||
        latest.creationId !== target.creationId ||
        latest.title !== target.title ||
        !visible(handle)
      )
        return "stale";
      if (isMinimized(handle)) show(handle, 9);
      foreground(handle);
      for (let attempt = 0; attempt < 10; attempt++) {
        if (isForeground(handle)) return "focused";
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return "denied";
    },
    foreground: () => String(current()),
  };
  return api;
}
