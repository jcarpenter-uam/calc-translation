import Redis from "ioredis";
import { env } from "../core/config";
import { logger } from "../core/logger";

export type DerivedTranslationStatus = "ready" | "failed" | "pending";

/**
 * Materialized language-specific transcript entry derived from canonical history.
 */
export interface DerivedTranslationEntry {
  meetingId: string;
  utteranceOrder: number;
  language: string;
  text: string;
  transcriptionText: string | null;
  translationText: string | null;
  sourceLanguage: string | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
  speaker: string | null;
  provider: string;
  status: DerivedTranslationStatus;
  createdAt: string;
}

/**
 * Stores materialized language rows so backfill can avoid retranslating the same utterance.
 */
class MeetingDerivedTranslationStore {
  private redis: Redis | null = null;

  private redisDisabled = false;

  private readonly memoryStore = new Map<string, Map<string, Map<number, DerivedTranslationEntry>>>();

  /**
   * Upserts one materialized derived translation row.
   */
  async upsertEntry(entry: DerivedTranslationEntry) {
    const normalized: DerivedTranslationEntry = {
      ...entry,
      createdAt: entry.createdAt || new Date().toISOString(),
    };

    const redis = await this.getRedisClient();
    if (!redis) {
      const meetingEntries = this.memoryStore.get(entry.meetingId) || new Map();
      const languageEntries = meetingEntries.get(entry.language) || new Map();
      languageEntries.set(entry.utteranceOrder, normalized);
      meetingEntries.set(entry.language, languageEntries);
      this.memoryStore.set(entry.meetingId, meetingEntries);
      return normalized;
    }

    await redis.hset(
      this.languageKey(entry.meetingId, entry.language),
      String(entry.utteranceOrder),
      JSON.stringify(normalized),
    );

    return normalized;
  }

  /**
   * Returns materialized translations for one meeting language ordered by utterance order.
   */
  async getLanguageEntries(meetingId: string, language: string) {
    const redis = await this.getRedisClient();
    if (!redis) {
      const entries = this.memoryStore.get(meetingId)?.get(language);
      if (!entries) {
        return [] as DerivedTranslationEntry[];
      }

      return [...entries.values()].sort((left, right) => left.utteranceOrder - right.utteranceOrder);
    }

    const values = await redis.hvals(this.languageKey(meetingId, language));
    return values
      .map((value) => this.parseEntry(value, meetingId, language))
      .filter((value): value is DerivedTranslationEntry => value !== null)
      .sort((left, right) => left.utteranceOrder - right.utteranceOrder);
  }

  /**
   * Returns the utterance orders already materialized for one meeting language.
   */
  async getMaterializedOrders(meetingId: string, language: string) {
    const entries = await this.getLanguageEntries(meetingId, language);
    return new Set(entries.map((entry) => entry.utteranceOrder));
  }

  /**
   * Clears all derived translation rows for one meeting.
   */
  async clearMeetingHistory(meetingId: string) {
    const redis = await this.getRedisClient();
    if (!redis) {
      this.memoryStore.delete(meetingId);
      return;
    }

    const keys = await redis.keys(`${this.prefix(meetingId)}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
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
      logger.warn("Failed closing derived transcript Redis client cleanly.", { err });
    } finally {
      this.redis = null;
    }
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
        logger.info("Derived transcript cache connected to Redis.");
      } catch (err) {
        logger.warn("Redis unavailable; falling back to in-memory derived transcript cache.", {
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
   * Parses a stored derived translation payload while discarding malformed data.
   */
  private parseEntry(value: string, meetingId: string, language: string) {
    try {
      const parsed = JSON.parse(value) as Partial<DerivedTranslationEntry>;
      const utteranceOrder =
        typeof parsed.utteranceOrder === "number" && Number.isFinite(parsed.utteranceOrder)
          ? parsed.utteranceOrder
          : null;
      if (utteranceOrder === null) {
        return null;
      }

      return {
        meetingId,
        utteranceOrder,
        language,
        text: typeof parsed.text === "string" ? parsed.text : "",
        transcriptionText:
          typeof parsed.transcriptionText === "string" || parsed.transcriptionText === null
            ? parsed.transcriptionText
            : null,
        translationText:
          typeof parsed.translationText === "string" || parsed.translationText === null
            ? parsed.translationText
            : null,
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
        provider: typeof parsed.provider === "string" ? parsed.provider : "unknown",
        status:
          parsed.status === "ready" || parsed.status === "failed" || parsed.status === "pending"
            ? parsed.status
            : "ready",
        createdAt:
          typeof parsed.createdAt === "string" ? parsed.createdAt : new Date().toISOString(),
      } satisfies DerivedTranslationEntry;
    } catch (err) {
      logger.warn("Discarding malformed derived transcript entry.", {
        meetingId,
        language,
        err,
      });
      return null;
    }
  }

  /**
   * Prefix for one meeting's derived translation rows.
   */
  private prefix(meetingId: string) {
    return `meeting_derived_translation:${meetingId}:`;
  }

  /**
   * Redis hash key for one meeting/language's derived translation rows.
   */
  private languageKey(meetingId: string, language: string) {
    return `${this.prefix(meetingId)}${language}`;
  }
}

/**
 * Shared meeting derived translation store instance.
 */
export const meetingDerivedTranslationStore = new MeetingDerivedTranslationStore();
