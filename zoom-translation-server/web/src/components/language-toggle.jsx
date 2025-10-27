import React from "react";
import { useLanguage } from "../context/language.jsx";

export default function LanguageToggle() {
  const { language, setLanguage } = useLanguage();

  const toggleLanguage = () => {
    const newLanguage = language === "english" ? "chinese" : "english";

    setLanguage(newLanguage);
  };

  return (
    <button
      onClick={toggleLanguage}
      className="p-2 w-10 h-10 flex items-center justify-center rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-900" // Added fixed size for better text display
      aria-label="Toggle language"
    >
      {language === "english" ? (
        /* Show 'EN' because English is currently selected */
        <span className="font-bold text-sm">EN</span>
      ) : (
        /* Show 'Chinese' character because Chinese is currently selected */
        <span className="font-bold text-sm">中</span>
      )}
    </button>
  );
}
