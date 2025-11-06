import { BrowserWindow } from "electron";
import { join } from "path";
import log from "electron-log/main";

let mainWindow;

export function createMainWindow() {
  log.info("Creating main window...");

  mainWindow = new BrowserWindow({
    width: 800,
    height: 300,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    alwaysOnTop: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.loadFile(join(__dirname, "../renderer/index.html"));

  return mainWindow;
}

export function getMainWindow() {
  return mainWindow;
}
