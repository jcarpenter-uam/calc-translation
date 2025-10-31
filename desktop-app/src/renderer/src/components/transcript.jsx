import React from "react";
import { HiOutlineSparkles, HiPencil } from "react-icons/hi";
import { useLanguage } from "../context/language.jsx";

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
 * A component to display a pair of translated and transcribed sentences.
 */
export default function Transcript({
  speaker,
  translation,
  transcription,
  source_language,
  isFinalized = false,
  original,
  correctionStatus,
  topTextRef,
}) {
  const { language: selectedLanguage } = useLanguage();
  const textOpacity = isFinalized ? "opacity-100" : "opacity-60";

  let topText, bottomText, topOriginal, bottomOriginal;

  const isSourceEnglish = source_language === "en";

  const englishText = isSourceEnglish ? transcription : translation;
  const chineseText = isSourceEnglish ? translation : transcription;

  if (selectedLanguage === "english") {
    topText = englishText;
    bottomText = chineseText;
  } else {
    topText = chineseText;
    bottomText = englishText;
  }

  if (original) {
    const originalEnglish = isSourceEnglish
      ? original.transcription
      : original.translation;
    const originalChinese = isSourceEnglish
      ? original.translation
      : original.transcription;

    if (selectedLanguage === "english") {
      topOriginal = originalEnglish;
      bottomOriginal = originalChinese;
    } else {
      topOriginal = originalChinese;
      bottomOriginal = originalEnglish;
    }
  }

  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 mb-6 pb-6 border-b border-zinc-200 dark:border-zinc-800 last:border-b-0 last:mb-0 last:pb-0">
      {/* Speaker Name and Status Icon*/}
      <div className="flex items-center gap-2">
        <div className="font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap text-base sm:text-lg">
          {speaker}:
        </div>
        <CorrectionStatusIndicator status={correctionStatus} />
      </div>

      {/* Text Group */}
      <div className="col-start-2">
        {/* If 'original' exists, display the old text faded and inline */}
        {original && (
          <div className="mb-1 opacity-70">
            <p className="m-0 leading-relaxed text-sm font-medium text-zinc-500 dark:text-zinc-500 line-through">
              {topOriginal}
            </p>
            <p className="m-0 leading-relaxed text-xs text-zinc-400 dark:text-zinc-600 line-through">
              {bottomOriginal}
            </p>
          </div>
        )}

        {/* Display the current or corrected text */}
        <p
          ref={topTextRef}
          className={`m-0 leading-relaxed text-base sm:text-lg font-medium text-zinc-900 dark:text-zinc-100 ${textOpacity}`}
        >
          {topText}
        </p>
        <p
          className={`m-0 leading-relaxed text-sm text-zinc-500 dark:text-zinc-400 ${textOpacity}`}
        >
          {bottomText}
        </p>
      </div>
    </div>
  );
}
