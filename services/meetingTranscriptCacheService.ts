import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import Redis from "ioredis";
import { env } from "../core/config";
import { logger } from "../core/logger";

/**
 * Cached final utterance metadata persisted per meeting and language.
 */
export interface CachedMeetingUtterance {
  id: string;
  meetingId: string;
  language: string;
  text: string;
  transcriptionText?: string | null;
  translationText?: string | null;
  sourceLanguage?: string | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
  speaker: string | null;
  createdAt: string;
}

/**
 * Service responsible for caching finalized utterances and flushing them to VTT.
 */
class MeetingTranscriptCacheService {
  private redis: Redis | null = null;

  private redisDisabled = false;

  private readonly memoryStore = new Map<string, Map<string, CachedMeetingUtterance[]>>();

  private readonly outputRoot = resolve(process.cwd(), env.TRANSCRIPT_OUTPUT_DIR);

  /**
   * Appends a finalized utterance to the cache and publishes it for subscribers.
   */
  async appendFinalUtterance(
    utterance: Omit<CachedMeetingUtterance, "id" | "createdAt">,
  ) {
    const entry: CachedMeetingUtterance = {
      ...utterance,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
    };

    const redis = await this.getRedisClient();
    if (!redis) {
      this.appendToMemory(entry);
      return entry;
    }

    const serialized = JSON.stringify(entry);
    await redis
      .multi()
      .rpush(this.historyKey(entry.meetingId, entry.language), serialized)
      .sadd(this.languagesKey(entry.meetingId), entry.language)
      .publish(this.channelKey(entry.meetingId, entry.language), serialized)
      .exec();

    return entry;
  }

  /**
   * Returns cached finalized utterances for a meeting/language pair.
   */
  async getLanguageHistory(meetingId: string, language: string) {
    const redis = await this.getRedisClient();
    if (!redis) {
      return this.getMemoryLanguageHistory(meetingId, language);
    }

    const values = await redis.lrange(this.historyKey(meetingId, language), 0, -1);
    return values
      .map((value) => this.parseCachedUtterance(value, meetingId, language))
      .filter((value): value is CachedMeetingUtterance => value !== null);
  }

  /**
   * Flushes all cached meeting transcripts to per-language VTT files.
   */
  async flushMeetingToVtt(meetingId: string) {
    const histories = await this.getMeetingHistories(meetingId);
    if (histories.size === 0) {
      return [] as string[];
    }

    const meetingDirectory = join(this.outputRoot, meetingId);
    await mkdir(meetingDirectory, { recursive: true });

    const outputPaths: string[] = [];

    for (const [language, utterances] of histories.entries()) {
      const outputPath = join(meetingDirectory, `${this.sanitizeLanguage(language)}.vtt`);
      const content = this.toVtt(utterances);
      await writeFile(outputPath, content, "utf8");
      outputPaths.push(outputPath);
    }

    await this.clearMeetingHistory(meetingId);
    return outputPaths;
  }

  /**
   * Clears all cached transcript data for a meeting.
   */
  async clearMeetingHistory(meetingId: string) {
    const redis = await this.getRedisClient();
    if (!redis) {
      this.memoryStore.delete(meetingId);
      return;
    }

    const languages = await redis.smembers(this.languagesKey(meetingId));
    const keys = languages.map((language) => this.historyKey(meetingId, language));
    if (keys.length > 0) {
      await redis.del(...keys);
    }

    await redis.del(this.languagesKey(meetingId));
  }

  /**
   * Returns the expected transcript output path for a meeting/language pair.
   */
  getTranscriptOutputPath(meetingId: string, language: string) {
    return join(this.outputRoot, meetingId, `${this.sanitizeLanguage(language)}.vtt`);
  }

