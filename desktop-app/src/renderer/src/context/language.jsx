import React, { createContext, useState, useContext, useEffect } from "react";

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
      return storedLanguage;
    }
  } catch (error) {
    console.error("Error reading from localStorage", error);
  }

  const browserLang = window.navigator.language;
  if (browserLang.startsWith("zh")) {
    return "chinese";
  }

  return "english";
}

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(getInitialLanguage);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch (error) {
      console.error("Error writing to localStorage", error);
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
