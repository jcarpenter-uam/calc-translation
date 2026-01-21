import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  BiMicrophone,
  BiMicrophoneOff,
  BiPowerOff,
  BiLink,
  BiCheck,
  BiQuestionMark,
  BiX,
} from "react-icons/bi";

export default function HostAudioSender({
  isAudioInitialized,
  isMuted,
  status,
  canvasRef,
  startAudio,
  toggleMute,
  disconnectSession,
  joinUrl,
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape" && showHelp) {
        setShowHelp(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showHelp]);

  const handleCopy = async () => {
    if (!joinUrl) return;

    if (window.electronAPI && window.electronAPI.writeToClipboard) {
      await window.electronAPI.writeToClipboard(joinUrl);
    } else {
      await navigator.clipboard.writeText(joinUrl);
    }

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (status === "error") {
    return (
      <div className="text-red-500 text-sm font-bold text-center mt-4">
        {t("audio_connection_error")}
      </div>
    );
  }

  if (status === "disconnected") {
    return null;
  }

  if (!isAudioInitialized) {
    return (
      <div className="fixed bottom-[18px] left-1/2 transform -translate-x-1/2 z-[100]">
        <div className="flex items-center bg-white dark:bg-zinc-800 p-[4px] rounded-full shadow-xl border border-zinc-200 dark:border-zinc-700">
          <button
            onClick={startAudio}
            disabled={status !== "connected"}
            className={`flex items-center gap-2 cursor-pointer relative overflow-hidden px-3 py-1.5 rounded-full transition-colors ${
              status !== "connected"
                ? "text-zinc-400 cursor-not-allowed"
                : "text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
            }`}
          >
            <BiMicrophone size={14} />
            <span className="text-xs font-bold uppercase tracking-wide whitespace-nowrap">
              {t("join_audio")}
            </span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Container for Main Controls + Help Button */}
      <div className="fixed bottom-[18px] left-1/2 transform -translate-x-1/2 z-[100] flex items-center gap-3">
        {/* Audio Controls */}
        <div className="flex items-center gap-[4px] bg-white dark:bg-zinc-800 p-[4px] rounded-full shadow-xl border border-zinc-200 dark:border-zinc-700">
          {/* Mute/Unmute Button */}
          <button
            onClick={toggleMute}
            className={`cursor-pointer relative overflow-hidden p-[6px] rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
              isMuted
                ? "text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
                : "text-green-600 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-700"
            }`}
            title={isMuted ? t("unmute") : t("mute")}
          >
            <canvas
              ref={canvasRef}
              width={32}
              height={32}
              className="absolute inset-0 w-full h-full opacity-30 pointer-events-none"
            />
            <div className="relative z-10">
              {isMuted ? (
                <BiMicrophoneOff size={14} />
              ) : (
                <BiMicrophone size={14} />
              )}
            </div>
          </button>

          <div className="w-[1px] h-[16px] bg-zinc-200 dark:bg-zinc-700 mx-1"></div>

          {/* Copy Join Link Button */}
          <button
            onClick={handleCopy}
            className={`cursor-pointer p-[6px] rounded-full transition-colors ${
              copied
                ? "text-green-600 bg-green-50 dark:bg-green-900/20 dark:text-green-400"
                : "text-blue-600 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-700"
            }`}
            title={t("copy_join_link")}
          >
            {copied ? <BiCheck size={14} /> : <BiLink size={14} />}
          </button>

          <div className="w-[1px] h-[16px] bg-zinc-200 dark:bg-zinc-700 mx-1"></div>

          {/* End Broadcast Button */}
          <button
            onClick={disconnectSession}
            className="cursor-pointer p-[6px] hover:bg-red-50 dark:hover:bg-red-900/20 rounded-full transition-colors text-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
            title={t("end_broadcast")}
          >
            <BiPowerOff size={14} />
          </button>
        </div>

        {/* Help Button */}
        <button
          onClick={() => setShowHelp(true)}
          className="cursor-pointer flex items-center justify-center bg-white dark:bg-zinc-800 w-[34px] h-[34px] rounded-full shadow-xl border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors"
          title={t("help")}
        >
          <BiQuestionMark size={16} />
        </button>
      </div>

      {showHelp && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl max-w-sm w-full border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-zinc-100 dark:border-zinc-800">
              <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100 uppercase tracking-wider">
                {t("host_controls")}
              </h3>
              <button
                onClick={() => setShowHelp(false)}
                className="cursor-pointer p-1 hover:bg-red-100 dark:hover:bg-red-800 rounded-full text-zinc-500 transition-colors"
              >
                <BiX size={20} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="flex items-center gap-4">
                <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded-full text-green-600 dark:text-green-400">
                  <BiMicrophone size={18} />
                </div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {t("mute_toggle")}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="p-2 bg-blue-50 dark:bg-blue-900/20 rounded-full text-blue-600 dark:text-blue-400">
                  <BiLink size={18} />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                    {t("copy_join_link")}
                  </p>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 whitespace-pre-line">
                    {t("copy_link_desc")}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded-full text-red-500">
                  <BiPowerOff size={18} />
                </div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {t("end_broadcast")}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
