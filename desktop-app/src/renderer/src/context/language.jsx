import React, { createContext, useState, useContext, useEffect } from "react";
import log from "electron-log/renderer";

const LanguageContext = createContext();

const STORAGE_KEY = "app-language";

/**
 * Context for per user storage of preffered language with 3 steps for selecting the default.
 * 1. Check for a saved value in localStorage (from previous use)
 * 2. If no saved value, check the browser's language
 * 3. Fallback to English
 */
function getInitialLanguage() {
  try {
    const storedLanguage = window.localStorage.getItem(STORAGE_KEY);
    if (storedLanguage) {
      log.info(
        `Language: Found saved language in localStorage: ${storedLanguage}`,
      );
      return storedLanguage;
    }
  } catch (error) {
    log.error("Language: Error reading from localStorage", error);
  }

  const browserLang = window.navigator.language;
  if (browserLang.startsWith("zh")) {
    log.info(`Language: Detected browser language: chinese`);
    return "chinese";
  }

  log.info(`Language: Falling back to default: english`);
  return "english";
}

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(getInitialLanguage);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
      log.info(
        `Language: Saved language preference to localStorage: ${language}`,
      );
    } catch (error) {
      log.error("Language: Error writing to localStorage", error);
    }
  }, [language]);

  const value = { language, setLanguage };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (context === undefined) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
