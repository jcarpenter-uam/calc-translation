import React from "react";
import log from "electron-log/renderer";
import { X } from "@phosphor-icons/react/dist/csr/X";
import { Minus } from "@phosphor-icons/react/dist/csr/Minus";

const baseButtonStyles =
  "w-10 h-10 flex items-center justify-center rounded-full text-zinc-500 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-zinc-900";

/**
 * Buttons for minimize and close on the header.
 */
export default function OsControls() {
  const handleMinimize = () => {
    log.info("OS Controls: Minimize button clicked");
    window.electron.minimize();
  };

  const handleClose = () => {
    log.info("OS Controls: Close button clicked");
    window.electron.close();
  };

  return (
    <div className="flex items-center gap-2 app-region-no-drag">
      <button
        onClick={handleMinimize}
        className={`${baseButtonStyles} hover:bg-yellow-500/90 hover:text-white focus:ring-yellow-500`}
        aria-label="Minimize"
      >
        <Minus className="w-5 h-5" />
      </button>

      <button
        onClick={handleClose}
        className={`${baseButtonStyles} hover:bg-red-500/90 hover:text-white focus:ring-red-500`}
        aria-label="Close"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
