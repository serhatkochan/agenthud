const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("agenthud", {
  snapshot: () => ipcRenderer.invoke("hud:snapshot"),
  refresh: () => ipcRenderer.invoke("hud:refresh"),
  connect: (id) => ipcRenderer.invoke("hud:connect", id),
  openUsage: (id) => ipcRenderer.invoke("hud:usage", id),
  setSettings: (patch) => ipcRenderer.invoke("hud:settings", patch),
  window: (action) => ipcRenderer.invoke("hud:window", action),
  port: (action, key) => ipcRenderer.invoke("hud:port", action, key),
  focus: (sessionId, choiceId) =>
    ipcRenderer.invoke("hud:focus", sessionId, choiceId),
  hotspot: (rectangle) => ipcRenderer.invoke("hud:hotspot", rectangle),
  tracking: (provider, enabled) =>
    ipcRenderer.invoke("hud:tracking", provider, enabled),
  onUpdate: (fn) => {
    const listener = (_event, value) => fn(value);
    ipcRenderer.on("hud:update", listener);
    return () => ipcRenderer.removeListener("hud:update", listener);
  },
});
