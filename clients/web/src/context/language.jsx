import React, { createContext, useState, useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";

const LanguageContext = createContext();

const STORAGE_KEY_UI = "app-ui-language";
const STORAGE_KEY_TARGET = "app-target-language";

function getInitialLanguage(storageKey) {
  try {
    const storedLanguage = window.localStorage.getItem(storageKey);
    if (storedLanguage) {
      return storedLanguage;
    }
  } catch (error) {
    console.error(`Error reading ${storageKey} from localStorage`, error);
  }

  const browserLang = window.navigator.language;
  if (browserLang.startsWith("zh")) {
    return "zh";
  }

  return "en";
}

export function LanguageProvider({ children }) {
  const [uiLanguage, setUiLanguageState] = useState(() =>
    getInitialLanguage(STORAGE_KEY_UI),
  );
  const [targetLanguage, setTargetLanguageState] = useState(() =>
    getInitialLanguage(STORAGE_KEY_TARGET),
  );

  const { i18n } = useTranslation();

  useEffect(() => {
    i18n.changeLanguage(uiLanguage);
  }, [uiLanguage, i18n]);

  const setUiLanguage = (newLang) => {
    setUiLanguageState(newLang);
    try {
      window.localStorage.setItem(STORAGE_KEY_UI, newLang);
    } catch (error) {
      console.error("Error writing uiLanguage to localStorage", error);
    }
  };

  const setTargetLanguage = (newLang) => {
    setTargetLanguageState(newLang);
    try {
      window.localStorage.setItem(STORAGE_KEY_TARGET, newLang);
    } catch (error) {
      console.error("Error writing targetLanguage to localStorage", error);
    }
  };

  const value = {
    uiLanguage,
    setUiLanguage,
    targetLanguage,
    setTargetLanguage,
  };

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
