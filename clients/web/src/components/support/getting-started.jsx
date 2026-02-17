import { useTranslation } from "react-i18next";

export default function SupportGettingStarted() {
  const { t } = useTranslation();

  return (
    <>
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
          <span className="font-semibold">{t("step_desktop_1_label")}</span>{" "}
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
          <span className="font-semibold">{t("step_desktop_2_label")}</span>{" "}
          {t("step_desktop_2_text_1")}{" "}
          <span className="font-semibold">{t("step_desktop_2_bold")}</span>{" "}
          {t("step_desktop_2_text_2")}{" "}
          <code>CALC-Translation-Setup-VERSION.exe</code>{" "}
          {t("step_desktop_2_text_3")}
        </li>
        <li>
          <span className="font-semibold">{t("step_desktop_3_label")}</span>{" "}
          {t("step_desktop_3_text")}
        </li>
        <li>
          <span className="font-semibold">{t("step_desktop_4_label")}</span>{" "}
          {t("step_desktop_4_text_1")}{" "}
          <span className="font-semibold">{t("step_desktop_4_bold")}</span>{" "}
          {t("step_desktop_4_text_2")}
        </li>
        <li>{t("step_desktop_5")}</li>
      </ol>

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
            <span className="font-semibold">{t("windows_warning_step_1_bold")}</span>
            .
          </li>
          <li>
            {t("windows_warning_step_2_text_1")}{" "}
            <span className="font-semibold">{t("windows_warning_step_2_bold")}</span>
            {t("windows_warning_step_2_text_2")}
          </li>
        </ol>
        <p className="not-prose text-xs text-blue-600 dark:text-blue-400 mt-2">
          <i>{t("windows_warning_note")}</i>
        </p>
      </div>

      <h2>{t("getting_started_hosts_title")}</h2>

      <h3>1. {t("host_add_title")}</h3>
      <p>{t("host_add_desc")}</p>
      <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 my-4 dark:bg-yellow-900/20 dark:border-yellow-600">
        <p className="text-sm text-yellow-700 dark:text-yellow-200">
          <strong>{t("note_label")}</strong> {t("host_add_note_1")}{" "}
          <strong>{t("host_add_note_bold")}</strong>
          {t("host_add_note_2")}
        </p>
      </div>
      <ol>
        <li>
          {t("host_add_step_1_text")}{" "}
          <strong>{t("host_add_step_1_bold")}</strong>{" "}
          {t("host_add_step_1_text_2")}
        </li>
        <li>{t("host_add_step_2")}</li>
        <li>
          {t("host_add_step_3_text")}{" "}
          <strong>{t("host_add_step_3_bold")}</strong>
        </li>
        <li>{t("host_add_step_4")}</li>
      </ol>
      <p className="text-sm mt-2">
        <em>
          {t("host_install_trouble_1")} <span className="font-semibold">{t("faq_title")}</span>{" "}
          {t("host_install_trouble_2")}
        </em>
      </p>

      <h3>2. {t("host_usage_title")}</h3>
      <p>{t("host_usage_desc")}</p>
      <p>
        <span className="font-semibold">{t("prerequisites_label")}</span>{" "}
        {t("host_usage_prereq")}
      </p>
      <ul>
        <li>
          <span className="font-semibold">{t("host_usage_step_1_label")}</span>{" "}
          {t("host_usage_step_1_text")}
        </li>
        <li>
          <span className="font-semibold">{t("host_usage_step_2_label")}</span>{" "}
          {t("host_usage_step_2_text")}{" "}
          <strong>{t("host_usage_step_2_bold_1")}</strong>
          {t("host_usage_step_2_text_2")}{" "}
          <strong>{t("host_usage_step_2_bold_2")}</strong>.
        </li>
        <li>
          <span className="font-semibold">{t("host_usage_step_3_label")}</span>{" "}
          {t("host_usage_step_3_text")}
        </li>
        <li>
          <span className="font-semibold">{t("host_usage_step_4_label")}</span>{" "}
          {t("host_usage_step_4_text")}
        </li>
      </ul>

      <h3>3. {t("host_remove_title")}</h3>
      <p>{t("host_remove_desc")}</p>
      <ol>
        <li>
          {t("host_remove_step_1_text")}{" "}
          <a
            href="https://marketplace.zoom.us/"
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:underline"
          >
            {t("zoom_marketplace_label")}
          </a>
          .
        </li>
        <li>
          {t("host_remove_step_2_text")}{" "}
          <strong>{t("host_remove_step_2_bold_1")}</strong> &gt;&gt;{" "}
          <strong>{t("host_remove_step_2_bold_2")}</strong>{" "}
          {t("host_remove_step_2_text_2")}
        </li>
        <li>{t("host_remove_step_3")}</li>
        <li>
          {t("host_remove_step_4_text")}{" "}
          <strong>{t("host_remove_step_4_bold")}</strong>.
        </li>
      </ol>
      <p className="font-semibold mt-4">{t("host_remove_implications_title")}</p>
      <ul>
        <li>
          <strong>{t("host_remove_imp_1_bold")}</strong>{" "}
          {t("host_remove_imp_1_text")}
        </li>
        <li>
          <strong>{t("host_remove_imp_2_bold")}</strong>{" "}
          {t("host_remove_imp_2_text")}
        </li>
        <li>
          <strong>{t("host_remove_imp_3_bold")}</strong>{" "}
          {t("host_remove_imp_3_text")}
        </li>
      </ul>
    </>
  );
}
