import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/header/header";
import Footer from "../components/misc/footer";
import ThemeToggle from "../components/header/theme-toggle.jsx";
import Language from "../components/header/language.jsx";

export default function Terms() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col min-h-screen">
      <Header>
        <ThemeToggle />
        <Language />
      </Header>

      <main className="flex-grow container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
          <Link
            to="/"
            className="mb-4 inline-block text-sm text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
          >
            {t("back_to_home")}
          </Link>
          <article className="prose dark:prose-invert lg:prose-xl">
            <h1>{t("terms_title")}</h1>
            <p>
              <span className="font-semibold">{t("internal_use_only")}</span>
            </p>
            <p>
              <span className="font-semibold">{t("effective_date")}</span>
            </p>
            <hr />

            <h2>
              <span className="font-semibold">{t("acceptance_title")}</span>
            </h2>
            <p>{t("terms_intro_1")}</p>
            <p>{t("terms_intro_2")}</p>
            <hr />

            <h2>
              <span className="font-semibold">{t("purpose_grant_title")}</span>
            </h2>
            <p>{t("app_purpose_desc")}</p>
            <p>{t("license_grant")}</p>
            <hr />

            <h2>
              <span className="font-semibold">{t("privacy_data_title")}</span>
            </h2>
            <p>{t("privacy_terms_intro")}</p>
            <ul>
              <li>{t("privacy_point_1")}</li>
              <li>{t("privacy_point_2")}</li>
              <li>{t("privacy_point_3")}</li>
              <li>{t("privacy_point_4")}</li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">{t("user_conduct_title")}</span>
            </h2>
            <p>{t("user_conduct_intro")}</p>
            <ul>
              <li>
                <span className="font-semibold">
                  {t("authorized_use_title")}
                </span>{" "}
                {t("authorized_use_text")}
              </li>
              <li>
                <span className="font-semibold">
                  {t("confidentiality_title")}
                </span>{" "}
                {t("confidentiality_text")}
              </li>
            </ul>
            <p>
              <span className="font-semibold">
                {t("prohibited_actions_title")}
              </span>{" "}
              {t("prohibited_actions_intro")}
            </p>
            <ul>
              <li>{t("prohibited_1")}</li>
              <li>{t("prohibited_2")}</li>
              <li>{t("prohibited_3")}</li>
              <li>{t("prohibited_4")}</li>
              <li>{t("prohibited_5")}</li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">{t("access_info_title")}</span>
            </h2>
            <p>{t("access_data_intro")}</p>
            <ul>
              <li>
                <span className="font-semibold">{t("live_data_title")}</span>{" "}
                {t("live_data_text")}
              </li>
              <li>
                <span className="font-semibold">
                  {t("stored_transcripts_title")}
                </span>{" "}
                {t("stored_transcripts_text")}
              </li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">{t("disclaimer_title")}</span>
            </h2>
            <p>{t("disclaimer_as_is")}</p>
            <p>{t("disclaimer_accuracy")}</p>
            <hr />

            <h2>
              <span className="font-semibold">{t("termination_title")}</span>
            </h2>
            <p>{t("termination_text")}</p>
            <hr />

            <h2>
              <span className="font-semibold">{t("changes_terms_title")}</span>
            </h2>
            <p>{t("changes_terms_text")}</p>
            <hr />

            <h2>
              <span className="font-semibold">{t("contact_info_title")}</span>
            </h2>
            <p>{t("contact_terms_text")}</p>
            <div className="mt-8 text-center not-prose">
              <Link
                to="/"
                className="inline-flex items-center justify-center px-6 py-2 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                {t("go_to_home")}
              </Link>
            </div>
          </article>
        </div>
      </main>

      <Footer />
    </div>
  );
}
