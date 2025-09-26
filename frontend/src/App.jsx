import React, { useRef, useEffect } from "react";
import ThemeToggle from "./components/theme-toggle.jsx";
import ConnectionIndicator from "./components/connection-indicator.jsx";
import Transcript from "./components/transcript.jsx";
import { useTranscriptStream } from "./hooks/use-transcript-stream.js";

export default function App() {
  const { status: transcriptionStatus, transcripts } = useTranscriptStream(
    "/ws/view_transcript",
  );

  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [transcripts]);

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 transition-colors">
      <header className="sticky top-0 z-50 w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-between h-16">
            {/* Stacked Status Indicators */}
            <div className="flex flex-col gap-1">
              <ConnectionIndicator
                status={transcriptionStatus}
                label="Transcription"
              />
            </div>

            {/* Title */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <h1 className="text-lg font-bold sm:text-xl whitespace-nowrap">
                Live Transcription
              </h1>
            </div>

            {/* Theme Toggle */}
            <div className="flex-shrink-0">
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto p-4 sm:p-6 lg:p-8">
        <div className="max-w-3xl mx-auto">
          {/* Map over the transcripts array and render a component for each */}
          {transcripts.map((t) => (
            <Transcript key={t.id} {...t} />
          ))}
          {/* Auto scrolling */}
          <div ref={scrollRef} />
        </div>
      </main>
    </div>
  );
}
