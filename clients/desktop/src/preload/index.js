import { contextBridge, ipcRenderer } from "electron";
import log from "electron-log/renderer";

contextBridge.exposeInMainWorld("electron", {
  toggleAlwaysOnTop: () => {
    log.info("IPC: Invoking toggle-always-on-top");
    return ipcRenderer.invoke("toggle-always-on-top");
  },
  downloadVtt: () => {
    log.info("IPC: Invoking download-vtt");
    return ipcRenderer.invoke("download-vtt");
  },
});
