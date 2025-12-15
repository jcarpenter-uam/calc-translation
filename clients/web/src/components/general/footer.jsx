import { Link } from "react-router-dom";
import { FaGithub, FaEnvelope } from "react-icons/fa";
import { useTranslation } from "react-i18next";

export default function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="w-full border-t border-gray-200 dark:border-gray-700/50 py-6">
      <div className="container mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <p className="text-sm text-gray-500 dark:text-gray-400 order-3 sm:order-1">
            {t("footer_copyright", { year: new Date().getFullYear() })}
          </p>

          <nav className="flex gap-6 order-1 sm:order-2">
            <Link
              to="/support"
              className="text-sm hover:underline text-gray-600 dark:text-gray-300"
            >
              {t("support_link")}
            </Link>
            <Link
              to="/privacy"
              className="text-sm hover:underline text-gray-600 dark:text-gray-300"
            >
              {t("privacy_link")}
            </Link>
            <Link
              to="/terms"
              className="text-sm hover:underline text-gray-600 dark:text-gray-300"
            >
              {t("terms_link")}
            </Link>
          </nav>

          <div className="flex gap-5 order-2 sm:order-3">
            <a
              href="mailto:jcarpenter@uaminc.com"
              aria-label={t("email_aria")}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <FaEnvelope className="h-5 w-5" />
            </a>
            <a
              href="https://github.com/jcarpenter-uam/calc-translation"
              aria-label={t("github_aria")}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              <FaGithub className="h-5 w-5" />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
