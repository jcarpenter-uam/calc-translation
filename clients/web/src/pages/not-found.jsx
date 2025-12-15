import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function NotFound() {
  const { t } = useTranslation();

  return (
    <div className="max-w-md w-full mx-auto">
      <div className="bg-white dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/50 shadow-lg rounded-lg p-6 sm:p-8 text-center">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 mb-4">
          {t("not_found_title")}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400 mb-6">
          {t("not_found_description")}
        </p>

        <Link
          to="/"
          className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
        >
          {t("go_to_home")}
        </Link>
      </div>
    </div>
  );
}
