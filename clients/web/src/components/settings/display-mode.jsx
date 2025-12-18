import React from "react";
import { useDisplayMode } from "../../context/display-mode";
import { useTranslation } from "react-i18next";

export default function DisplayMode() {
  const { t } = useTranslation();
  const { displayMode, setDisplayMode } = useDisplayMode();

  const modes = [
    { id: "both", label: t("display_mode_both") },
    { id: "transcript", label: t("display_mode_transcript") },
    { id: "translation", label: t("display_mode_translation") },
  ];

  return (
    <div className="relative">
      <label htmlFor="display-mode-select" className="sr-only">
        {t("display_mode_label")}
      </label>
      <select
        id="display-mode-select"
        value={displayMode}
        onChange={(e) => setDisplayMode(e.target.value)}
        className="
          appearance-none
          bg-zinc-50 dark:bg-zinc-800 
          text-zinc-700 dark:text-zinc-200
          pl-3 pr-8 py-1.5
          border border-zinc-200 dark:border-zinc-700
          rounded-md
          shadow-sm
          text-sm font-medium
          focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-900
          cursor-pointer
          transition-colors
          w-full
        "
      >
        {modes.map((mode) => (
          <option key={mode.id} value={mode.id}>
            {mode.label}
          </option>
        ))}
      </select>

      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-500 dark:text-zinc-400">
        <svg className="h-4 w-4 fill-current" viewBox="0 0 20 20">
          <path
            fillRule="evenodd"
            d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
            clipRule="evenodd"
          />
        </svg>
      </div>
    </div>
  );
}