  /**
   * Lists transcript languages that have already been flushed to disk.
   */
  async listTranscriptLanguages(meetingId: string) {
    try {
      const meetingDirectory = join(this.outputRoot, meetingId);
      const entries = await readdir(meetingDirectory, { withFileTypes: true });

      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".vtt"))
        .map((entry) => entry.name.replace(/\.vtt$/i, ""))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));
    } catch {
      return [] as string[];
    }
  }

  /**
   * Removes transcript artifacts from disk for tests or local cleanup.
   */
  async removeTranscriptArtifacts(meetingId: string) {
    await rm(join(this.outputRoot, meetingId), { recursive: true, force: true });
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
      logger.warn("Failed closing transcript Redis client cleanly.", { err });
    } finally {
      this.redis = null;
    }
  }

  /**
   * Loads every cached language history for a meeting from Redis or memory fallback.
   */
  private async getMeetingHistories(meetingId: string) {
    const redis = await this.getRedisClient();
    if (!redis) {
      return new Map(this.memoryStore.get(meetingId) || []);
    }

    const languages = await redis.smembers(this.languagesKey(meetingId));
    const histories = new Map<string, CachedMeetingUtterance[]>();

    for (const language of languages) {
      histories.set(language, await this.getLanguageHistory(meetingId, language));
    }

    return histories;
  }

  /**
   * Returns in-memory fallback transcript history for one meeting language.
   */
  private getMemoryLanguageHistory(meetingId: string, language: string) {
    return [...(this.memoryStore.get(meetingId)?.get(language) || [])];
  }

  /**
   * Appends a finalized utterance to the in-memory fallback cache.
   */
  private appendToMemory(entry: CachedMeetingUtterance) {
    const meetingHistory = this.memoryStore.get(entry.meetingId) || new Map();
    const utterances = meetingHistory.get(entry.language) || [];
    utterances.push(entry);
    meetingHistory.set(entry.language, utterances);
    this.memoryStore.set(entry.meetingId, meetingHistory);
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
        logger.info("Transcript cache connected to Redis.");
      } catch (err) {
        logger.warn("Redis unavailable; falling back to in-memory transcript cache.", {
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
   * Parses cached transcript entries while discarding malformed payloads.
   */
  private parseCachedUtterance(
    value: string,
    meetingId: string,
    language: string,
  ) {
    try {
      return JSON.parse(value) as CachedMeetingUtterance;
    } catch (err) {
      logger.warn("Discarding malformed cached transcript entry.", {
        meetingId,
        language,
        err,
      });
      return null;
    }
  }

  /**
   * Converts cached utterances into a VTT transcript document.
   */
  private toVtt(utterances: CachedMeetingUtterance[]) {
    const lines = ["WEBVTT", ""];

    utterances.forEach((utterance, index) => {
      const startMs = utterance.startedAtMs ?? utterance.endedAtMs ?? index * 2000;
      const endMs = Math.max(
        startMs + 1,
        utterance.endedAtMs ?? startMs + Math.max(utterance.text.length * 40, 1500),
      );

      lines.push(String(index + 1));
      lines.push(`${this.formatTimestamp(startMs)} --> ${this.formatTimestamp(endMs)}`);
      lines.push(utterance.speaker ? `${utterance.speaker}: ${utterance.text}` : utterance.text);
      lines.push("");
    });

    return `${lines.join("\n")}\n`;
  }

  /**
   * Formats millisecond offsets into WebVTT timestamps.
   */
  private formatTimestamp(totalMs: number) {
    const safeMs = Math.max(0, Math.floor(totalMs));
    const hours = Math.floor(safeMs / 3600000);
    const minutes = Math.floor((safeMs % 3600000) / 60000);
    const seconds = Math.floor((safeMs % 60000) / 1000);
    const milliseconds = safeMs % 1000;

    return [hours, minutes, seconds]
      .map((value) => String(value).padStart(2, "0"))
      .join(":")
      .concat(`.${String(milliseconds).padStart(3, "0")}`);
  }

  /**
   * Redis list key for finalized utterances in one meeting/language stream.
   */
  private historyKey(meetingId: string, language: string) {
    return `meeting_transcript:${meetingId}:${language}`;
  }

  /**
   * Redis set key storing the languages seen for one meeting.
   */
  private languagesKey(meetingId: string) {
    return `meeting_transcript_languages:${meetingId}`;
  }

  /**
   * Redis pub/sub channel used for live transcript fan-out.
   */
  private channelKey(meetingId: string, language: string) {
    return `meeting_transcript_pubsub:${meetingId}:${language}`;
  }

  /**
   * Sanitizes language identifiers before they become transcript filenames.
   */
  private sanitizeLanguage(language: string) {
    return language.replace(/[^a-zA-Z0-9_-]/g, "_") || "unknown";
  }
}

/**
 * Shared meeting transcript cache service instance.
 */
export const meetingTranscriptCacheService = new MeetingTranscriptCacheService();
