import React from "react";
import { useTheme } from "../context/theme.jsx";
import { Sun } from "@phosphor-icons/react/dist/csr/Sun";
import { Moon } from "@phosphor-icons/react/dist/csr/Moon";

/**
 * Button to change between light and dark mode.
 */
export default function ThemeToggle() {
  const { darkMode, setDarkMode } = useTheme();
  const toggle = () => setDarkMode(!darkMode);

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-900"
      aria-label="Toggle theme"
    >
      {darkMode ? (
        /* Sun icon */
        <Sun className="w-5 h-5" />
      ) : (
        /* Moon icon */
        <Moon className="w-5 h-5" />
      )}
    </button>
  );
}
