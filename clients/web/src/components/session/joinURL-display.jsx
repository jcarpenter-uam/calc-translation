import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BiCopy, BiCheck } from "react-icons/bi";

export default function JoinURLDisplay({ joinUrl }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const copyToClipboard = () => {
    if (!joinUrl) return;
    navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!joinUrl) return null;

  return (
    <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-blue-600 dark:text-blue-400 font-bold uppercase tracking-wide mb-1">
          {t("share_join_url") || "Share Join URL"}
        </p>
        <p className="text-sm md:text-base font-mono font-medium text-zinc-900 dark:text-zinc-100 truncate select-all">
          {joinUrl}
        </p>
      </div>
      <button
        onClick={copyToClipboard}
        className="flex-shrink-0 p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800 rounded-full transition-colors"
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
