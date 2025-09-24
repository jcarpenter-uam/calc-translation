import React, { useState, useEffect } from "react";
import ThemeToggle from "./components/theme-toggle.jsx";
import ConnectionIndicator from "./components/connection-indicator.jsx";
import Transcript from "./components/transcript.jsx";

export default function App() {
  const [transcriptionStatus, setTranscriptionStatus] = useState("connecting");
  const [translationStatus, setTranslationStatus] = useState("connecting");

  // TODO: Implement real logic
  // Effect to cycle through statuses for demonstration purposes
  useEffect(() => {
    const statuses = ["connected", "disconnected", "connecting"];
    let i = 0;
    const interval = setInterval(() => {
      i = (i + 1) % statuses.length;
      setTranscriptionStatus(statuses[i]);

      // Add a slight delay for the second indicator for visual effect
      setTimeout(() => {
        setTranslationStatus(statuses[i]);
      }, 500);
    }, 3000); // Change status every 3 seconds

    return () => clearInterval(interval); // Cleanup on component unmount
  }, []);

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
              <ConnectionIndicator
                status={translationStatus}
                label="Translation"
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
          <Transcript
            speaker="Jane Doe"
            translation="Hola, ¿cómo estás hoy?"
            transcription="Hello, how are you today?"
            isFinalized={true}
          />
          <Transcript
            speaker="John Smith"
            translation="Estoy bien, gracias. ¿Y tú?"
            transcription="I'm doing well, thanks. And you?"
            isFinalized={true}
          />
          <Transcript
            speaker="Jane Doe"
            translation="Estoy un poco cansada, pero bien."
            transcription="I'm a little tired, but I'm good."
            isFinalized={false}
          />
        </div>
      </main>
    </div>
  );
}
