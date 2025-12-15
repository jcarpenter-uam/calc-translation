import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/header/header";
import Footer from "../components/misc/footer";
import Language from "../components/header/language.jsx";

export default function Privacy() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col min-h-screen">
      <Header>
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
            <h1>{t("privacy_title")}</h1>
            <p>
              <span className="font-semibold">{t("internal_use_only")}</span>
            </p>
            <p>
              <span className="font-semibold">{t("effective_date")}</span>
            </p>
            <hr />

            <h2>
              <span className="font-semibold">{t("purpose_title")}</span>
            </h2>
            <p>{t("privacy_policy_intro")}</p>
            <p>{t("app_purpose_desc")}</p>
            <hr />

            <h2>
              <span className="font-semibold">{t("info_process_title")}</span>
            </h2>
            <p>{t("info_process_intro")}</p>
            <ul>
              <li>
                <span className="font-semibold">{t("data_audio_title")}</span>{" "}
                {t("data_audio_desc")}
              </li>
              <li>
                <span className="font-semibold">{t("data_user_id_title")}</span>{" "}
                {t("data_user_id_desc")}
              </li>
              <li>
                <span className="font-semibold">
                  {t("data_transcription_title")}
                </span>{" "}
                {t("data_transcription_desc")}
              </li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">{t("data_sharing_title")}</span>
            </h2>
            <p>{t("no_selling_data")}</p>
            <p>{t("third_party_requirement")}</p>
            <ul>
              <li>
                <span className="font-semibold">
                  {t("service_provider_title")}
                </span>{" "}
                {t("service_provider_text")}{" "}
                <a href="https://soniox.com">Soniox</a>{" "}
                {t("service_provider_role")}
              </li>
              <li>
                <span className="font-semibold">{t("data_shared_title")}</span>{" "}
                {t("data_shared_text")}
              </li>
              <li>
                <span className="font-semibold">
                  {t("sharing_purpose_title")}
                </span>{" "}
                {t("sharing_purpose_text")}
              </li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">
                {t("storage_security_title")}
              </span>
            </h2>
            <ul>
              <li>
                <span className="font-semibold">{t("data_storage_title")}</span>{" "}
                {t("data_storage_text")}
              </li>
              <li>
                <span className="font-semibold">
                  {t("data_retention_title")}
                </span>{" "}
                {t("data_retention_text")}
              </li>
              <li>
                <span className="font-semibold">{t("security_title")}</span>{" "}
                {t("security_text")}
              </li>
            </ul>
            <hr />

            <h2>
              <span className="font-semibold">{t("access_info_title")}</span>
            </h2>
            <p>{t("access_control_intro")}</p>
            <ul>
              <li>
                <span className="font-semibold">
                  {t("app_installation_title")}
                </span>{" "}
                {t("app_installation_text")}
              </li>
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
              <span className="font-semibold">{t("user_rights_title")}</span>
            </h2>
            <p>{t("user_rights_text_1")}</p>
            <p>{t("user_rights_text_2")}</p>
            <hr />

            <h2>
              <span className="font-semibold">{t("policy_changes_title")}</span>
            </h2>
            <p>{t("policy_changes_text")}</p>
            <hr />

            <h2>
              <span className="font-semibold">{t("contact_info_title")}</span>
            </h2>
            <p>{t("contact_info_text")}</p>
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
