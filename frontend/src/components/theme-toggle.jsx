import { useTheme } from "../context/theme.jsx";

export default function ThemeToggle() {
  const { darkMode, setDarkMode } = useTheme();

  return (
    <button
      onClick={() => setDarkMode(!darkMode)}
      className="mt-6 px-4 py-2 rounded bg-gray-200 dark:bg-gray-800 text-gray-900 dark:text-gray-100 transition-colors"
    >
      {darkMode ? "Light Mode" : "Dark Mode"}
    </button>
  );
}
