import { env } from "../core/config";
import { logger } from "../core/logger";
import {
  meetingTranscriptCacheService,
  type CachedMeetingUtterance,
} from "./meetingTranscriptCacheService";

export interface BackfillTranslationRequest {
  sourceText: string;
  sourceLanguage: string | null;
  speaker: string | null;
}

export interface BackfillTranslationResult {
  transcriptionText: string;
  translationText: string | null;
  sourceLanguage: string | null;
}

export interface BackfillTranslator {
  translateBatch(
    meetingId: string,
    targetLanguage: string,
    utterances: BackfillTranslationRequest[],
  ): Promise<BackfillTranslationResult[]>;
}

export interface BackfillHistoryResult {
  meetingId: string;
  language: string;
  entries: CachedMeetingUtterance[];
}

class OllamaCloudTranslator implements BackfillTranslator {
  /**
   * Translates cached transcript utterances with Ollama Cloud.
   */
  async translateBatch(
    meetingId: string,
    targetLanguage: string,
    utterances: BackfillTranslationRequest[],
  ) {
    if (!env.OLLAMA_API_KEY) {
      throw new Error("OLLAMA_API_KEY is required for transcript backfill.");
    }

    const endpoint = this.buildChatEndpoint();
    const prompt = [
      "You translate meeting transcript utterances into one target language.",
      "Return strict JSON only.",
      "Do not merge or split utterances.",
      "Keep speaker names out of translated text.",
      `Target language: ${targetLanguage}`,
      JSON.stringify({ utterances }),
    ].join("\n");

    logger.debug("Requesting Ollama transcript backfill.", {
      meetingId,
      targetLanguage,
      utteranceCount: utterances.length,
      endpoint: endpoint.toString(),
      model: env.OLLAMA_BACKFILL_MODEL,
    });

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), 15000);

    let response: Response;
    try {
      response = await fetch(endpoint.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.OLLAMA_API_KEY}`,
        },
        body: JSON.stringify({
          model: env.OLLAMA_BACKFILL_MODEL,
          stream: false,
          think: false,
          format: "json",
          messages: [
            {
              role: "system",
              content:
                "You are a transcript translation engine. Reply with JSON: {\"translations\":[{\"translationText\":string|null}]}",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
        signal: abortController.signal,
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        throw new Error("Ollama backfill request timed out after 15s.");
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama Cloud backfill failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as { message?: { content?: string } };
    const content = payload?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Ollama Cloud backfill returned no message content.");
    }

    const parsed = this.parseStructuredContent(content) as {
      translations?: Array<{
        translationText?: string | null;
      }>;
    };
    const translations = Array.isArray(parsed.translations) ? parsed.translations : [];

    logger.debug("Received Ollama transcript backfill response.", {
      meetingId,
      targetLanguage,
      utteranceCount: utterances.length,
      translationCount: translations.length,
    });

    return utterances.map((utterance) => {
      const match = translations[0];
      const translatedText =
        typeof match?.translationText === "string" && match.translationText.trim().length > 0
          ? match.translationText.trim()
          : utterance.sourceText;

      return {
        transcriptionText: utterance.sourceText,
        translationText:
          utterance.sourceLanguage === targetLanguage ? null : match?.translationText ?? translatedText,
        sourceLanguage: utterance.sourceLanguage,
      } satisfies BackfillTranslationResult;
    });
  }

  /**
   * Resolves the Ollama chat endpoint regardless of whether the base URL already includes /api.
   */
  private buildChatEndpoint() {
    const normalizedBaseUrl = env.OLLAMA_BASE_URL.endsWith("/")
      ? env.OLLAMA_BASE_URL
      : `${env.OLLAMA_BASE_URL}/`;
    const endpointPath = normalizedBaseUrl.includes("/api/") ? "chat" : "api/chat";
    return new URL(endpointPath, normalizedBaseUrl);
  }

  /**
   * Parses JSON model output while tolerating fenced code blocks.
   */
  private parseStructuredContent(content: string) {
    const normalized = content.trim();

    try {
      return JSON.parse(normalized);
    } catch {
      const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenced?.[1]) {
        return JSON.parse(fenced[1]);
      }

      logger.error("Failed parsing Ollama transcript backfill response.", {
        responsePreview: normalized.slice(0, 1000),
      });
      throw new Error("Ollama backfill returned invalid JSON content.");
    }
  }
}

/**
 * Materializes missing target-language transcript history from cached transcript entries.
 */
class OllamaBackfillService {
  private translator: BackfillTranslator = new OllamaCloudTranslator();

  private readonly inFlight = new Map<string, Promise<BackfillHistoryResult>>();

  /**
   * Allows tests to replace the translation backend.
   */
  setTranslatorForTests(translator: BackfillTranslator) {
    this.translator = translator;
  }

  /**
   * Restores the default Ollama translator after tests.
   */
  resetTranslatorForTests() {
    this.translator = new OllamaCloudTranslator();
  }

  /**
   * Materializes missing transcript history for a target language.
   */
  async backfillMeetingLanguage(
    meetingId: string,
    targetLanguage: string,
    missingUtterances: CachedMeetingUtterance[],
  ) {
    const fingerprint = missingUtterances
      .map((utterance) => this.getTranscriptEntryFingerprint(utterance))
      .join("||");
    const jobKey = `${meetingId}:${targetLanguage}:${fingerprint}`;
    const existingJob = this.inFlight.get(jobKey);
    if (existingJob) {
      return await existingJob;
    }

    const job = this.runBackfill(meetingId, targetLanguage, missingUtterances);
    this.inFlight.set(jobKey, job);

    try {
      return await job;
    } finally {
      if (this.inFlight.get(jobKey) === job) {
        this.inFlight.delete(jobKey);
      }
    }
  }

  /**
   * Computes and stores missing transcript rows for a language.
   */
  private async runBackfill(
    meetingId: string,
    targetLanguage: string,
    missingUtterances: CachedMeetingUtterance[],
  ) {
    const entries = await this.materializeMissingUtterances(
      meetingId,
      targetLanguage,
      this.sortTranscriptHistory(missingUtterances),
    );

    return {
      meetingId,
      language: targetLanguage,
      entries: this.sortTranscriptHistory(entries),
    } satisfies BackfillHistoryResult;
  }

  /**
   * Generates missing target-language cache entries for cached source utterances.
   */
  private async materializeMissingUtterances(
    meetingId: string,
    targetLanguage: string,
    missingUtterances: CachedMeetingUtterance[],
  ) {
    if (missingUtterances.length === 0) {
      return [] as CachedMeetingUtterance[];
    }

    const results: CachedMeetingUtterance[] = [];

    for (const [index, utterance] of missingUtterances.entries()) {
      const sourceLanguage = utterance.sourceLanguage || utterance.language;
      const sourceText = utterance.transcriptionText;

      if (sourceLanguage === targetLanguage) {
        results.push(await this.persistTranslatedEntry(meetingId, targetLanguage, utterance, {
          transcriptionText: sourceText,
          translationText: null,
          sourceLanguage,
        }));
        continue;
      }

      const translated = await this.translator.translateBatch(meetingId, targetLanguage, [
        {
          sourceText,
          sourceLanguage,
          speaker: utterance.speaker,
        },
      ]);

      const translation = translated[0];
      if (!translation) {
        logger.warn("Backfill translator skipped cached transcript utterance.", {
          meetingId,
          targetLanguage,
          startedAtMs: utterance.startedAtMs,
          endedAtMs: utterance.endedAtMs,
        });
        continue;
      }

      results.push(await this.persistTranslatedEntry(meetingId, targetLanguage, utterance, translation));
    }

    return this.sortTranscriptHistory(results);
  }

  /**
   * Writes a translated cache entry while preserving the shared utterance order.
   */
  private async persistTranslatedEntry(
    meetingId: string,
    targetLanguage: string,
    utterance: CachedMeetingUtterance,
    translation: BackfillTranslationResult,
  ) {
    const existingEntries = await meetingTranscriptCacheService.getLanguageHistory(
      meetingId,
      targetLanguage,
    );
    const existing = existingEntries.find(
      (entry) => this.getTranscriptEntryFingerprint(entry) === this.getTranscriptEntryFingerprint(utterance),
    );
    if (existing) {
      return existing;
    }

    return await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId,
      language: targetLanguage,
      transcriptionText: translation.transcriptionText,
      translationText: translation.translationText,
      sourceLanguage: translation.sourceLanguage,
      startedAtMs: utterance.startedAtMs,
      endedAtMs: utterance.endedAtMs,
      speaker: utterance.speaker,
    });
  }

  private sortTranscriptHistory(history: CachedMeetingUtterance[]) {
    return [...history].sort((left, right) => {
      const leftStart = left.startedAtMs ?? Number.MAX_SAFE_INTEGER;
      const rightStart = right.startedAtMs ?? Number.MAX_SAFE_INTEGER;
      if (leftStart !== rightStart) {
        return leftStart - rightStart;
      }

      const leftEnd = left.endedAtMs ?? leftStart;
      const rightEnd = right.endedAtMs ?? rightStart;
      if (leftEnd !== rightEnd) {
        return leftEnd - rightEnd;
      }

      return left.createdAt.localeCompare(right.createdAt);
    });
  }

  private getTranscriptEntryFingerprint(entry: CachedMeetingUtterance) {
    const normalizedText = entry.transcriptionText.trim().toLowerCase();
    return [
      entry.startedAtMs ?? "null",
      entry.endedAtMs ?? "null",
      normalizedText,
    ].join("|");
  }
}

/**
 * Shared Ollama-driven transcript backfill service instance.
 */
export const ollamaBackfillService = new OllamaBackfillService();
