import { Link } from "react-router-dom";
import Header from "../components/header";
import Footer from "../components/footer";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";

export default function NotFound() {
  return (
    <div className="flex flex-col min-h-screen">
      <Header>
        <ThemeToggle />
        <LanguageToggle />
      </Header>

      <main className="flex-grow flex items-center justify-center container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-md w-full">
          <div className="bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/50 shadow-lg rounded-lg p-6 sm:p-8 text-center">
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
              404 - Page Not Found
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
              This page does not exist. Let's get you back home.
            </p>

            <Link
              to="/"
              className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Go to Home
            </Link>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
