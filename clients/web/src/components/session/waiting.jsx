import { useTranslation } from "react-i18next";

export default function WaitingRoom() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center h-[50vh] text-center p-8 space-y-4">
      <div className="animate-pulse text-6xl">⏳</div>
      <h2 className="text-2xl font-semibold text-gray-700 dark:text-gray-200">
        {t("waiting_title")}
      </h2>
      <p className="text-gray-500 dark:text-gray-400 max-w-md">
        {t("waiting_desc")}
      </p>
    </div>
  );
}
