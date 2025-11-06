import { app, BrowserWindow } from "electron";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import { autoUpdater } from "electron-updater";
import log from "electron-log/main";

// Import your new modules
import { createMainWindow, getMainWindow } from "./modules/windowmanager";
import { registerIpcHandlers } from "./modules/ipchandlers";
import { createApplicationMenu } from "./modules/appmenu";
import {
  setupAutoUpdaterListeners,
  checkForUpdates,
} from "./modules/autoupdate";

log.initialize();
log.errorHandler.startCatching();

app.whenReady().then(() => {
  log.info("App is ready.");

  // Setup listeners *before* creating the window or checking
  setupAutoUpdaterListeners();

  // Create the window
  createMainWindow();

  // Register IPC handlers now that the window exists
  registerIpcHandlers();

  // Create the application menu
  createApplicationMenu();

  electronApp.setAppUserModelId("com.electron");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  // Now, check for updates
  checkForUpdates();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    log.info("All windows closed, quitting application.");
    app.quit();
  }
});
