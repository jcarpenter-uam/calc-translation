/**
 * Resets the window to the default size (800x300) if it's not already
 * at that size.
 */
export const handleHeaderDoubleClick = () => {
  const defaultWidth = 800;
  const defaultHeight = 300;

  if (window.electron) {
    window.electron.getWindowBounds().then((currentBounds) => {
      if (
        currentBounds.width !== defaultWidth ||
        currentBounds.height !== defaultHeight
      ) {
        window.electron.setWindowBounds({
          width: defaultWidth,
          height: defaultHeight,
        });
      }
    });
  }
};
