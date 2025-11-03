import { contextBridge, ipcRenderer } from "electron";
import log from "electron-log/renderer";

contextBridge.exposeInMainWorld("electron", {
  minimize: () => {
    log.info("IPC: Invoking minimize-window");
    return ipcRenderer.invoke("minimize-window");
  },
  close: () => {
    log.info("IPC: Invoking close-window");
    return ipcRenderer.invoke("close-window");
  },
  getWindowBounds: () => {
    log.info("IPC: Invoking get-window-bounds");
    return ipcRenderer.invoke("get-window-bounds");
  },
  setWindowBounds: (bounds) => {
    log.info("IPC: Sending set-window-bounds", bounds);
    return ipcRenderer.send("set-window-bounds", bounds);
  },
  toggleAlwaysOnTop: () => {
    log.info("IPC: Invoking toggle-always-on-top");
    return ipcRenderer.invoke("toggle-always-on-top");
  },
  toggleTileable: () => {
    log.info("IPC: Invoking toggle-tileable");
    return ipcRenderer.invoke("toggle-tileable");
  },
  isTileable: () => {
    log.info("IPC: Invoking is-tileable");
    return ipcRenderer.invoke("is-tileable");
  },
});
