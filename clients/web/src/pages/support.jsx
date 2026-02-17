import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import SupportGettingStarted from "../components/support/getting-started.jsx";
import SupportFaqContact from "../components/support/faq-contact.jsx";

export default function Support() {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl mx-auto w-full">
      <Link
        to="/"
        className="mb-4 inline-block text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
      >
        {t("back_to_home")}
      </Link>
      <article className="prose dark:prose-invert lg:prose-xl">
        <h1>{t("support_title")}</h1>
        <p>{t("support_intro")}</p>

        <SupportGettingStarted />
        <SupportFaqContact />
      </article>
    </div>
  );
}
