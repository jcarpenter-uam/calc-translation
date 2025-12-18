import React from "react";
import { useTranslation } from "react-i18next";

/**
 * A visual component to display an unauthorized message.
 * @param {{title: string, message: string}} props
 */
export default function Unauthorized({ message }) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-100 dark:bg-zinc-900">
      <div className="w-full max-w-md p-8 m-4 bg-white rounded-lg shadow-lg dark:bg-zinc-800">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-red-600 dark:text-red-500">
            {t("access_denied_title")}
          </h2>
          <p className="mt-4 text-zinc-600 dark:text-zinc-300">
            {message || t("access_denied_default_message")}
          </p>
        </div>
      </div>
    </div>
  );
}
