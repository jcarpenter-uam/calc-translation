import { createContext, useContext, useEffect, useState } from "react";
import log from "electron-log/renderer";

const ThemeContext = createContext();

/**
 * Context for users preffered theme
 * First checks browsers default then defaults to light
 */
export function ThemeProvider({ children }) {
  const [darkMode, setDarkMode] = useState(() => {
    const stored =
      typeof window !== "undefined" && localStorage.getItem("theme");
    if (stored) {
      log.info(`Theme: Found saved theme in localStorage: ${stored}`);
      return stored === "dark";
    }

    const prefersDark =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    log.info(
      `Theme: Using browser preference (prefers-color-scheme): ${
        prefersDark ? "dark" : "light"
      }`,
    );
    return prefersDark;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      log.info("Theme: Applying dark mode");
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      log.info("Theme: Applying light mode");
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [darkMode]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "theme" && e.newValue) {
        log.info(
          `Theme: Detected theme change from another tab/window: ${e.newValue}`,
        );
        setDarkMode(e.newValue === "dark");
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <ThemeContext.Provider value={{ darkMode, setDarkMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
