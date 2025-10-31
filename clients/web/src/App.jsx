import React from "react";
import ThemeToggle from "./components/theme-toggle.jsx";
import LanguageToggle from "./components/language-toggle.jsx";
import ConnectionIndicator from "./components/connection-indicator.jsx";
import Transcript from "./components/transcript.jsx";
import Notification from "./components/notification.jsx";
import { useTranscriptStream } from "./hooks/use-transcript-stream.js";
import { useSmartScroll } from "./hooks/use-smart-scroll.js";

export default function App() {
  const { status: transcriptionStatus, transcripts } = useTranscriptStream(
    "/ws/view_transcript",
  );

  const lastTopTextRef = React.useRef(null);
  const notification = useSmartScroll(transcripts, lastTopTextRef);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors">
      <header className="sticky top-0 z-50 w-full bg-white/80 dark:bg-zinc-900/80">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-start h-16">
            <div className="flex-shrink-0 flex items-center gap-2">
              <ConnectionIndicator status={transcriptionStatus} />
              <ThemeToggle />
              <LanguageToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
          {transcripts.map((t, index) => (
            <Transcript
              key={t.id}
              {...t}
              topTextRef={
                index === transcripts.length - 1 ? lastTopTextRef : null
              }
            />
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
