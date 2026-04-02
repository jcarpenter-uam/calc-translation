import { logger } from "../core/logger";
import { env } from "../core/config";
import { listDueCalendarSyncGrants } from "./userOAuthGrantService";
import { syncCalendarProviderGrant } from "./userCalendarSyncService";

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const SYNC_WINDOW_PAST_MS = 24 * 60 * 60 * 1000;
const SYNC_WINDOW_FUTURE_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_CONCURRENCY = 2;

/**
 * Background scheduler that performs due provider calendar syncs.
 */
class CalendarAutoSyncService {
  private timer: Timer | null = null;

  private running = false;

  private readonly activeGrantIds = new Set<string>();

  /**
   * Starts the periodic scheduler unless background jobs are disabled.
   */
  start() {
    if (env.DISABLE_BACKGROUND_JOBS || this.timer) {
      return;
    }

    this.scheduleNextRun(1_000);
    logger.info("Background calendar sync scheduler started.");
  }

  /**
   * Stops future polling and waits for the current loop to finish naturally.
   */
  async shutdown() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.running = false;
  }

  /**
   * Executes one polling pass for due grants.
   */
  async runDueSyncs(limit = DEFAULT_BATCH_SIZE) {
    if (this.running) {
      return;
    }

    this.running = true;

    try {
      const dueGrants = await listDueCalendarSyncGrants(limit);
      if (dueGrants.length === 0) {
        return;
      }

      logger.info("Processing due background calendar syncs.", {
        count: dueGrants.length,
      });

      const queue = [...dueGrants];
      const workers = Array.from({ length: DEFAULT_CONCURRENCY }, async () => {
        while (queue.length > 0) {
          const grant = queue.shift();
          if (!grant || this.activeGrantIds.has(grant.id)) {
            continue;
          }

          this.activeGrantIds.add(grant.id);

          try {
            await syncCalendarProviderGrant({
              grantId: grant.id,
              tenantId: grant.tenantId,
              userId: grant.userId,
              provider: grant.provider,
              timeMin: new Date(Date.now() - SYNC_WINDOW_PAST_MS),
              timeMax: new Date(Date.now() + SYNC_WINDOW_FUTURE_MS),
              pruneMode: "window",
            });
          } catch (err) {
            logger.warn("Background calendar sync failed.", {
              grantId: grant.id,
              tenantId: grant.tenantId,
              userId: grant.userId,
              provider: grant.provider,
              err,
            });
          } finally {
            this.activeGrantIds.delete(grant.id);
          }
        }
      });

      await Promise.all(workers);
    } finally {
      this.running = false;
    }
  }

  private scheduleNextRun(delayMs = POLL_INTERVAL_MS) {
    this.timer = setTimeout(async () => {
      try {
        await this.runDueSyncs();
      } finally {
        if (!env.DISABLE_BACKGROUND_JOBS) {
          this.scheduleNextRun();
        }
      }
    }, delayMs);
  }
}

export const calendarAutoSyncService = new CalendarAutoSyncService();
