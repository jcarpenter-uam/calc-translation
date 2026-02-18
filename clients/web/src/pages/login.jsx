import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useLanguage } from "../context/language.jsx";
import { FaMicrosoft, FaGoogle } from "react-icons/fa";
import { API_ROUTES } from "../constants/routes.js";
import { JSON_HEADERS, apiFetch, getErrorMessage } from "../lib/api-client.js";
import ProviderLoginButton from "../components/auth/provider-login-button.jsx";

export default function Login() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [availableProviders, setAvailableProviders] = useState([]);

  const [searchParams] = useSearchParams();
  const { uiLanguage } = useLanguage();

  const [infoMessageKey, setInfoMessageKey] = useState(null);
  useEffect(() => {
    if (searchParams.get("reason") === "zoom_link_required") {
      setInfoMessageKey("zoom_link_info");
    }
  }, [searchParams]);

  const handleLogin = async (e, forcedProvider = null) => {
    if (e) e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const payload = { email, language: uiLanguage };

      if (forcedProvider) {
        payload.provider = forcedProvider;
      }

      const response = await apiFetch(API_ROUTES.auth.login, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error(t("domain_not_configured"));
        }

        throw new Error(
          await getErrorMessage(response, t("login_error_generic")),
        );
      }

      const data = await response.json();

      if (data.action === "select_provider") {
        setAvailableProviders(data.providers);
        setIsLoading(false);
      } else if (data.login_url) {
        window.location.href = data.login_url;
      } else {
        throw new Error(t("invalid_server_response"));
      }
    } catch (err) {
      setError(err.message);
      setIsLoading(false);
      setAvailableProviders([]);
    }
  };

  return (
    <div className="flex-grow flex items-center justify-center container mx-auto p-4 sm:p-6 lg:p-8">
      <div className="max-w-md w-full">
        <div className="bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/50 shadow-lg rounded-lg p-6 sm:p-8">
          <h1 className="text-2xl font-bold text-center text-zinc-900 dark:text-zinc-100 mb-2">
            {t("login")}
          </h1>

          <p className="text-sm text-zinc-600 dark:text-zinc-400 text-center mb-6">
            {availableProviders.length > 0
              ? t("select_provider_hint")
              : t("login_description")}
          </p>

          {infoMessageKey && (
            <div className="mb-4 p-3 text-sm text-blue-600 bg-blue-50 border border-blue-200 rounded-md dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-400">
              {t(infoMessageKey)}
            </div>
          )}

          {availableProviders.length > 0 ? (
            <div className="space-y-3 animate-fade-in">
              {availableProviders.includes("microsoft") && (
                <ProviderLoginButton
                  onClick={() => handleLogin(null, "microsoft")}
                  icon={<FaMicrosoft className="text-[#00a4ef] text-lg" />}
                  label={t("signin_microsoft")}
                />
              )}

              {availableProviders.includes("google") && (
                <ProviderLoginButton
                  onClick={() => handleLogin(null, "google")}
                  icon={<FaGoogle className="text-red-500 text-lg" />}
                  label={t("signin_google")}
                />
              )}

              <button
                onClick={() => {
                  setAvailableProviders([]);
                  setEmail("");
                }}
                className="cursor-pointer block w-full text-center text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 mt-4 underline"
              >
                {t("use_different_email")}
              </button>
            </div>
          ) : (
            <form onSubmit={(e) => handleLogin(e, null)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                  {t("email_label")}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t("email_placeholder")}
                  required
                  disabled={isLoading}
                  className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {error && (
                <div className="p-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded dark:bg-red-900/20 dark:border-red-800 dark:text-red-400 text-center">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={isLoading}
                className="cursor-pointer w-full py-2 px-4 bg-blue-600 text-white font-semibold rounded-md shadow-sm hover:bg-blue-700 focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? t("processing") : t("continue")}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
