import { createContext, useContext, useEffect, useState } from "react";

const ThemeContext = createContext();

/**
 * Context for users preffered theme
 * First checks browsers default then defaults to light
 */
export function ThemeProvider({ children }) {
  const [darkMode, setDarkMode] = useState(() => {
    const stored =
      typeof window !== "undefined" && localStorage.getItem("theme");
    if (stored) return stored === "dark";
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      root.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [darkMode]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === "theme" && e.newValue) {
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
