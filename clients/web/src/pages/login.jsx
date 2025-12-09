import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import Header from "../components/header";
import Footer from "../components/footer";
import ThemeToggle from "../components/theme-toggle.jsx";
import Language from "../components/language.jsx";
import { useLanguage } from "../context/language.jsx";

export default function Login() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const [infoMessage, setInfoMessage] = useState(null);

  const { language } = useLanguage();

  useEffect(() => {
    const reason = searchParams.get("reason");
    if (reason === "zoom_link_required") {
      sessionStorage.setItem("zoom_link_pending", "true");

      setInfoMessage("Please log in to finish linking your new Zoom account.");
    }
  }, [searchParams]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, language }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "An unknown error occurred.");
      }

      const data = await response.json();

      if (data.login_url) {
        window.location.href = data.login_url;
      } else {
        throw new Error("Could not retrieve login URL.");
      }
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header>
        <ThemeToggle />
        <Language />
      </Header>

      <main className="flex-grow flex items-center justify-center container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-md w-full">
          <div className="bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/50 shadow-lg rounded-lg p-6 sm:p-8">
            <h1 className="text-2xl font-bold text-center text-zinc-900 dark:text-zinc-100 mb-2">
              Login
            </h1>
            <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center mb-6">
              Enter your work email to be redirected to your company's login
              page.
            </p>
            {infoMessage && (
              <div className="text-center text-sm text-blue-600 dark:text-blue-400 mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-700">
                {infoMessage}
              </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
                >
                  Email Address
                </label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="user@your-company.com"
                  required
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:focus:border-blue-500"
                />
              </div>

              {error && (
                <div className="text-red-600 dark:text-red-400 text-sm font-medium text-center">
                  <strong>Error:</strong> {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2 px-4 bg-blue-600 text-white font-semibold rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? "Redirecting..." : "Continue"}
              </button>
            </form>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
