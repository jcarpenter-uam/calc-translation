import { Menu } from "electron";
import { getMainWindow } from "./windowmanager";
import log from "electron-log/main";

export function createApplicationMenu() {
  const menuTemplate = [
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        {
          label: "Reset Window Size",
          accelerator: "CmdOrCtrl+Shift+R",
          click: () => {
            const defaultWidth = 800;
            const defaultHeight = 300;
            const mainWindow = getMainWindow();

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
