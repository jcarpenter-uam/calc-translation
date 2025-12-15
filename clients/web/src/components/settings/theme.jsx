import React from "react";
import { useTheme } from "../../context/theme.jsx";

export default function Theme() {
  const { darkMode, setDarkMode } = useTheme();

  return (
    <select
      value={darkMode ? "Dark" : "Light"}
      onChange={(e) => setDarkMode(e.target.value === "Dark")}
      className="
        bg-zinc-50 
        dark:bg-zinc-800 
        border border-zinc-200 
        dark:border-zinc-700 
        text-sm 
        text-zinc-700
        dark:text-zinc-200
        rounded-md 
        px-3 py-1.5
        focus:ring-2 
        focus:ring-blue-500 
        outline-none
        cursor-pointer
        transition-colors
      "
    >
      <option value="Light">Light</option>
      <option value="Dark">Dark</option>
    </select>
  );
}
