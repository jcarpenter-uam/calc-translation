import { env } from "../core/config";
import { logger } from "../core/logger";
import {
  meetingTranscriptCacheService,
  type CachedMeetingUtterance,
} from "./meetingTranscriptCacheService";

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
    sourceLanguage: string,
    throughOrder: number,
  ) {
    const jobKey = `${meetingId}:${targetLanguage}:${sourceLanguage}:${throughOrder}`;
    const existingJob = this.inFlight.get(jobKey);
    if (existingJob) {
      return await existingJob;
    }

    const job = this.runBackfill(meetingId, targetLanguage, sourceLanguage, throughOrder);
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
    sourceLanguage: string,
    throughOrder: number,
  ) {
    const sourceHistory = await meetingTranscriptCacheService.getLanguageHistory(
      meetingId,
      sourceLanguage,
    );
    const targetHistory = await meetingTranscriptCacheService.getLanguageHistory(
      meetingId,
      targetLanguage,
    );

    const existingOrders = new Set(
      targetHistory
        .map((entry) => entry.utteranceOrder)
        .filter((order): order is number => typeof order === "number" && Number.isFinite(order)),
    );
    const missingUtterances = sourceHistory.filter((utterance) => {
      const utteranceOrder = utterance.utteranceOrder;
      return typeof utteranceOrder === "number" &&
        Number.isFinite(utteranceOrder) &&
        utteranceOrder <= throughOrder &&
        !existingOrders.has(utteranceOrder);
    });

    const entries = await this.materializeMissingUtterances(
      meetingId,
      targetLanguage,
      missingUtterances,
    );

    return {
      meetingId,
      language: targetLanguage,
      entries: entries.sort((left, right) => {
        const leftOrder = left.utteranceOrder ?? Number.MAX_SAFE_INTEGER;
        const rightOrder = right.utteranceOrder ?? Number.MAX_SAFE_INTEGER;
        return leftOrder - rightOrder;
      }),
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

    const passthroughUtterances: CachedMeetingUtterance[] = [];
    const translatedUtterances: CachedMeetingUtterance[] = [];

    for (const utterance of missingUtterances) {
      const sourceLanguage = utterance.sourceLanguage || utterance.language;
      if (sourceLanguage === targetLanguage) {
        passthroughUtterances.push(utterance);
      } else {
        translatedUtterances.push(utterance);
      }
    }

    const results: CachedMeetingUtterance[] = [];

    for (const utterance of passthroughUtterances) {
      const sourceText = utterance.transcriptionText || utterance.text;
      results.push(await this.persistDerivedEntry(meetingId, targetLanguage, utterance, {
        utteranceOrder: utterance.utteranceOrder || 0,
        text: sourceText,
        transcriptionText: sourceText,
        translationText: null,
        sourceLanguage: utterance.sourceLanguage || utterance.language,
      }));
    }

    if (translatedUtterances.length > 0) {
      const translated = await this.translator.translateBatch(
        meetingId,
        targetLanguage,
        translatedUtterances.map((utterance) => ({
          utteranceOrder: utterance.utteranceOrder || 0,
          sourceText: utterance.transcriptionText || utterance.text,
          sourceLanguage: utterance.sourceLanguage || utterance.language,
          speaker: utterance.speaker,
        })),
      );

      const translatedByOrder = new Map(
        translated.map((entry) => [entry.utteranceOrder, entry] as const),
      );

      for (const utterance of translatedUtterances) {
        const utteranceOrder = utterance.utteranceOrder;
        if (typeof utteranceOrder !== "number" || !Number.isFinite(utteranceOrder)) {
          continue;
        }

        const translation = translatedByOrder.get(utteranceOrder);
        if (!translation) {
          logger.warn("Backfill translator skipped cached transcript utterance.", {
            meetingId,
            targetLanguage,
            utteranceOrder,
          });
          continue;
        }

        results.push(
          await this.persistDerivedEntry(meetingId, targetLanguage, utterance, translation),
        );
      }
    }

    return results.sort((left, right) => {
      const leftOrder = left.utteranceOrder ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.utteranceOrder ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder;
    });
  }

  /**
   * Writes a translated cache entry while preserving the shared utterance order.
   */
  private async persistDerivedEntry(
    meetingId: string,
    targetLanguage: string,
    utterance: CachedMeetingUtterance,
    translation: BackfillTranslationResult,
  ) {
    const utteranceOrder = translation.utteranceOrder || utterance.utteranceOrder;
    if (typeof utteranceOrder !== "number" || !Number.isFinite(utteranceOrder)) {
      throw new Error("Backfill entry is missing a stable utterance order.");
    }

    const existingEntries = await meetingTranscriptCacheService.getLanguageHistory(
      meetingId,
      targetLanguage,
    );
    const existing = existingEntries.find((entry) => entry.utteranceOrder === utteranceOrder);
    if (existing) {
      return existing;
    }

    return await meetingTranscriptCacheService.appendFinalUtterance({
      meetingId,
      language: targetLanguage,
      text: translation.text,
      utteranceOrder,
      transcriptionText: translation.transcriptionText,
      translationText: translation.translationText,
      sourceLanguage: translation.sourceLanguage,
      startedAtMs: utterance.startedAtMs,
      endedAtMs: utterance.endedAtMs,
      speaker: utterance.speaker,
    });
  }
}

/**
 * Shared Ollama-driven transcript backfill service instance.
 */
export const ollamaBackfillService = new OllamaBackfillService();
