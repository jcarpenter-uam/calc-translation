import React from "react";
import { X } from "@phosphor-icons/react/dist/csr/X";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";
import PinToggle from "../components/pinned-toggle.jsx";
import { useLanguage } from "../context/language.jsx";

const SettingsRow = ({ label, children }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
      {label}
    </span>
    <div className="app-region-no-drag">{children}</div>
  </div>
);

export default function SettingsModal({ isOpen, onClose }) {
  const { language } = useLanguage();

  if (!isOpen) {
    return null;
  }

  const handlePanelClick = (e) => {
    e.stopPropagation();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 transition-opacity"
      onClick={onClose}
      aria-modal="true"
      role="dialog"
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-lg bg-white dark:bg-zinc-900 shadow-2xl app-region-drag"
        onClick={handlePanelClick}
      >
        <header className="flex items-center justify-between border-b border-zinc-200/80 dark:border-zinc-700/80 px-4 py-3">
          <h3 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {language === "english" ? "Settings" : "设置"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full text-zinc-600 dark:text-zinc-400 transition-colors app-region-no-drag hover:bg-red-500/90 hover:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
            aria-label={language === "english" ? "Close settings" : "关闭设置"}
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <main className="px-6 py-4 space-y-3">
          <SettingsRow label={language === "english" ? "Appearance" : "外观"}>
            <ThemeToggle />
          </SettingsRow>
          <div className="border-b border-zinc-200/80 dark:border-zinc-700/80 !my-3"></div>
          <SettingsRow label={language === "english" ? "Pin to Top" : "置顶"}>
            <PinToggle />
          </SettingsRow>
          <div className="border-b border-zinc-200/80 dark:border-zinc-700/80 !my-3"></div>
          <SettingsRow label={language === "english" ? "Language" : "语言"}>
            <LanguageToggle />
          </SettingsRow>
        </main>
      </div>
    </div>
  );
}
