import type { TranscriptionConfig } from "../services/transcriptionService";

/**
 * Maximum number of spoken languages supported by one-way meetings.
 */
export const MAX_ONE_WAY_LANGUAGES = 5;

/**
 * Describes the transcription sessions a meeting needs based on its translation mode.
 */
export type MeetingSessionPlan = {
  languageKey: string;
  config: TranscriptionConfig;
};

/**
 * Deduplicates and normalizes the language codes stored with a meeting.
 */
export function getUniqueMeetingLanguages(languages: unknown): string[] {
  if (!Array.isArray(languages)) {
    return [];
  }

  return Array.from(
    new Set(
      languages
        .filter((language): language is string => typeof language === "string")
        .map((language) => language.trim())
        .filter(Boolean),
    ),
  );
}

/**
 * Builds the Soniox config for one-way translation into a single target language.
 */
export function buildOneWayTranscriptionConfig(targetLanguage: string): TranscriptionConfig {
  return {
    enableSpeakerDiarization: true,
    translation: {
      type: "one_way",
      target_language: targetLanguage,
    },
  };
}

/**
 * Builds the Soniox session plan for the current meeting mode and language set.
 */
export function buildMeetingSessionPlan(
  method: string | null,
  languages: unknown,
): MeetingSessionPlan[] {
  const resolvedMethod = method || "one_way";
  const uniqueLanguages = getUniqueMeetingLanguages(languages);

  if (resolvedMethod === "two_way") {
    const [languageA, languageB] = uniqueLanguages;
    if (!languageA || !languageB) {
      return [];
    }

    return [
      {
        languageKey: "two_way",
        config: {
          enableSpeakerDiarization: true,
          translation: {
            type: "two_way",
            language_a: languageA,
            language_b: languageB,
          },
        },
      },
    ];
  }

  return uniqueLanguages.map((language) => ({
    languageKey: language,
    config: buildOneWayTranscriptionConfig(language),
  }));
}

/**
 * Adds a participant language to a one-way meeting when allowed by the policy cap.
 */
export function addOneWayMeetingLanguage(
  languages: string[],
  userLanguage: string | null | undefined,
) {
  if (!userLanguage || languages.includes(userLanguage)) {
    return {
      languages,
      added: false,
      limitExceeded: false,
    };
  }

  if (languages.length >= MAX_ONE_WAY_LANGUAGES) {
    return {
      languages,
      added: false,
      limitExceeded: true,
    };
  }

  return {
    languages: [...languages, userLanguage],
    added: true,
    limitExceeded: false,
  };
}
