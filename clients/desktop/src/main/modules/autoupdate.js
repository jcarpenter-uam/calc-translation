import { BrowserWindow, dialog } from "electron";
import { autoUpdater } from "electron-updater";
import log from "electron-log/main";
import { getMainWindow } from "./windowmanager";

export function setupAutoUpdaterListeners() {
  autoUpdater.allowPrerelease = false;

  autoUpdater.autoDownload = true;

  autoUpdater.on("update-available", (info) => {
    log.info("An update is available:", info.version);
  });

  autoUpdater.on("error", (err) => {
    log.error("Error during update:", err);
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info("Update downloaded. Prompting user...", info);

    const window = getMainWindow() || BrowserWindow.getAllWindows()[0];

    if (window) {
      dialog
        .showMessageBox(window, {
          type: "info",
          title: "Update Available",
          message: "A new version of CALC Translation has been downloaded.",
          detail: "Do you want to install it now or on the next app start?",
          buttons: ["Install Now", "Install on Next Start"],
          defaultId: 0,
          cancelId: 1,
        })
        .then((result) => {
          if (result.response === 0) {
            log.info("User chose 'Install Now'. Quitting and installing.");
            autoUpdater.quitAndInstall(true);
          } else {
            log.info(
              "User chose 'Install on Next Start'. Update will be installed on next launch.",
            );
          }
        });
    }
  });
}

export function checkForUpdates() {
  log.info("Checking for updates...");
  autoUpdater.checkForUpdates();
}

export function setUpdateChannel(isBetaEnabled) {
  if (isBetaEnabled) {
    autoUpdater.allowPrerelease = true;
    log.info("Switched to BETA update channel.");
  } else {
    autoUpdater.allowPrerelease = false;
    log.info("Switched to STABLE update channel.");
  }

  checkForUpdates();
}
