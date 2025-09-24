import ThemeToggle from "./components/theme-toggle.jsx";

export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-900 transition-colors">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
          Tailwind Dark Mode with Context
        </h1>
        <ThemeToggle />
      </div>
    </div>
  );
}
