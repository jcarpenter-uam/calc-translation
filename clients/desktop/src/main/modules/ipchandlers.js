import { ipcMain, net, app } from "electron";
import { getMainWindow } from "./windowmanager";
import { checkForUpdates } from "./autoupdate";
import log from "electron-log/main";

import { setUpdateChannel } from "./autoupdate";

export function registerIpcHandlers() {
  const mainWindow = getMainWindow();
  if (!mainWindow) return;

  ipcMain.handle("minimize-window", () => {
    mainWindow.minimize();
  });

  ipcMain.handle("maximize-window", () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
      return false;
    } else {
      mainWindow.maximize();
      return true;
    }
  });

  ipcMain.handle("close-window", () => {
    mainWindow.close();
  });

  ipcMain.handle("get-app-version", () => {
    return app.getVersion();
  });

  ipcMain.handle("set-update-channel", (event, isBetaEnabled) => {
    setUpdateChannel(isBetaEnabled);
  });

  ipcMain.handle("toggle-always-on-top", () => {
    const newState = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(newState);
    return newState;
  });

  ipcMain.handle("download-vtt", async () => {
    const DOWNLOAD_API_URL = "https://translator.my-uam.com/api/download-vtt";
    log.info("Handling download-vtt request...");

    return new Promise((resolve) => {
      const request = net.request({
        method: "GET",
        url: DOWNLOAD_API_URL,
      });

      let chunks = [];

      request.on("response", (response) => {
        log.info(`DOWNLOAD_API_URL response status: ${response.statusCode}`);

        response.on("data", (chunk) => {
          chunks.push(chunk);
        });

        response.on("end", () => {
          log.info("Download request finished.");
          if (response.statusCode >= 200 && response.statusCode < 300) {
            const buffer = Buffer.concat(chunks);
            resolve({ status: "ok", data: buffer });
          } else {
            log.error(`Download failed with status: ${response.statusCode}`);
            resolve({
              status: "error",
              message: `Download failed with status: ${response.statusCode}`,
            });
          }
        });

        response.on("error", (error) => {
          log.error("Error during download response: ", error);
          resolve({
            status: "error",
            message: error.message || "Unknown error during download response",
          });
        });
      });

      request.on("error", (error) => {
        log.error("Error making download request: ", error);
        resolve({
          status: "error",
          message: error.message || "Unknown error making download request",
        });
      });

      request.end();
    });
  });
}
