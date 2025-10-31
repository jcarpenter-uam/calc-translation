import { app, shell, BrowserWindow, ipcMain, dialog, Menu } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
const { autoUpdater } = require("electron-updater");
import log from "electron-log/main";

// This will set up the default file logging (1MB size, 1 rotation)
// Along with automatically catch and log unhandled errors
// By default, it writes logs to the following locations:
// on Linux: ~/.config/{app name}/logs/main.log
// on macOS: ~/Library/Logs/{app name}/main.log
// on Windows: %USERPROFILE%\AppData\Roaming\{app name}\logs\main.log
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
    transparent: true,
    alwaysOnTop: true,

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
