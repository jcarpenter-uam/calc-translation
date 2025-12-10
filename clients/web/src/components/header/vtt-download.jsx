import React, { useState } from "react";
import { FileArrowDown } from "@phosphor-icons/react/dist/csr/FileArrowDown";
import { SpinnerBall } from "@phosphor-icons/react/dist/csr/SpinnerBall";
import { useLanguage } from "../../context/language.jsx";

const DownloadIcon = () => <FileArrowDown size={23} />;

const LoadingIcon = () => <SpinnerBall size={23} />;

/**
 * An icon-button component to download a .vtt transcript file.
 * Becomes green and enabled when isDownloadable is true.
 */
function DownloadVttButton({ isDownloadable, integration, sessionId, token }) {
  const [isLoading, setIsLoading] = useState(false);
  const { language } = useLanguage();

  const handleDownload = async () => {
    if (isLoading || !isDownloadable || !integration || !sessionId) return;

    setIsLoading(true);

    const encodedSessionId = encodeURIComponent(sessionId);
    const downloadUrl = `/api/session/${integration}/${encodedSessionId}/download/vtt?token=${token}&language=${language}`;

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
      link.setAttribute("download", `meeting_transcript_${language}.vtt`);
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

  const baseClasses =
    "p-2 rounded-full focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed transition-colors";

  const activeClasses =
    "bg-green-200 text-green-800 dark:bg-green-700 dark:text-green-100 hover:bg-green-300 dark:hover:bg-green-600";

  const inactiveClasses =
    "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800";

  return (
    <button
      onClick={handleDownload}
      disabled={isLoading || !isDownloadable}
      className={`${baseClasses} ${
        isDownloadable ? activeClasses : inactiveClasses
      }`}
      aria-label={
        isDownloadable
          ? "Download transcript (available for a limited time)"
          : "Download transcript (not yet available)"
      }
    >
      {isLoading ? <LoadingIcon /> : <DownloadIcon />}
    </button>
  );
}

export default DownloadVttButton;
