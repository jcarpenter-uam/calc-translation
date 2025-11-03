import React, { useState } from "react";
import ConnectionIndicator from "./components/connection-indicator.jsx";
import OsControls from "./components/os-controls.jsx";
import Transcript from "./components/transcript.jsx";
import Notification from "./components/notification.jsx";
import { useTranscriptStream } from "./hooks/use-transcript-stream.js";
import { useSmartScroll } from "./hooks/use-smart-scroll.js";
import ResizeHandles from "./components/resize-handles.jsx";
import { Gear } from "@phosphor-icons/react/dist/csr/Gear";
import SettingsModal from "./models/settings.jsx";

export default function App() {
  const { status: transcriptionStatus, transcripts } = useTranscriptStream(
    "wss://translator.my-uam.com/ws/view_transcript",
  );

  const lastTopTextRef = React.useRef(null);
  const notification = useSmartScroll(transcripts, lastTopTextRef);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const handleSettingsClick = () => {
    setIsSettingsOpen(true);
    console.log("Opening settings model");
  };

  return (
    // TODO: Find solution to uniform transparency
    // while still allowing old lines to get hidden behind header
    <div className="min-h-screen bg-white/90 dark:bg-zinc-900/85 text-zinc-900 dark:text-zinc-100 transition-colors">
      <header className="sticky top-0 z-50 w-full bg-white/80 dark:bg-zinc-900/80 app-region-drag">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="relative flex items-center justify-between h-16">
            <div className="flex-shrink-0 flex items-center gap-2 app-region-no-drag">
              <button
                type="button"
                onClick={handleSettingsClick}
                className="p-2 rounded-full text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                aria-label="Open settings"
              >
                <Gear className="w-6 h-6" />
              </button>
              <ConnectionIndicator status={transcriptionStatus} />
            </div>
            <OsControls />
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
      <ResizeHandles />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />
    </div>
  );
}
