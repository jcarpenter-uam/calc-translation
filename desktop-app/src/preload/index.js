import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  minimize: () => ipcRenderer.invoke("minimize-window"),
  close: () => ipcRenderer.invoke("close-window"),
  getWindowBounds: () => ipcRenderer.invoke("get-window-bounds"),
  setWindowBounds: (bounds) => ipcRenderer.send("set-window-bounds", bounds),
});
