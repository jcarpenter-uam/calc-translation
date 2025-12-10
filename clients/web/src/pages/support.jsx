import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import Header from "../components/header/header";
import Footer from "../components/misc/footer";
import ThemeToggle from "../components/header/theme-toggle.jsx";
import Language from "../components/header/language.jsx";

export default function Support() {
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
            <h1>{t("support_title")}</h1>
            <p>{t("support_intro")}</p>

            <h2>{t("app_function_title")}</h2>
            <p>{t("app_parts_intro")}</p>
            <ul>
              <li>
                <span className="font-semibold">{t("hosts_title")}</span>{" "}
                {t("hosts_desc")}
              </li>
              <li>
                <span className="font-semibold">{t("participants_title")}</span>{" "}
                {t("participants_desc")}
              </li>
            </ul>
            <p>{t("app_usage_summary")}</p>

            <h2>{t("getting_started_participants_title")}</h2>
            <span className="font-semibold">{t("option_1_title")}</span>
            <p>{t("option_1_desc")}</p>
            <ol>
              <li>{t("step_browser_1")}</li>
              <li>{t("step_browser_2")}</li>
              <li>{t("step_browser_3")}</li>
              <li>{t("step_browser_4")}</li>
            </ol>

            <span className="font-semibold">{t("option_2_title")}</span>
            <ol>
              <li>
                <span className="font-semibold">
                  {t("step_desktop_1_label")}
                </span>{" "}
                {t("step_desktop_1_text")}{" "}
                <a
                  href="https://github.com/jcarpenter-uam/calc-translation-desktop/releases/latest"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("step_desktop_1_link")}
                </a>
                .
              </li>
              <li>
                <span className="font-semibold">
                  {t("step_desktop_2_label")}
                </span>{" "}
                {t("step_desktop_2_text_1")}{" "}
                <span className="font-semibold">
                  {t("step_desktop_2_bold")}
                </span>{" "}
                {t("step_desktop_2_text_2")}{" "}
                <code>CALC-Translation-Setup-VERSION.exe</code>{" "}
                {t("step_desktop_2_text_3")}
              </li>
              <li>
                <span className="font-semibold">
                  {t("step_desktop_3_label")}
                </span>{" "}
                {t("step_desktop_3_text")}
              </li>
              <li>
                <span className="font-semibold">
                  {t("step_desktop_4_label")}
                </span>{" "}
                {t("step_desktop_4_text_1")}{" "}
                <span className="font-semibold">
                  {t("step_desktop_4_bold")}
                </span>{" "}
                {t("step_desktop_4_text_2")}
              </li>
              <li>{t("step_desktop_5")}</li>
            </ol>

            {/* Note Block */}
            <div className="p-4 rounded-lg border border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20">
              <p className="font-semibold not-prose text-blue-800 dark:text-blue-200">
                {t("windows_warning_title")}
              </p>
              <p className="not-prose text-sm text-blue-700 dark:text-blue-300">
                {t("windows_warning_desc")}
              </p>
              <ol className="not-prose text-sm text-blue-700 dark:text-blue-300">
                <li>
                  {t("windows_warning_step_1_text")}{" "}
                  <span className="font-semibold">
                    {t("windows_warning_step_1_bold")}
                  </span>
                  .
                </li>
                <li>
                  {t("windows_warning_step_2_text_1")}{" "}
                  <span className="font-semibold">
                    {t("windows_warning_step_2_bold")}
                  </span>
                  {t("windows_warning_step_2_text_2")}
                </li>
              </ol>
              <p className="not-prose text-xs text-blue-600 dark:text-blue-400 mt-2">
                <i>{t("windows_warning_note")}</i>
              </p>
            </div>

            <h2>{t("getting_started_hosts_title")}</h2>
            <p>{t("hosts_responsibility")}</p>
            <ul>
              <li>
                <span className="font-semibold">{t("host_step_1_label")}</span>{" "}
                {t("host_step_1_text")}
              </li>
              <li>
                <span className="font-semibold">{t("host_step_2_label")}</span>{" "}
                {t("host_step_2_text")}
              </li>
              <li>
                <span className="font-semibold">{t("host_step_3_label")}</span>{" "}
                {t("host_step_3_text")}
              </li>
              <li>
                <span className="font-semibold">{t("host_step_4_label")}</span>{" "}
                {t("host_step_4_text")}
              </li>
            </ul>

            <h1>{t("faq_title")}</h1>
            <p>
              <span className="font-semibold">{t("faq_1_q")}</span>
            </p>
            <p>{t("faq_1_a")}</p>

            <p>
              <span className="font-semibold">{t("faq_2_q")}</span>
            </p>
            <p>{t("faq_2_a")}</p>

            <p>
              <span className="font-semibold">{t("faq_3_q")}</span>
            </p>
            <p>{t("faq_3_a")}</p>

            <p>
              <span className="font-semibold">{t("faq_4_q")}</span>
            </p>
            <p>{t("faq_4_a_intro")}</p>
            <ul>
              <li>{t("faq_4_point_1")}</li>
              <li>{t("faq_4_point_2")}</li>
              <li>{t("faq_4_point_3")}</li>
              <li>{t("faq_4_point_4")}</li>
            </ul>

            <p>
              <span className="font-semibold">{t("faq_5_q")}</span>
            </p>
            <p>{t("faq_5_a")}</p>

            <p>
              <span className="font-semibold">{t("faq_6_q")}</span>
            </p>
            <p>{t("faq_6_a")}</p>

            <p>
              <span className="font-semibold">{t("faq_7_q")}</span>
            </p>
            <p>{t("faq_7_a")}</p>

            <h1>{t("direct_support_title")}</h1>
            <p>{t("direct_support_intro")}</p>
            <p>
              <span className="font-semibold">{t("tech_support_title")}</span>
              <br />
              {t("tech_support_desc")}
            </p>
            <ul>
              <li>{t("contact_dev")}</li>
              <li>{t("contact_method")}</li>
            </ul>
            <p>{t("bug_report_details")}</p>
            <ul>
              <li>{t("bug_report_subject")}</li>
              <li>{t("bug_report_date")}</li>
              <li>{t("bug_report_meeting_id")}</li>
              <li>{t("bug_report_desc")}</li>
            </ul>

            <p>
              <span className="font-semibold">
                {t("policy_questions_title")}
              </span>
              <br />
              {t("policy_questions_desc")}
            </p>
            <ul>
              <li>{t("contact_it")}</li>
            </ul>
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
