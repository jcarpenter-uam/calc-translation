import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BiCopy, BiCheck } from "react-icons/bi";

export default function ReadableIdDisplay({ id }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between">
      <div>
        <p className="text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wide">
          {t("share_meeting_id") || "Share Meeting ID"}
        </p>
        <p className="text-2xl font-mono font-semibold text-zinc-900 dark:text-zinc-100">
          {id}
        </p>
      </div>
      <button
        onClick={copyToClipboard}
        className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-full transition-colors"
        title={t("copy_to_clipboard")}
      >
        {copied ? (
          <BiCheck className="w-6 h-6" />
        ) : (
          <BiCopy className="w-6 h-6" />
        )}
      </button>
    </div>
  );
}
