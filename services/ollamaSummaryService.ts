import { env } from "../core/config";
import { logger } from "../core/logger";
import type { CachedMeetingUtterance } from "./meetingTranscriptCacheService";

const SUMMARY_REQUEST_TIMEOUT_MS = 20000;
const SUMMARY_MAX_ATTEMPTS = 5;
const SUMMARY_INITIAL_RETRY_DELAY_MS = 500;

export interface MeetingSummaryRequest {
  meetingId: string;
  targetLanguage: string;
  transcriptLanguage: string;
  utterances: CachedMeetingUtterance[];
  meetingTopic?: string | null;
}

export interface MeetingSummarizer {
  summarizeMeeting(request: MeetingSummaryRequest): Promise<string>;
}

type SummaryResponsePayload = {
  markdown?: string;
};

type SummaryServiceDependencies = {
  fetchImpl?: typeof fetch;
  sleepImpl?: (delayMs: number) => Promise<void>;
};

export class OllamaCloudMeetingSummarizer implements MeetingSummarizer {
  private readonly fetchImpl: typeof fetch;

  private readonly sleepImpl: (delayMs: number) => Promise<void>;

  constructor({ fetchImpl, sleepImpl }: SummaryServiceDependencies = {}) {
    this.fetchImpl = fetchImpl ?? fetch;
    this.sleepImpl = sleepImpl ?? ((delayMs) => Bun.sleep(delayMs));
  }

