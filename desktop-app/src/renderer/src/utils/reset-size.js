/**
 * Resets the window to the default size (800x300) if it's not already
 * at that size.
 */
export const handleHeaderDoubleClick = () => {
  const defaultWidth = 800;
  const defaultHeight = 300;

  console.log("Header double-clicked.");

  if (window.electron) {
    console.log("`window.electron` API found. Getting window bounds...");

    window.electron.getWindowBounds().then((currentBounds) => {
      console.log("Current bounds received:", currentBounds);

      if (
        currentBounds.width !== defaultWidth ||
        currentBounds.height !== defaultHeight
      ) {
        console.log("Window size is NOT default. Resetting to 800x300.");
        window.electron.setWindowBounds({
          width: defaultWidth,
          height: defaultHeight,
        });
      } else {
        console.log("Window size is already default. Doing nothing.");
      }
    });
  } else {
    console.error("`window.electron` API not found. Cannot resize window.");
  }
};
