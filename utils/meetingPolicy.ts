import type { TranscriptionConfig } from "../services/transcriptionService";

/**
 * Maximum number of spoken languages supported by one-way meetings.
 */
export const MAX_ONE_WAY_SPOKEN_LANGUAGES = 5;

/**
 * Exact number of spoken languages required by two-way meetings.
 */
export const TWO_WAY_LANGUAGE_COUNT = 2;

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
 * Validates the configured spoken languages for a meeting method.
 */
export function validateSpokenLanguages(method: string | null | undefined, languages: string[]) {
  const resolvedMethod = method || "one_way";

  if (resolvedMethod === "two_way") {
    return {
      ok: languages.length === TWO_WAY_LANGUAGE_COUNT,
      error:
        languages.length === TWO_WAY_LANGUAGE_COUNT
          ? null
          : `Two-way meetings must include exactly ${TWO_WAY_LANGUAGE_COUNT} spoken languages`,
    };
  }

  if (languages.length === 0) {
    return {
      ok: false,
      error: "One-way meetings must include at least 1 spoken language",
    };
  }

  if (languages.length > MAX_ONE_WAY_SPOKEN_LANGUAGES) {
    return {
      ok: false,
      error: `One-way meetings can include at most ${MAX_ONE_WAY_SPOKEN_LANGUAGES} spoken languages`,
    };
  }

  return { ok: true, error: null };
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
  spokenLanguages: unknown,
  viewerLanguages: unknown,
): MeetingSessionPlan[] {
  const resolvedMethod = method || "one_way";
  const uniqueSpokenLanguages = getUniqueMeetingLanguages(spokenLanguages);
  const uniqueViewerLanguages = getUniqueMeetingLanguages(viewerLanguages);

  if (resolvedMethod === "two_way") {
    const [languageA, languageB] = uniqueSpokenLanguages;
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

  return uniqueViewerLanguages.map((language) => ({
    languageKey: language,
    config: buildOneWayTranscriptionConfig(language),
  }));
}

/**
 * Adds a participant language to the persisted one-way viewer language list.
 */
export function addOneWayViewerLanguage(
  languages: string[],
  userLanguage: string | null | undefined,
) {
  if (!userLanguage || languages.includes(userLanguage)) {
    return {
      languages,
      added: false,
    };
  }

  return {
    languages: [...languages, userLanguage],
    added: true,
  };
}
