import { contextBridge, ipcRenderer } from "electron";
import { electronAPI } from "@electron-toolkit/preload";

const desktopApi = {
  minimize: () => ipcRenderer.send("window-minimize"),
  toggleMaximize: () => ipcRenderer.send("window-toggle-maximize"),
  close: () => ipcRenderer.send("window-close"),
};
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("desktopApi", desktopApi);
  } catch (error) {
    console.error(error);
  }
} else {
  window.electron = electronAPI;
  window.desktopApi = desktopApi;
}
