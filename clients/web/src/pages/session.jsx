// This is the new page that displays transcripts

// This is the new page that displays transcripts

import { useParams } from "react-router-dom";
import { useRef } from "react";
import Header from "../components/header";
import Transcript from "../components/transcript.jsx";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";
import DownloadVttButton from "../components/vtt-download.jsx";
import { useTranscriptStream } from "../hooks/use-transcript-stream.js";

export default function SessionPage() {
  const { integration, sessionId } = useParams();
  const wsUrl = `/ws/view/${integration}/${sessionId}`;
  const { transcripts, isDownloadable } = useTranscriptStream(wsUrl);
  const lastTopTextRef = useRef(null);

  return (
    <>
      <Header>
        <ThemeToggle />
        <LanguageToggle />
        <DownloadVttButton isDownloadable={isDownloadable} />
      </Header>

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
    </>
  );
}
