import Transcript from "./transcript.jsx";

export default function TranscriptList({
  transcripts,
  isBackfilling,
  isDownloadable,
  lastTopTextRef,
  isSharedTwoWayMode,
  targetLanguage,
}) {
  return transcripts
    .filter((item) => !isBackfilling || !item.isBackfill)
    .map((item, index, array) => (
      <Transcript
        key={item.id}
        {...item}
        topTextRef={
          !isDownloadable && index === array.length - 1 ? lastTopTextRef : null
        }
        forceBothLanguages={isSharedTwoWayMode}
        preferredLanguage={targetLanguage}
      />
    ));
}
