import { describe, expect, it } from "bun:test";
import {
  OllamaCloudMeetingSummarizer,
  OllamaSummaryService,
} from "../../services/ollamaSummaryService";

const baseRequest = {
  meetingId: "meeting-1",
  targetLanguage: "en",
  transcriptLanguage: "en",
  meetingTopic: "Weekly Sync",
  utterances: [
    {
      id: "utt-1",
      meetingId: "meeting-1",
      language: "en",
      transcriptionText: "We agreed to ship the feature next week.",
      translationText: null,
      sourceLanguage: "en",
      startedAtMs: 0,
      endedAtMs: 1000,
      speaker: "Speaker: 1",
      createdAt: new Date().toISOString(),
    },
  ],
};

describe("Ollama summary service", () => {
  it("retries transient failures with exponential backoff and returns markdown", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const fetchImpl = (async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response("temporary outage", { status: 503 });
      }

      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              markdown: "# Meeting Summary\n\n## Overview\nDone.\n\n## Key Points\n- Ship next week\n\n## Action Items\n- Confirm rollout\n",
            }),
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;
    const summarizer = new OllamaCloudMeetingSummarizer({
      fetchImpl,
      sleepImpl: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    const service = new OllamaSummaryService(summarizer);
    const markdown = await service.summarizeMeeting(baseRequest);

    expect(attempts).toBe(3);
    expect(delays).toEqual([500, 1000]);
    expect(markdown).toContain("# Meeting Summary");
    expect(markdown).toContain("Ship next week");
  });

  it("does not retry non-retryable client failures", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const fetchImpl = (async () => {
      attempts += 1;
      return new Response("bad request", { status: 400 });
    }) as unknown as typeof fetch;
    const summarizer = new OllamaCloudMeetingSummarizer({
      fetchImpl,
      sleepImpl: async (delayMs) => {
        delays.push(delayMs);
      },
    });

    const service = new OllamaSummaryService(summarizer);

    await expect(service.summarizeMeeting(baseRequest)).rejects.toThrow(
      "Ollama summary failed (400): bad request",
    );
    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
  });
});
