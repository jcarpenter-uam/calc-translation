import Redis from "ioredis";
import { env } from "../core/config";
import { logger } from "../core/logger";

/**
 * Canonical finalized utterance stored once per meeting utterance order.
 */
export interface CanonicalMeetingUtterance {
  meetingId: string;
  utteranceOrder: number;
  sourceText: string;
  sourceLanguage: string | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
  speaker: string | null;
  createdAt: string;
}

/**
 * Input used to register or reuse a canonical finalized utterance.
 */
export interface RegisterCanonicalUtteranceInput {
  meetingId: string;
  text: string;
  language: string;
  transcriptionText?: string | null;
  translationText?: string | null;
  sourceLanguage?: string | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
  speaker: string | null;
}

/**
 * Stores canonical utterances so translated variants can share one meeting order.
 */
class MeetingCanonicalTranscriptService {
  private redis: Redis | null = null;

  private redisDisabled = false;

  private readonly memoryHistory = new Map<string, Map<number, CanonicalMeetingUtterance>>();

  private readonly memoryFingerprintIndex = new Map<string, Map<string, number>>();

  private readonly memoryCounters = new Map<string, number>();

  private readonly meetingLocks = new Map<string, Promise<void>>();

  /**
   * Registers a finalized utterance and returns its stable meeting order.
   */
  async registerUtterance(input: RegisterCanonicalUtteranceInput) {
    return await this.withMeetingLock(input.meetingId, async () => {
      const sourceText = this.resolveSourceText(input);
      const normalized: CanonicalMeetingUtterance = {
        meetingId: input.meetingId,
        utteranceOrder: 0,
        sourceText,
        sourceLanguage: input.sourceLanguage ?? this.fallbackSourceLanguage(input.language),
        startedAtMs: input.startedAtMs,
        endedAtMs: input.endedAtMs,
        speaker: input.speaker,
        createdAt: new Date().toISOString(),
      };
      const fingerprint = this.buildFingerprint(normalized);

      const redis = await this.getRedisClient();
      if (!redis) {
        return this.registerInMemory(input.meetingId, fingerprint, normalized);
      }

      const existingOrder = await redis.hget(this.fingerprintKey(input.meetingId), fingerprint);
      if (existingOrder) {
        const existing = await redis.hget(this.historyKey(input.meetingId), existingOrder);
        if (existing) {
          const parsed = this.parseCanonicalUtterance(existing, input.meetingId, Number(existingOrder));
          if (parsed) {
            return parsed;
          }
        }
      }

      const utteranceOrder = await redis.incr(this.counterKey(input.meetingId));
      const entry: CanonicalMeetingUtterance = {
        ...normalized,
        utteranceOrder,
      };
      const serialized = JSON.stringify(entry);

      await redis
        .multi()
        .hset(this.fingerprintKey(input.meetingId), fingerprint, String(utteranceOrder))
        .hset(this.historyKey(input.meetingId), String(utteranceOrder), serialized)
        .exec();

      return entry;
    });
  }

  /**
   * Returns the canonical utterance history in utterance order.
   */
  async getMeetingHistory(meetingId: string) {
    const redis = await this.getRedisClient();
    if (!redis) {
      const history = this.memoryHistory.get(meetingId);
      if (!history) {
        return [] as CanonicalMeetingUtterance[];
      }

      return [...history.values()].sort((left, right) => left.utteranceOrder - right.utteranceOrder);
    }

    const values = await redis.hvals(this.historyKey(meetingId));
    return values
      .map((value) => this.parseCanonicalUtterance(value, meetingId))
      .filter((value): value is CanonicalMeetingUtterance => value !== null)
      .sort((left, right) => left.utteranceOrder - right.utteranceOrder);
  }

  /**
   * Clears canonical utterance data for a meeting.
   */
  async clearMeetingHistory(meetingId: string) {
    const redis = await this.getRedisClient();
    if (!redis) {
      this.memoryHistory.delete(meetingId);
      this.memoryFingerprintIndex.delete(meetingId);
      this.memoryCounters.delete(meetingId);
      return;
    }

    await redis.del(
      this.historyKey(meetingId),
      this.fingerprintKey(meetingId),
      this.counterKey(meetingId),
    );
  }