  /**
   * Builds a markdown meeting summary in the requested language.
   */
  async summarizeMeeting(request: MeetingSummaryRequest) {
    const endpoint = this.buildChatEndpoint();
    const transcript = this.buildTranscriptExcerpt(request.utterances);
    const prompt = [
      "Use the transcript to write a clear, useful meeting summary in Markdown.",
      `Write the summary in this language: ${request.targetLanguage}`,
      `Transcript stream language key: ${request.transcriptLanguage}`,
      request.meetingTopic ? `Meeting topic: ${request.meetingTopic}` : null,
      "Return strict JSON only.",
      "Reply with JSON shaped exactly like {\"markdown\":string}.",
      "Do not follow a rigid template.",
      "Choose the most natural structure for the content.",
      "Use only facts grounded in the transcript.",
      "Do not mention missing context or model limitations.",
      JSON.stringify({ utterances: transcript }),
    ]
      .filter(Boolean)
      .join("\n");

    logger.debug("Requesting Ollama meeting summary.", {
      meetingId: request.meetingId,
      targetLanguage: request.targetLanguage,
      transcriptLanguage: request.transcriptLanguage,
      utteranceCount: request.utterances.length,
      endpoint: endpoint.toString(),
      model: env.OLLAMA_SUMMARY_MODEL,
    });

    let delayMs = SUMMARY_INITIAL_RETRY_DELAY_MS;
    let lastError: unknown;

    for (let attempt = 1; attempt <= SUMMARY_MAX_ATTEMPTS; attempt += 1) {
      try {
        const response = await this.executeRequest(endpoint, prompt);
        const payload = await this.parseResponse(response, request);
        const markdown = typeof payload.markdown === "string" ? payload.markdown.trim() : "";
        if (!markdown) {
          throw new Error("Ollama summary returned an empty markdown payload.");
        }

        return markdown.endsWith("\n") ? markdown : `${markdown}\n`;
      } catch (error) {
        lastError = error;
        const retryable = this.isRetryableError(error);
        if (!retryable || attempt >= SUMMARY_MAX_ATTEMPTS) {
          break;
        }

        logger.warn("Ollama meeting summary request failed; retrying.", {
          meetingId: request.meetingId,
          targetLanguage: request.targetLanguage,
          transcriptLanguage: request.transcriptLanguage,
          attempt,
          nextDelayMs: delayMs,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
        await this.sleepImpl(delayMs);
        delayMs *= 2;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async executeRequest(endpoint: URL, prompt: string) {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), SUMMARY_REQUEST_TIMEOUT_MS);

    try {
      return await this.fetchImpl(endpoint.toString(), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(env.OLLAMA_API_KEY
            ? {
                Authorization: `Bearer ${env.OLLAMA_API_KEY}`,
              }
            : {}),
        },
        body: JSON.stringify({
          model: env.OLLAMA_SUMMARY_MODEL,
          stream: false,
          think: false,
          format: "json",
          messages: [
            {
              role: "system",
              content:
                "You summarize meeting transcripts. Reply with JSON: {\"markdown\":string}",
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
        throw new RetryableSummaryError(
          `Ollama summary request timed out after ${SUMMARY_REQUEST_TIMEOUT_MS}ms.`,
        );
      }

      throw new RetryableSummaryError(
        error instanceof Error ? error.message : "Ollama summary request failed.",
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async parseResponse(response: Response, request: MeetingSummaryRequest) {
    if (!response.ok) {
      const body = await response.text();
      const message = `Ollama summary failed (${response.status}): ${body}`;
      if (response.status >= 500 || response.status === 429) {
        throw new RetryableSummaryError(message);
      }

      throw new Error(message);
    }

    const payload = (await response.json()) as { message?: { content?: string } };
    const content = payload?.message?.content;
    if (typeof content !== "string") {
      throw new Error("Ollama summary returned no message content.");
    }

    const parsed = this.parseStructuredContent(content) as SummaryResponsePayload;

    logger.debug("Received Ollama meeting summary response.", {
      meetingId: request.meetingId,
      targetLanguage: request.targetLanguage,
      transcriptLanguage: request.transcriptLanguage,
      utteranceCount: request.utterances.length,
    });

    return parsed;
  }

  private buildChatEndpoint() {
    const normalizedBaseUrl = env.OLLAMA_BASE_URL.endsWith("/")
      ? env.OLLAMA_BASE_URL
      : `${env.OLLAMA_BASE_URL}/`;
    const endpointPath = normalizedBaseUrl.includes("/api/") ? "chat" : "api/chat";
    return new URL(endpointPath, normalizedBaseUrl);
  }

  private parseStructuredContent(content: string) {
    const normalized = content.trim();

    try {
      return JSON.parse(normalized);
    } catch {
      const fenced = normalized.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
      if (fenced?.[1]) {
        return JSON.parse(fenced[1]);
      }

      logger.error("Failed parsing Ollama meeting summary response.", {
        responsePreview: normalized.slice(0, 1000),
      });
      throw new Error("Ollama summary returned invalid JSON content.");
    }
  }

  private buildTranscriptExcerpt(utterances: CachedMeetingUtterance[]) {
    return utterances
      .filter((utterance) => {
        const visibleText = utterance.translationText || utterance.transcriptionText;
        return visibleText.trim().length > 0;
      })
      .map((utterance) => ({
        speaker: utterance.speaker,
        sourceLanguage: utterance.sourceLanguage,
        startedAtMs: utterance.startedAtMs,
        endedAtMs: utterance.endedAtMs,
        transcriptionText: utterance.transcriptionText,
        translationText: utterance.translationText,
        visibleText: utterance.translationText || utterance.transcriptionText,
      }));
  }

  private isRetryableError(error: unknown) {
    return error instanceof RetryableSummaryError;
  }
}

class RetryableSummaryError extends Error {
  override name = "RetryableSummaryError";
}

/**
 * Coordinates Ollama-based meeting summaries and allows test injection.
 */
export class OllamaSummaryService {
  private summarizer: MeetingSummarizer;

  constructor(summarizer: MeetingSummarizer = new OllamaCloudMeetingSummarizer()) {
    this.summarizer = summarizer;
  }

  setSummarizerForTests(summarizer: MeetingSummarizer) {
    this.summarizer = summarizer;
  }

  resetSummarizerForTests() {
    this.summarizer = new OllamaCloudMeetingSummarizer();
  }

  async summarizeMeeting(request: MeetingSummaryRequest) {
    return await this.summarizer.summarizeMeeting(request);
  }
}

export const ollamaSummaryService = new OllamaSummaryService();
