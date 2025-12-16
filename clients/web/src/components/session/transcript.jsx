import React from "react";
import { useDisplayMode } from "../../context/display-mode";

/**
 * A component to display a single sentence, respecting the user's display mode preference.
 */
export default function Transcript({
  speaker,
  translation,
  transcription,
  isFinalized = false,
  topTextRef,
}) {
  const { displayMode } = useDisplayMode();
  const textOpacity = isFinalized ? "opacity-100" : "opacity-60";

  const primaryTextClass = `m-0 leading-relaxed text-base sm:text-lg font-medium text-zinc-900 dark:text-zinc-100 ${textOpacity}`;
  const secondaryTextClass = `m-0 leading-relaxed text-sm text-zinc-500 dark:text-zinc-400 ${textOpacity}`;

  const renderContent = () => {
    if (displayMode === "transcript") {
      return (
        <p ref={topTextRef} className={primaryTextClass}>
          {transcription}
        </p>
      );
    }

    if (displayMode === "translation") {
      return (
        <p ref={topTextRef} className={primaryTextClass}>
          {translation || transcription}
        </p>
      );
    }

    if (translation) {
      return (
        <>
          <p ref={topTextRef} className={primaryTextClass}>
            {translation}
          </p>
          <p className={secondaryTextClass}>{transcription}</p>
        </>
      );
    }

    return (
      <p ref={topTextRef} className={primaryTextClass}>
        {transcription}
      </p>
    );
  };

  return (
    <div className="grid grid-cols-[9rem_1fr] gap-x-3 mb-6 pb-6 border-b border-zinc-200 dark:border-zinc-800 last:border-b-0 last:mb-0 last:pb-0">
      <div className="flex items-center justify-end gap-2">
        <div className="font-semibold text-zinc-900 dark:text-zinc-100 text-right text-base sm:text-lg">
          {speaker}:
        </div>
      </div>

      <div className="col-start-2 flex flex-col gap-1">{renderContent()}</div>
    </div>
  );
}
