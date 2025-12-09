import { useEffect, useCallback } from "react";
import { useAuth } from "../context/auth";
import { useLanguage } from "../context/language";

export function useLanguageCode() {
  const { user } = useAuth();
  const { language, setLanguage: setLocalLanguage } = useLanguage();

  useEffect(() => {
    if (user?.language_code && user.language_code !== language) {
      setLocalLanguage(user.language_code);
    }
  }, [user]);

  const setLanguage = useCallback(
    (newLang) => {
      setLocalLanguage(newLang);

      if (user) {
        fetch("/api/users/me/language", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ language_code: newLang }),
        }).catch((err) => {
          console.error("Failed to sync language preference:", err);
        });
      }
    },
    [user, setLocalLanguage],
  );

  return { language, setLanguage };
}
