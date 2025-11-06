import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electron", {
  minimize: () => ipcRenderer.invoke("minimize-window"),
  maximize: () => ipcRenderer.invoke("maximize-window"),
  close: () => ipcRenderer.invoke("close-window"),
  setUpdateChannel: (isBeta) =>
    ipcRenderer.invoke("set-update-channel", isBeta),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  toggleAlwaysOnTop: () => ipcRenderer.invoke("toggle-always-on-top"),
  downloadVtt: () => ipcRenderer.invoke("download-vtt"),
});
