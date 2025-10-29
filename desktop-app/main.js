const { app, BrowserWindow, Menu } = require("electron");
const path = require("path");
const { autoUpdater } = require("electron-updater");

// TODO:
// Personal toolbar with minimal look

autoUpdater.autoDownload = true;

let mainWindow;
const defaultFontSize = 20;

function createWindow() {
  mainWindow = new BrowserWindow({
    // Always reverts to this size when opened
    width: 800,
    height: 300,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
    },
    icon: path.join(__dirname, "assets/icon.png"),
  });

  mainWindow.webContents.on("did-finish-load", () => {
    const jsCode = `document.documentElement.style.fontSize = '${defaultFontSize}px';`;

    mainWindow.webContents.executeJavaScript(jsCode).catch((err) => {
      console.error("Failed to set default font size:", err);
    });
  });

  mainWindow.loadURL("https://translator.my-uam.com/");
}

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
        // --- Increase Font Size ---
        {
          label: "Increase Font Size",
          accelerator: "Control+=",
          click: () => {
            if (mainWindow) {
              const jsCode = `
                (function() {
                  const el = document.documentElement;
                  let currentSize = parseFloat(window.getComputedStyle(el).fontSize);
                  
                  if (isNaN(currentSize)) { currentSize = 16; }
                  
                  el.style.fontSize = (currentSize + 1) + 'px';
                })();
              `;

              mainWindow.webContents.executeJavaScript(jsCode).catch((err) => {
                console.error("Failed to execute increase font JS:", err);
              });
            }
          },
        },
        // --- Decrease Font Size ---
        {
          label: "Decrease Font Size",
          accelerator: "Control+-",
          click: () => {
            if (mainWindow) {
              const jsCode = `
                (function() {
                  const el = document.documentElement;
                  let currentSize = parseFloat(window.getComputedStyle(el).fontSize);
                  
                  if (isNaN(currentSize)) { currentSize = 16; }
                  
                  el.style.fontSize = (currentSize - 1) + 'px';
                })();
              `;

              mainWindow.webContents.executeJavaScript(jsCode).catch((err) => {
                console.error("Failed to execute decrease font JS:", err);
              });
            }
          },
        },
        // --- Reset Font Size ---
        {
          label: "Reset Font Size",
          accelerator: "Control+0",
          click: () => {
            if (mainWindow) {
              const jsCode = `document.documentElement.style.fontSize = '${defaultFontSize}px';`;

              mainWindow.webContents.executeJavaScript(jsCode).catch((err) => {
                console.error("Failed to execute reset font JS:", err);
              });
            }
          },
        },
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
