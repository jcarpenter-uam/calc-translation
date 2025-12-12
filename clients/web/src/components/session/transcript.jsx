import React from "react";
import { HiOutlineSparkles, HiPencil } from "react-icons/hi";

/**
 * A component to display a visual status if correction is needed.
 */
const CorrectionStatusIndicator = ({ status }) => {
  if (!status) return null;

  switch (status) {
    case "correcting":
      return (
        <HiPencil
          className="h-5 w-5 text-amber-500"
          title="Correction in progress..."
        />
      );
    case "corrected":
      return (
        <HiOutlineSparkles
          className="h-5 w-5 text-purple-500"
          title="This transcript has been contextually corrected."
        />
      );
    default:
      return null;
  }
};

/**
 * A component to display a single sentence in the selected language.
 */
export default function Transcript({
  speaker,
  translation,
  transcription,
  isFinalized = false,
  correctionStatus,
  topTextRef,
}) {
  const textOpacity = isFinalized ? "opacity-100" : "opacity-60";

  return (
    <div className="grid grid-cols-[9rem_1fr] gap-x-3 mb-6 pb-6 border-b border-zinc-200 dark:border-zinc-800 last:border-b-0 last:mb-0 last:pb-0">
      <div className="flex items-center justify-end gap-2">
        <div className="font-semibold text-zinc-900 dark:text-zinc-100 text-right text-base sm:text-lg">
          {speaker}:
        </div>
        <CorrectionStatusIndicator status={correctionStatus} />
      </div>

      {/* TODO: Make this look better */}
      <div className="col-start-2">
        <p
          ref={topTextRef}
          className={`m-0 leading-relaxed text-base sm:text-lg font-medium text-zinc-900 dark:text-zinc-100 ${textOpacity}`}
        >
          {transcription}
        </p>
        <p
          ref={topTextRef}
          className={`m-0 leading-relaxed text-base sm:text-lg font-medium text-zinc-900 dark:text-zinc-100 ${textOpacity}`}
        >
          {translation}
        </p>
      </div>
    </div>
  );
}
