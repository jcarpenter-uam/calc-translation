import { useCallback } from "react";
import { useAuth } from "../context/auth";
import { useLanguage } from "../context/language";

export function useLanguageCode() {
  const { user, setUser } = useAuth();
  const { language: uiLanguage, setLanguage: setUiLanguage } = useLanguage();

  const setLanguageCode = useCallback(
    (newLang) => {
      if (user) {
        setUser({ ...user, language_code: newLang });

        fetch("/api/users/me/language", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language_code: newLang }),
        }).catch((err) => {
          console.error("Failed to sync language preference:", err);
        });
      }
    },
    [user, setUser],
  );

  return {
    languageCode: user?.language_code || "en",
    setLanguageCode,
    uiLanguage,
    setUiLanguage,
  };
}
