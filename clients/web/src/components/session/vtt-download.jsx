import React, { useState } from "react";
import { useLanguage } from "../../context/language.jsx";
import { useTranslation } from "react-i18next";

/**
 * A button component to download a .vtt transcript file.
 * Renders as a green text button.
 */
function DownloadVttButton({ isDownloadable, integration, sessionId, token }) {
  const [isLoading, setIsLoading] = useState(false);
  const { targetLanguage } = useLanguage();
  const { t } = useTranslation();

  const handleDownload = async () => {
    if (isLoading || !isDownloadable || !integration || !sessionId) return;

    setIsLoading(true);

    const encodedSessionId = encodeURIComponent(sessionId);
    const downloadUrl = `/api/session/${integration}/${encodedSessionId}/download/vtt?token=${token}&language=${targetLanguage}`;

    try {
      const response = await fetch(downloadUrl, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(`Network response was not ok: ${response.statusText}`);
      }

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.setAttribute("download", `meeting_transcript_${targetLanguage}.vtt`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      onClick={handleDownload}
      disabled={isLoading || !isDownloadable}
      className={`
        px-3 py-2 text-xs font-medium rounded-md shadow-sm 
        focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 dark:focus:ring-offset-zinc-900 
        transition-colors cursor-pointer
        ${
          isLoading
            ? "bg-green-500 text-white opacity-75 cursor-wait"
            : "bg-green-600 text-white hover:bg-green-700"
        }
      `}
    >
      {isLoading ? t("downloading") : t("download_transcript")}
    </button>
  );
}

export default DownloadVttButton;
