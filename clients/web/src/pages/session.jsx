// This is the new page that displays transcripts

import Header from "../components/header";
import Transcript from "../components/transcript.jsx";
import ThemeToggle from "../components/theme-toggle.jsx";
import LanguageToggle from "../components/language-toggle.jsx";
import DownloadVttButton from "../components/vtt-download.jsx";
import { useTranscriptStream } from "../hooks/use-transcript-stream.js";

export default function SessionPage() {
  const { transcripts, isDownloadable } =
    useTranscriptStream("/ws/view/test/test");

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
