const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),

  onFontChangeRequest: (callback) => {
    ipcRenderer.on("font-change-request", (event, ...args) =>
      callback(...args),
    );
  },
});

window.addEventListener("DOMContentLoaded", () => {
  console.log("Preload script loaded for index.html.");
});
