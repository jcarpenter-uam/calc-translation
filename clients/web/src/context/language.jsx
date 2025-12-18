import React, { createContext, useState, useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";

const LanguageContext = createContext();

const STORAGE_KEY = "app-language";

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
    return "zh";
  }

  return "en";
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(getInitialLanguage);
  const { i18n } = useTranslation();

  useEffect(() => {
    i18n.changeLanguage(language);
  }, []);

  const setLanguage = (newLang) => {
    setLanguageState(newLang);
    i18n.changeLanguage(newLang);

    try {
      window.localStorage.setItem(STORAGE_KEY, newLang);
    } catch (error) {
      console.error("Error writing to localStorage", error);
    }
  };

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
