// Preload for the Pyodide host. Exposes a tiny IPC bridge to the renderer
// while keeping nodeIntegration disabled (which is required so Pyodide
// doesn't auto-detect Node and try to import node:url).
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pyodideBridge", {
  on: (channel, fn) => {
    const wrap = (_e, data) => fn(data);
    ipcRenderer.on(channel, wrap);
    return () => ipcRenderer.off(channel, wrap);
  },
  send: (channel, data) => ipcRenderer.send(channel, data),
});
