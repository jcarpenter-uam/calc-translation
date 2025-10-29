const { app, Menu, ipcMain } = require("electron");
const { BrowserWindow } = require("electron-acrylic-window");
const path = require("path");
const { autoUpdater } = require("electron-updater");

// TODO:
// Remove human intervention with auto update
// Scrollbar
// Transclucent background

autoUpdater.autoDownload = true;

let mainWindow;
const defaultFontSize = 20;

function createWindow() {
  mainWindow = new BrowserWindow({
    // Always reverts to this size when opened
    width: 800,
    height: 300,
    autoHideMenuBar: true,
    frame: false,
    vibrancy: {
      theme: "appearance-based",
      effect: "acrylic",
    },
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      webviewTag: true,
    },
    icon: path.join(__dirname, "assets/icon.png"),
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

ipcMain.on("window-minimize", () => {
  mainWindow.minimize();
});

ipcMain.on("window-maximize", () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.on("window-close", () => {
  mainWindow.close();
});

app.whenReady().then(() => {
  createWindow();

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

  const menuTemplate = [
    {
      label: "View",
      submenu: [
        {
          label: "Increase Font Size",
          accelerator: "Control+=",
          click: () => {
            mainWindow.webContents.send("font-change-request", "increase");
          },
        },
        {
          label: "Decrease Font Size",
          accelerator: "Control+-",
          click: () => {
            mainWindow.webContents.send("font-change-request", "decrease");
          },
        },
        {
          label: "Reset Font Size",
          accelerator: "Control+0",
          click: () => {
            mainWindow.webContents.send(
              "font-change-request",
              "reset",
              defaultFontSize,
            );
          },
        },
        { role: "reload" }, // Handles 'Control+R'
        { role: "forceReload" }, // Handles 'Control+Shift+R'
        { role: "toggleDevTools" }, // Handles 'Control+Shift+I'
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);

  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
