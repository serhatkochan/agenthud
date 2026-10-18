const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("agenthud", {
  snapshot: () => ipcRenderer.invoke("hud:snapshot"),
  refresh: () => ipcRenderer.invoke("hud:refresh"),
  connect: (id) => ipcRenderer.invoke("hud:connect", id),
  openUsage: (id) => ipcRenderer.invoke("hud:usage", id),
  setSettings: (patch) => ipcRenderer.invoke("hud:settings", patch),
  window: (action) => ipcRenderer.invoke("hud:window", action),
  port: (action, key) => ipcRenderer.invoke("hud:port", action, key),
  focus: (provider) => ipcRenderer.invoke("hud:focus", provider),
  onUpdate: (fn) => {
    const listener = (_event, value) => fn(value);
    ipcRenderer.on("hud:update", listener);
    return () => ipcRenderer.removeListener("hud:update", listener);
  },
});
