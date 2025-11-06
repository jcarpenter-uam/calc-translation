import { app, BrowserWindow } from "electron";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import log from "electron-log/main";

import { createMainWindow } from "./modules/windowmanager";
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

  setupAutoUpdaterListeners();

  createMainWindow();

  registerIpcHandlers();

  createApplicationMenu();

  electronApp.setAppUserModelId("com.electron");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });

  checkForUpdates();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    log.info("All windows closed, quitting application.");
    app.quit();
  }
});
