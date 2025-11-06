import React from "react";
import { useSettings } from "../context/settings.jsx";

export default function BetaToggle() {
  const { isBetaEnabled, setBetaChannel } = useSettings();

  const handleBetaToggleChange = (event) => {
    setBetaChannel(event.target.checked);
  };

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
