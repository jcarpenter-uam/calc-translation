import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BiCopy, BiCheck, BiLink } from "react-icons/bi";

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
    <div className="fixed top-2 left-1/2 transform -translate-x-1/2 z-[100] h-12 flex items-center gap-3 px-4 pl-3 bg-blue-50/95 dark:bg-blue-900/90 border border-blue-200 dark:border-blue-800 rounded-full shadow-lg backdrop-blur-sm max-w-xl w-auto transition-all">
      {/* Icon / Label Section */}
      <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
        <BiLink className="w-5 h-5 flex-shrink-0" />
        <span className="hidden sm:inline text-xs font-bold uppercase tracking-wider whitespace-nowrap">
          {t("join_link")}:
        </span>
      </div>

      {/* URL Display */}
      <div className="h-6 w-px bg-blue-200 dark:bg-blue-700 mx-1 hidden sm:block"></div>

      <p className="text-sm font-mono font-medium text-zinc-800 dark:text-zinc-100 truncate max-w-[150px] sm:max-w-[250px] select-all">
        {joinUrl}
      </p>

      {/* Copy Button */}
      <button
        onClick={copyToClipboard}
        className={`
          cursor-pointer ml-1 flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200
          ${
            copied
              ? "bg-green-500 text-white shadow-sm scale-110"
              : "bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-zinc-700 shadow-sm"
          }
        `}
        title={t("copy_to_clipboard")}
      >
        {copied ? (
          <BiCheck className="w-5 h-5" />
        ) : (
          <BiCopy className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}
