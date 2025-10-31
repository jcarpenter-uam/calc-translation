import { app, shell, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
const { autoUpdater } = require("electron-updater");

autoUpdater.autoDownload = true;

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 300,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    transparent: true,

    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: "deny" };
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.webContents.openDevTools();
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  ipcMain.handle("get-window-bounds", () => {
    return mainWindow.getBounds();
  });

  ipcMain.on("set-window-bounds", (event, bounds) => {
    mainWindow.setBounds(bounds);
  });

  ipcMain.handle("minimize-window", () => {
    mainWindow.minimize();
  });

  ipcMain.handle("close-window", () => {
    mainWindow.close();
  });
}

app.whenReady().then(() => {
  autoUpdater.on("update-downloaded", (info) => {
    console.log("Update downloaded. Will restart now.");
    autoUpdater.quitAndInstall();
  });

  autoUpdater.on("update-available", (info) => {
    console.log("An update is available:", info.version);
  });

  autoUpdater.on("error", (err) => {
    console.error("Error during update:", err);
  });

  autoUpdater.checkForUpdates();
  electronApp.setAppUserModelId("com.electron");
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  createWindow();

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
