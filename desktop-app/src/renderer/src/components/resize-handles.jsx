import React, { useRef } from "react";

const handleBase = "app-region-no-drag fixed z-[100]";

const styles = {
  top: "h-1.5 left-0 right-0 top-0 cursor-n-resize",
  bottom: "h-1.5 left-0 right-0 bottom-0 cursor-s-resize",
  left: "w-1.5 top-0 bottom-0 left-0 cursor-w-resize",
  right: "w-1.5 top-0 bottom-0 right-0 cursor-e-resize",
  topLeft: "w-2.5 h-2.5 top-0 left-0 cursor-nw-resize",
  topRight: "w-2.5 h-2.5 top-0 right-0 cursor-ne-resize",
  bottomLeft: "w-2.5 h-2.5 bottom-0 left-0 cursor-sw-resize",
  bottomRight: "w-2.5 h-2.5 bottom-0 right-0 cursor-se-resize",
};

const directions = [
  "top",
  "bottom",
  "left",
  "right",
  "topLeft",
  "topRight",
  "bottomLeft",
  "bottomRight",
];

export default function ResizeHandles() {
  const initialBounds = useRef({ x: 0, y: 0, width: 0, height: 0 });
  const initialMouse = useRef({ x: 0, y: 0 });

  const handleMouseDown = (e, direction) => {
    e.preventDefault();

    console.log("Mouse Down On:", direction);

    window.electron.getWindowBounds().then((bounds) => {
      initialBounds.current = bounds;
      initialMouse.current = { x: e.screenX, y: e.screenY };

      const handleMouseMove = (moveEvent) => {
        const mouseX = moveEvent.screenX;
        const mouseY = moveEvent.screenY;

        const deltaX = mouseX - initialMouse.current.x;
        const deltaY = mouseY - initialMouse.current.y;

        const { x, y, width, height } = initialBounds.current;

        const minWidth = 400;
        const minHeight = 200;

        let newX = x;
        let newY = y;
        let newWidth = width;
        let newHeight = height;

        if (direction.includes("left")) {
          const potentialWidth = width - deltaX;
          newWidth = Math.max(minWidth, potentialWidth);
          const actualDeltaWidth = width - newWidth;
          newX = x + actualDeltaWidth;
        }

        if (direction.includes("right")) {
          newWidth = Math.max(minWidth, width + deltaX);
        }

        if (direction.includes("top")) {
          const potentialHeight = height - deltaY;
          newHeight = Math.max(minHeight, potentialHeight);
          const actualDeltaHeight = height - newHeight;
          newY = y + actualDeltaHeight;
        }

        if (direction.includes("bottom")) {
          newHeight = Math.max(minHeight, height + deltaY);
        }

        console.log({
          dir: direction,
          w: newWidth,
          h: newHeight,
        });

        const finalBounds = {
          x: Math.round(newX),
          y: Math.round(newY),
          width: Math.round(newWidth),
          height: Math.round(newHeight),
        };

        window.electron.setWindowBounds(finalBounds);
      };

      const handleMouseUp = () => {
        console.log("Mouse Up");
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    });
  };

  return (
    <>
      {directions.map((direction) => (
        <div
          key={direction}
          onMouseDown={(e) => handleMouseDown(e, direction)}
          className={`${handleBase} ${styles[direction]}`}
        />
      ))}
    </>
  );
}
