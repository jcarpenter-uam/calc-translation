import { useTranslation } from "react-i18next";
import { BiMicrophone, BiMicrophoneOff, BiPowerOff } from "react-icons/bi";

export default function HostAudioSender({
  isAudioInitialized,
  isMuted,
  status,
  canvasRef,
  startAudio,
  toggleMute,
  disconnectSession,
}) {
  const { t } = useTranslation();

  if (status === "error") {
    return (
      <div className="text-red-500 text-sm font-bold text-center mt-4">
        {t("audio_connection_error") || "Audio Connection Error"}
      </div>
    );
  }

  if (!isAudioInitialized) {
    return (
      <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
        <button
          onClick={startAudio}
          disabled={status !== "connected"}
          className={`flex items-center gap-2 px-6 py-3 rounded-full shadow-lg font-semibold transition-all transform hover:scale-105 ${
            status !== "connected"
              ? "bg-zinc-400 cursor-not-allowed text-zinc-100"
              : "bg-green-600 hover:bg-green-700 text-white"
          }`}
        >
          <BiMicrophone className="w-5 h-5" />
          {t("join_audio") || "Join Audio"}
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 flex items-center gap-4">
      <button
        onClick={toggleMute}
        className={`relative overflow-hidden flex items-center justify-center gap-3 px-8 py-3 rounded-full shadow-lg font-semibold transition-all transform hover:scale-105 border-2 ${
          isMuted
            ? "border-red-500 bg-red-950/30 text-red-500"
            : "border-green-500 bg-green-950/30 text-white"
        }`}
        style={{ minWidth: "180px" }}
      >
        <canvas
          ref={canvasRef}
          width={200}
          height={50}
          className="absolute inset-0 w-full h-full opacity-50 pointer-events-none"
        />
        <div className="relative z-10 flex items-center gap-2">
          {isMuted ? (
            <BiMicrophoneOff className="w-5 h-5" />
          ) : (
            <BiMicrophone className="w-5 h-5" />
          )}
          <span>{isMuted ? t("unmute") || "Unmute" : t("mute") || "Mute"}</span>
        </div>
      </button>

      <button
        onClick={disconnectSession}
        title={t("end_broadcast") || "End Broadcast"}
        className="p-4 rounded-full shadow-lg bg-zinc-700 hover:bg-red-600 text-white transition-all transform hover:scale-110"
      >
        <BiPowerOff className="w-5 h-5" />
      </button>
    </div>
  );
}
