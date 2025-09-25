import React from "react";

/**
 * A component to display a pair of translated and transcribed sentences.
 */
export default function Transcript({
  speaker,
  translation,
  transcription,
  isFinalized = false,
  original,
}) {
  const textOpacity = isFinalized ? "opacity-100" : "opacity-60"; //

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 mb-6 pb-6 border-b border-zinc-200 dark:border-zinc-800 last:border-b-0 last:mb-0 last:pb-0">
      {/* Speaker Name */}
      <div className="font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap text-base sm:text-lg">
        {speaker}:
      </div>

      {/* Text Group */}
      <div className="col-start-2">
        {/* If 'original' exists, display the old text with a strikethrough */}
        {original && (
          <div className="mb-2 border-l-2 border-red-500/50 pl-3">
            <p className="m-0 leading-relaxed text-base sm:text-lg font-medium text-zinc-500 dark:text-zinc-500 line-through">
              {original.translation}
            </p>
            <p className="m-0 leading-relaxed text-sm text-zinc-400 dark:text-zinc-600 line-through">
              {original.transcription}
            </p>
          </div>
        )}

        {/* Display the current or corrected text */}
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
