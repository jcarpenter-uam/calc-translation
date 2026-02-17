import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

export default function SupportFaqContact() {
  const { t } = useTranslation();

  return (
    <>
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
        <span className="font-semibold">{t("policy_questions_title")}</span>
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
    </>
  );
}
