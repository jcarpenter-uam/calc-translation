import React from "react";

/**
 * A component to display a pair of translated and transcribed sentences.
 * @param {{
 * speaker: string;
 * translation: string;
 * transcription: string;
 * isFinalized: boolean;
 * }} props
 */
export default function Transcript({
  speaker,
  translation,
  transcription,
  isFinalized = false,
}) {
  const textOpacity = isFinalized ? "opacity-100" : "opacity-60";

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 mb-6 pb-6 border-b border-zinc-200 dark:border-zinc-800 last:border-b-0 last:mb-0 last:pb-0">
      {/* Speaker Name */}
      <div className="font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap text-base sm:text-lg">
        {speaker}:
      </div>

      {/* Text Group */}
      <div className="col-start-2">
        <p
          className={`m-0 leading-relaxed text-base sm:text-lg font-medium text-zinc-900 dark:text-zinc-100 ${textOpacity}`}
        >
          {translation}
        </p>
        <p
          className={`m-0 leading-relaxed text-sm text-zinc-500 dark:text-zinc-400 ${textOpacity}`}
        >
          {transcription}
        </p>
      </div>
    </div>
  );
}
