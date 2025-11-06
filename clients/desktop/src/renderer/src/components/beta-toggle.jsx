import React, { useState, useEffect } from "react";

export default function BetaToggle() {
  const [isBetaEnabled, setIsBetaEnabled] = useState(false);

  useEffect(() => {
    const savedSetting = localStorage.getItem("betaChannelEnabled");
    const isEnabled = savedSetting === "true";
    setIsBetaEnabled(isEnabled);
  }, []);

  async function handleBetaToggleChange(event) {
    const isBeta = event.target.checked;

    setIsBetaEnabled(isBeta);

    localStorage.setItem("betaChannelEnabled", isBeta);

    try {
      if (window.electron && window.electron.setUpdateChannel) {
        await window.electron.setUpdateChannel(isBeta);
      } else {
        console.error("window.electron.setUpdateChannel is not defined!");
      }
    } catch (error) {
      console.error("Failed to set update channel:", error);
    }
  }

  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        className="sr-only peer"
        checked={isBetaEnabled}
        onChange={handleBetaToggleChange}
      />
      <div className="w-11 h-6 bg-zinc-200 rounded-full peer dark:bg-zinc-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-zinc-600 peer-checked:bg-blue-600"></div>
    </label>
  );
}
