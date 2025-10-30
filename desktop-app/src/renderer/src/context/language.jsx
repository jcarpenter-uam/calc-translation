import React, { createContext, useState, useContext, useEffect } from "react";

const LanguageContext = createContext();

const STORAGE_KEY = "app-language";

function getInitialLanguage() {
  // 1. Check for a saved value in localStorage
  try {
    const storedLanguage = window.localStorage.getItem(STORAGE_KEY);
    if (storedLanguage) {
      return storedLanguage;
    }
  } catch (error) {
    console.error("Error reading from localStorage", error);
  }

  // 2. If no saved value, check the browser's language
  //    'navigator.language' returns codes like "en-US", "en", "zh-CN", "zh"
  const browserLang = window.navigator.language;
  if (browserLang.startsWith("zh")) {
    return "chinese";
  }

  // 3. Fallback to English
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
