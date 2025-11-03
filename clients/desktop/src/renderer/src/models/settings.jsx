// popup model for settings
import React from "react";
import { X } from "@phosphor-icons/react/dist/csr/X";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";
import PinToggle from "../components/pinned-toggle.jsx";

// A reusable component for consistent layout within the modal
const SettingsRow = ({ label, children }) => (
  <div className="flex items-center justify-between py-4">
    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
      {label}
    </span>
    <div className="app-region-no-drag">{children}</div>
  </div>
);

export default function SettingsModal({ isOpen, onClose }) {
  if (!isOpen) {
    return null;
  }

  // Prevents closing the modal when clicking inside the panel
  const handlePanelClick = (e) => {
    e.stopPropagation();
  };

  return (
    // Backdrop: Covers the entire screen with a semi-transparent background
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 transition-opacity"
      onClick={onClose} // Click backdrop to close
      aria-modal="true"
      role="dialog"
    >
      {/* Modal Panel: The main settings content */}
      <div
        className="w-full max-w-md overflow-hidden rounded-lg bg-white dark:bg-zinc-900 shadow-2xl app-region-drag"
        onClick={handlePanelClick}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-700/80 p-4">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            Settings
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors app-region-no-drag"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Body: Contains the actual settings toggles */}
        <main className="p-6 divide-y divide-zinc-200/80 dark:divide-zinc-700/80">
          <SettingsRow label="Appearance">
            {/* We assume ThemeToggle is a self-contained component */}
            <ThemeToggle />
          </SettingsRow>
          <SettingsRow label="Always on Top">
            <PinToggle />
          </SettingsRow>
          <SettingsRow label="Language">
            <LanguageToggle />
          </SettingsRow>
          {/* You can add more SettingsRow components here */}
        </main>

        {/* Footer: Contains the "Done" button */}
        <footer className="flex justify-end gap-3 bg-zinc-50 dark:bg-zinc-800/50 p-4">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-900 app-region-no-drag"
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}
