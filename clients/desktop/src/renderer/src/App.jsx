import React from "react";
import Transcript from "./components/transcript.jsx";
import Notification from "./components/notification.jsx";
import { useTranscriptStream } from "./hooks/use-transcript-stream.js";
import { useSmartScroll } from "./hooks/use-smart-scroll.js";
import Titlebar from "./components/titlebar.jsx";

export default function App() {
  const {
    status: transcriptionStatus,
    transcripts,
    isDownloadable,
  } = useTranscriptStream("wss://translator.my-uam.com/ws/view_transcript");

  const lastTopTextRef = React.useRef(null);
  const notification = useSmartScroll(transcripts, lastTopTextRef);

  return (
    <div className="min-h-screen bg-white/90 dark:bg-zinc-900/85 text-zinc-900 dark:text-zinc-100 transition-colors">
      <Titlebar status={transcriptionStatus} isDownloadable={isDownloadable} />

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
