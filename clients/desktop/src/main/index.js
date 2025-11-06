import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  dialog,
  Menu,
  net,
} from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
const { autoUpdater } = require("electron-updater");
import log from "electron-log/main";
const Store = require("electron-store").default;

log.initialize();
log.errorHandler.startCatching();

autoUpdater.autoDownload = true;
let mainWindow;

function createWindow() {
  log.info("Creating main window...");

  mainWindow = new BrowserWindow({
    width: 800,
    height: 300,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    alwaysOnTop: false,

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
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  ipcMain.handle("toggle-always-on-top", () => {
    if (mainWindow) {
      const newState = !mainWindow.isAlwaysOnTop();
      mainWindow.setAlwaysOnTop(newState);

      return newState;
    }
    return false;
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

  const menuTemplate = [
    {
      label: "View",
      submenu: [
        { role: "reload" }, // Handles 'Control+R'
        { role: "forceReload" }, // Handles 'Control+Shift+R'
        { role: "toggleDevTools" }, // Handles 'Control+Shift+I'
        {
          label: "Reset Window Size", // Resizes the window to default
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            const defaultWidth = 800;
            const defaultHeight = 300;

            if (mainWindow) {
              const currentBounds = mainWindow.getBounds();

              if (
                currentBounds.width !== defaultWidth ||
                currentBounds.height !== defaultHeight
              ) {
                log.info("Resetting window size to default");
                mainWindow.setBounds({
                  width: defaultWidth,
                  height: defaultHeight,
                });
              }
            }
          },
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  log.info("App is ready.");

  autoUpdater.on("update-available", (info) => {
    log.info("An update is available:", info.version);
  });

  autoUpdater.on("error", (err) => {
    log.error("Error during update:", err);
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info("Update downloaded. Prompting user...", info);

    const window = mainWindow || BrowserWindow.getAllWindows()[0];

    if (window) {
      dialog
        .showMessageBox(window, {
          type: "info",
          title: "Update Available",
          message: "A new version of CALC Translation has been downloaded.",
          // TODO: Display github release notes
          detail: "Do you want to install it now or on the next app start?",
          buttons: ["Install Now", "Install on Next Start"],
          defaultId: 0, // 'Install Now' is the default
          cancelId: 1, // 'Install on Next Start' is the "cancel" action
        })
        .then((result) => {
          if (result.response === 0) {
            log.info("User chose 'Install Now'. Quitting and installing.");
            // BUG: App does not repoen 100% of the time
            autoUpdater.quitAndInstall(true);
          } else {
            log.info(
              "User chose 'Install on Next Start'. Update will be installed on next launch.",
            );
          }
        });
    }
  });

  createWindow();

  electronApp.setAppUserModelId("com.electron");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  log.info("Checking for updates...");
  autoUpdater.checkForUpdates();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    log.info("All windows closed, quitting application.");
    app.quit();
  }
});
