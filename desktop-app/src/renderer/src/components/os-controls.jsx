import React from "react";

const baseButtonStyles =
  "w-10 h-10 flex items-center justify-center rounded-full text-zinc-500 focus:outline-none focus:ring-2 focus:ring-offset-2 dark:focus:ring-offset-zinc-900";

export default function OsControls() {
  return (
    <div className="flex items-center gap-2 app-region-no-drag">
      <button
        onClick={() => window.electron.minimize()}
        className={`${baseButtonStyles} hover:bg-yellow-500/90 hover:text-white focus:ring-yellow-500`}
        aria-label="Minimize"
      >
        <span className="text-2xl font-black">−</span>
      </button>

      <button
        onClick={() => window.electron.close()}
        className={`${baseButtonStyles} hover:bg-red-500/90 hover:text-white focus:ring-red-500`}
        aria-label="Close"
      >
        <span className="text-2xl font-black">×</span>
      </button>
    </div>
  );
}