  /**
   * Closes the Redis connection if one was opened.
   */
  async shutdown() {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.quit();
    } catch (err) {
      logger.warn("Failed closing canonical transcript Redis client cleanly.", { err });
    } finally {
      this.redis = null;
    }
  }

  /**
   * Serializes registration work per meeting so one spoken utterance gets one order.
   */
  private async withMeetingLock<T>(meetingId: string, work: () => Promise<T>) {
    const previous = this.meetingLocks.get(meetingId) || Promise.resolve();
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.meetingLocks.set(meetingId, previous.then(() => current));

    await previous;

    try {
      return await work();
    } finally {
      release();
      if (this.meetingLocks.get(meetingId) === current) {
        this.meetingLocks.delete(meetingId);
      }
    }
  }

  /**
   * Registers canonical history in the in-memory fallback store.
   */
  private registerInMemory(
    meetingId: string,
    fingerprint: string,
    normalized: CanonicalMeetingUtterance,
  ) {
    const fingerprintIndex = this.memoryFingerprintIndex.get(meetingId) || new Map<string, number>();
    const existingOrder = fingerprintIndex.get(fingerprint);
    if (typeof existingOrder === "number") {
      const existing = this.memoryHistory.get(meetingId)?.get(existingOrder);
      if (existing) {
        return existing;
      }
    }

    const utteranceOrder = (this.memoryCounters.get(meetingId) || 0) + 1;
    this.memoryCounters.set(meetingId, utteranceOrder);

    const entry: CanonicalMeetingUtterance = {
      ...normalized,
      utteranceOrder,
    };

    const history = this.memoryHistory.get(meetingId) || new Map<number, CanonicalMeetingUtterance>();
    history.set(utteranceOrder, entry);
    this.memoryHistory.set(meetingId, history);

    fingerprintIndex.set(fingerprint, utteranceOrder);
    this.memoryFingerprintIndex.set(meetingId, fingerprintIndex);

    return entry;
  }

  /**
   * Uses the canonical source text rather than the translated display text.
   */
  private resolveSourceText(input: RegisterCanonicalUtteranceInput) {
    const sourceText = input.transcriptionText || input.text;
    return sourceText.trim() || input.text.trim();
  }

  /**
   * Falls back to the session language when the source language is known and one-way.
   */
  private fallbackSourceLanguage(language: string) {
    return language === "two_way" ? null : language;
  }

  /**
   * Builds a stable identity for one spoken utterance across translated variants.
   */
  private buildFingerprint(utterance: Omit<CanonicalMeetingUtterance, "meetingId" | "utteranceOrder" | "createdAt">) {
    return JSON.stringify({
      sourceText: utterance.sourceText,
      sourceLanguage: utterance.sourceLanguage,
      startedAtMs: utterance.startedAtMs,
      endedAtMs: utterance.endedAtMs,
      speaker: utterance.speaker,
    });
  }

  /**
   * Lazily connects to Redis and permanently falls back to memory if Redis is unavailable.
   */
  private async getRedisClient() {
    if (!env.REDIS_URL || this.redisDisabled) {
      return null;
    }

    if (!this.redis) {
      this.redis = new Redis(env.REDIS_URL, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
    }

    if (this.redis.status !== "ready") {
      try {
        await this.redis.connect();
        logger.info("Canonical transcript cache connected to Redis.");
      } catch (err) {
        logger.warn("Redis unavailable; falling back to in-memory canonical transcript cache.", {
          err,
        });
        this.redisDisabled = true;

        try {
          await this.redis.quit();
        } catch {
          // Ignore cleanup errors while downgrading to memory storage.
        }

        this.redis = null;
        return null;
      }
    }

    return this.redis;
  }

  /**
   * Parses canonical utterance payloads while discarding malformed data.
   */
  private parseCanonicalUtterance(value: string, meetingId: string, fallbackOrder?: number) {
    try {
      const parsed = JSON.parse(value) as Partial<CanonicalMeetingUtterance>;
      const utteranceOrder =
        typeof parsed.utteranceOrder === "number" && Number.isFinite(parsed.utteranceOrder)
          ? parsed.utteranceOrder
          : fallbackOrder;

      if (!utteranceOrder) {
        return null;
      }

      return {
        meetingId,
        utteranceOrder,
        sourceText: typeof parsed.sourceText === "string" ? parsed.sourceText : "",
        sourceLanguage:
          typeof parsed.sourceLanguage === "string" || parsed.sourceLanguage === null
            ? parsed.sourceLanguage
            : null,
        startedAtMs:
          typeof parsed.startedAtMs === "number" && Number.isFinite(parsed.startedAtMs)
            ? parsed.startedAtMs
            : null,
        endedAtMs:
          typeof parsed.endedAtMs === "number" && Number.isFinite(parsed.endedAtMs)
            ? parsed.endedAtMs
            : null,
        speaker:
          typeof parsed.speaker === "string" || parsed.speaker === null ? parsed.speaker : null,
        createdAt:
          typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      } satisfies CanonicalMeetingUtterance;
    } catch (err) {
      logger.warn("Discarding malformed canonical transcript entry.", {
        meetingId,
        err,
      });
      return null;
    }
  }

  /**
   * Redis hash key storing canonical utterance payloads by utterance order.
   */
  private historyKey(meetingId: string) {
    return `meeting_canonical_transcript:${meetingId}`;
  }

  /**
   * Redis hash key mapping canonical fingerprints to utterance order.
   */
  private fingerprintKey(meetingId: string) {
    return `meeting_canonical_transcript_fingerprint:${meetingId}`;
  }

  /**
   * Redis counter key for canonical utterance order allocation.
   */
  private counterKey(meetingId: string) {
    return `meeting_canonical_transcript_counter:${meetingId}`;
  }
}

/**
 * Shared canonical meeting transcript service instance.
 */
export const meetingCanonicalTranscriptService = new MeetingCanonicalTranscriptService();
