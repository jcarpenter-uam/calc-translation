import React from "react";
import ThemeToggle from "./components/theme-toggle.jsx";
import LanguageToggle from "./components/language-toggle.jsx";
import ConnectionIndicator from "./components/connection-indicator.jsx";
import Transcript from "./components/transcript.jsx";
import Notification from "./components/notification.jsx";
import { useTranscriptStream } from "./hooks/use-transcript-stream.js";
import { useSmartScroll } from "./hooks/use-smart-scroll.js";
import { useLanguage } from "./context/language.jsx";

export default function App() {
  const { status: transcriptionStatus, transcripts } = useTranscriptStream(
    "/ws/view_transcript",
  );

  const notification = useSmartScroll(transcripts);

  const { language } = useLanguage();

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors">
      <header className="sticky top-0 z-50 w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-between h-16">
            <div className="flex flex-col gap-1">
              <ConnectionIndicator
                status={transcriptionStatus}
                label={language === "english" ? "Server" : "服务器"}
              />
            </div>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <h1 className="text-lg font-bold sm:text-xl whitespace-nowrap">
                {language === "english" ? "Live Transcription" : "实时转录"}
              </h1>
            </div>
            <div className="flex-shrink-0 flex items-center gap-2">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
          {transcripts.map((t) => (
            <Transcript key={t.id} {...t} />
          ))}
        </div>
      </main>

      <Notification
        message={notification.message}
        visible={notification.visible}
      />
    </div>
  );
}
