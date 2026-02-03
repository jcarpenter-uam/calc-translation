import React from "react";
import { useLanguageCode } from "../../hooks/use-language-code";

export default function UiLanguageToggle() {
  const { targetLanguage, uiLanguage, setUiLanguage } = useLanguageCode();

  const isUiTranslated =
    uiLanguage === targetLanguage && targetLanguage !== "en";

  const toggleUiLanguage = () => {
    if (isUiTranslated) {
      setUiLanguage("en");
    } else {
      setUiLanguage(targetLanguage);
    }
  };

  return (
    <button
      onClick={toggleUiLanguage}
      type="button"
      role="switch"
      aria-checked={isUiTranslated}
      className={`
        relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent 
        transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2
        ${isUiTranslated ? "bg-green-600" : "bg-red-600"}
      `}
    >
      <span
        aria-hidden="true"
        className={`
          pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 
          transition duration-200 ease-in-out
          ${isUiTranslated ? "translate-x-4" : "translate-x-0"}
        `}
      />
    </button>
  );
}
