import React, { useState } from "react";
import ConnectionIndicator from "./connection-indicator.jsx";
import { Gear } from "@phosphor-icons/react/dist/csr/Gear";
import DownloadVttButton from "./vtt-download.jsx";
import SettingsModal from "../models/settings.jsx";
import OsControls from "./os-controls.jsx";

export default function Titlebar({ status, isDownloadable }) {
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleSettingsClick = () => {
    setIsSettingsOpen(true);
    console.log("Opening settings model");
  };

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-white/80 dark:bg-zinc-900/80 app-region-drag">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-between h-16">
            <div className="flex-shrink-0 flex items-center gap-2 app-region-no-drag">
              <button
                type="button"
                onClick={handleSettingsClick}
                className="p-2 rounded-full text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                aria-label="Open settings"
              >
                <Gear className="w-6 h-6" />
              </button>

              <ConnectionIndicator status={status} />

              <DownloadVttButton isDownloadable={isDownloadable} />
            </div>
            <OsControls />
          </div>
        </div>
      </header>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </>
  );
}
