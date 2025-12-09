import React, { createContext, useState, useContext, useEffect } from "react";
import { useAuth } from "./auth";

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
  const { user } = useAuth();

  useEffect(() => {
    if (user?.language_code && user.language_code !== language) {
      setLanguageState(user.language_code);
    }
  }, [user]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, language);
    } catch (error) {
      console.error("Error writing to localStorage", error);
    }
  }, [language]);

  const setLanguage = (newLanguage) => {
    setLanguageState(newLanguage);

    if (user) {
      fetch("/api/users/me/language", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language_code: newLanguage }),
      }).catch((err) => {
        console.error("Failed to sync language preference to DB:", err);
      });
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
