import { env } from "../core/config";
import { logger } from "../core/logger";
import { meetingCanonicalTranscriptService, type CanonicalMeetingUtterance } from "./meetingCanonicalTranscriptService";
import { meetingDerivedTranslationStore, type DerivedTranslationEntry } from "./meetingDerivedTranslationStore";
import { meetingTranscriptCacheService } from "./meetingTranscriptCacheService";

export interface BackfillTranslationRequest {
  utteranceOrder: number;
  sourceText: string;
  sourceLanguage: string | null;
  speaker: string | null;
}

export interface BackfillTranslationResult {
  utteranceOrder: number;
  text: string;
  transcriptionText: string | null;
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
  entries: DerivedTranslationEntry[];
}

class OllamaCloudTranslator implements BackfillTranslator {
  /**
   * Translates canonical utterances with Ollama Cloud.
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
      "Preserve the utteranceOrder values exactly.",
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
                "You are a transcript translation engine. Reply with JSON: {\"translations\":[{\"utteranceOrder\":number,\"text\":string,\"translationText\":string|null}]}",
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
        utteranceOrder?: number;
        text?: string;
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
      const match = translations.find(
        (translation) => translation.utteranceOrder === utterance.utteranceOrder,
      );
      const translatedText =
        typeof match?.text === "string" && match.text.trim().length > 0
          ? match.text.trim()
          : utterance.sourceText;

      return {
        utteranceOrder: utterance.utteranceOrder,
        text: translatedText,
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
 * Materializes missing target-language transcript history from canonical utterances.
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
  async backfillMeetingLanguage(meetingId: string, targetLanguage: string) {
    const jobKey = `${meetingId}:${targetLanguage}`;
    const existingJob = this.inFlight.get(jobKey);
    if (existingJob) {
      return await existingJob;
    }

    const job = this.runBackfill(meetingId, targetLanguage);
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
  private async runBackfill(meetingId: string, targetLanguage: string) {
    const canonicalHistory = await meetingCanonicalTranscriptService.getMeetingHistory(meetingId);
    const existingOrders = await meetingDerivedTranslationStore.getMaterializedOrders(
      meetingId,
      targetLanguage,
    );

    const missingUtterances = canonicalHistory.filter(
      (utterance) => !existingOrders.has(utterance.utteranceOrder),
    );

    await this.materializeMissingUtterances(meetingId, targetLanguage, missingUtterances);
    const entries = await meetingDerivedTranslationStore.getLanguageEntries(
      meetingId,
      targetLanguage,
    );

    return {
      meetingId,
      language: targetLanguage,
      entries: entries.sort((left, right) => left.utteranceOrder - right.utteranceOrder),
    } satisfies BackfillHistoryResult;
  }

  /**
   * Generates derived entries for canonical utterances that do not exist yet.
   */
  private async materializeMissingUtterances(
    meetingId: string,
    targetLanguage: string,
    missingUtterances: CanonicalMeetingUtterance[],
  ) {
    if (missingUtterances.length === 0) {
      return [] as DerivedTranslationEntry[];
    }

    const passthroughUtterances: CanonicalMeetingUtterance[] = [];
    const translatedUtterances: CanonicalMeetingUtterance[] = [];

    for (const utterance of missingUtterances) {
      if (utterance.sourceLanguage && utterance.sourceLanguage === targetLanguage) {
        passthroughUtterances.push(utterance);
      } else {
        translatedUtterances.push(utterance);
      }
    }

    const results: DerivedTranslationEntry[] = [];

    for (const utterance of passthroughUtterances) {
      results.push(await this.persistDerivedEntry(meetingId, targetLanguage, utterance, {
        utteranceOrder: utterance.utteranceOrder,
        text: utterance.sourceText,
        transcriptionText: utterance.sourceText,
        translationText: null,
        sourceLanguage: utterance.sourceLanguage,
      }, "canonical_passthrough"));
    }

    if (translatedUtterances.length > 0) {
      const translated = await this.translator.translateBatch(
        meetingId,
        targetLanguage,
        translatedUtterances.map((utterance) => ({
          utteranceOrder: utterance.utteranceOrder,
          sourceText: utterance.sourceText,
          sourceLanguage: utterance.sourceLanguage,
          speaker: utterance.speaker,
        })),
      );

      const translatedByOrder = new Map(
        translated.map((entry) => [entry.utteranceOrder, entry] as const),
      );

      for (const utterance of translatedUtterances) {
        const translation = translatedByOrder.get(utterance.utteranceOrder);
        if (!translation) {
          logger.warn("Backfill translator skipped canonical utterance.", {
            meetingId,
            targetLanguage,
            utteranceOrder: utterance.utteranceOrder,
          });
          continue;
        }

        results.push(
          await this.persistDerivedEntry(
            meetingId,
            targetLanguage,
            utterance,
            translation,
            "ollama_backfill",
          ),
        );
      }
    }

    return results.sort((left, right) => left.utteranceOrder - right.utteranceOrder);
  }

  /**
   * Writes a derived entry to durable store and transcript cache.
   */
  private async persistDerivedEntry(
    meetingId: string,
    targetLanguage: string,
    utterance: CanonicalMeetingUtterance,
    translation: BackfillTranslationResult,
    provider: string,
  ) {
    const entry = await meetingDerivedTranslationStore.upsertEntry({
      meetingId,
      utteranceOrder: utterance.utteranceOrder,
      language: targetLanguage,
      text: translation.text,
      transcriptionText: translation.transcriptionText,
      translationText: translation.translationText,
      sourceLanguage: translation.sourceLanguage,
      startedAtMs: utterance.startedAtMs,
      endedAtMs: utterance.endedAtMs,
      speaker: utterance.speaker,
      provider,
      status: "ready",
      createdAt: new Date().toISOString(),
    });

    await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId,
      language: targetLanguage,
      text: entry.text,
      utteranceOrder: entry.utteranceOrder,
      transcriptionText: entry.transcriptionText,
      translationText: entry.translationText,
      sourceLanguage: entry.sourceLanguage,
      startedAtMs: entry.startedAtMs,
      endedAtMs: entry.endedAtMs,
      speaker: entry.speaker,
    });

    return entry;
  }
}

/**
 * Shared Ollama-driven transcript backfill service instance.
 */
export const ollamaBackfillService = new OllamaBackfillService();
