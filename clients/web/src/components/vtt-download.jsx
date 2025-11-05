import React, { useState } from "react";
import { FileArrowDown } from "@phosphor-icons/react/dist/csr/FileArrowDown";
import { SpinnerBall } from "@phosphor-icons/react/dist/csr/SpinnerBall";

const DOWNLOAD_API_URL = "/api/download-vtt";

const DownloadIcon = () => <FileArrowDown size={23} />;

const LoadingIcon = () => <SpinnerBall size={23} />;

/**
 * An icon-button component to download a .vtt transcript file.
 */
function DownloadVttButton({ sessionId }) {
  const [isLoading, setIsLoading] = useState(false);

  const handleDownload = async () => {
    if (isLoading) return;

    setIsLoading(true);

    const downloadUrl = `${DOWNLOAD_API_URL}?sessionId=${sessionId}`;

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
      link.setAttribute("download", `meeting_transcript.vtt`);
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
      disabled={isLoading || !sessionId}
      className="p-2 rounded-full text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label="Download transcript"
    >
      {isLoading ? <LoadingIcon /> : <DownloadIcon />}
    </button>
  );
}

export default DownloadVttButton;
