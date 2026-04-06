import { basename, extname } from "node:path";
import { and, inArray, isNull } from "drizzle-orm";
import { db } from "../core/database";
import { logger } from "../core/logger";
import { users } from "../models/userModel";
import { graphMailerService, type MailSender } from "./graphMailerService";
import { buildSummaryEmailHtml, renderMarkdownEmail } from "./markdownEmailRenderer";
import { buildMeetingTranscriptFilename } from "../utils/meetingArtifactFilenames";
import { getLanguageLabel } from "../utils/languageLabel";

type MeetingMethod = "one_way" | "two_way";

type LiveParticipant = {
  id: string;
  email: string | null;
  languageCode: string | null;
};

export type MeetingArtifactEmailJob = {
  meetingId: string;
  readableId: string | null;
  topic: string | null;
  hostId: string | null;
  attendeeIds: string[];
  method: MeetingMethod;
  spokenLanguages: string[];
  scheduledTime: Date | string | null;
  startedAt: Date | string | null;
  endedAt: Date | string | null;
  transcriptOutputPaths: string[];
  summaryOutputPaths: string[];
  liveParticipants: LiveParticipant[];
};

type RecipientRow = {
  id: string;
  name: string | null;
  email: string | null;
  languageCode: string | null;
};

type RecipientEmailPayload = {
  recipient: RecipientRow;
  summaryLanguage: string | null;
  transcriptLanguage: string | null;
  summaryPath: string | null;
  transcriptPath: string | null;
};

function normalizeLanguage(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function choosePreferredLanguage(preferredLanguage: string | null, availableLanguages: string[]) {
  const normalizedPreferred = normalizeLanguage(preferredLanguage);
  if (normalizedPreferred && availableLanguages.includes(normalizedPreferred)) {
    return normalizedPreferred;
  }

  return availableLanguages[0] || null;
}

function formatMeetingDateLabel(value: Date | string | null) {
  const fallback = "this meeting";
  if (!value) {
    return fallback;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }

  return parsed.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function resolveRecipientArtifactLanguages({
  method,
  preferredLanguage,
  spokenLanguages,
  availableSummaryLanguages,
  availableTranscriptLanguages,
}: {
  method: MeetingMethod;
  preferredLanguage: string | null;
  spokenLanguages: string[];
  availableSummaryLanguages: string[];
  availableTranscriptLanguages: string[];
}) {
  const summaryLanguage = method === "two_way"
    ? choosePreferredLanguage(
        choosePreferredLanguage(preferredLanguage, spokenLanguages),
        availableSummaryLanguages,
      )
    : choosePreferredLanguage(preferredLanguage, availableSummaryLanguages);

  const transcriptLanguage = method === "two_way"
    ? (availableTranscriptLanguages.includes("two_way")
        ? "two_way"
        : choosePreferredLanguage(preferredLanguage, availableTranscriptLanguages))
    : choosePreferredLanguage(preferredLanguage, availableTranscriptLanguages);

  return {
    summaryLanguage,
    transcriptLanguage,
  };
}

/**
 * Sends per-recipient meeting summaries and transcript attachments after teardown.
 */
export class MeetingArtifactEmailService {
  private mailer: MailSender = graphMailerService;

  private bypassConfigurationCheck = false;

  private pendingJobs = new Set<Promise<void>>();

  setMailerForTests(mailer: MailSender) {
    this.mailer = mailer;
    this.bypassConfigurationCheck = true;
  }

  resetMailerForTests() {
    this.mailer = graphMailerService;
    this.bypassConfigurationCheck = false;
  }

  async awaitIdleForTests() {
    await Promise.allSettled(Array.from(this.pendingJobs));
  }

  enqueueMeetingArtifactEmails(job: MeetingArtifactEmailJob) {
    if (!this.bypassConfigurationCheck && !graphMailerService.isConfigured()) {
      logger.info("Meeting artifact email delivery skipped because mailer is not configured.", {
        meetingId: job.meetingId,
      });
      return;
    }

    const task = this.sendMeetingArtifactEmails(job)
      .catch((error) => {
        logger.error("Meeting artifact email delivery failed.", {
          meetingId: job.meetingId,
          error,
        });
      })
      .finally(() => {
        this.pendingJobs.delete(task);
      });
    this.pendingJobs.add(task);
  }

  private async sendMeetingArtifactEmails(job: MeetingArtifactEmailJob) {
    const recipients = await this.getMeetingRecipients(job);
    if (recipients.length === 0) {
      logger.info("Meeting artifact email delivery skipped because no recipients were found.", {
        meetingId: job.meetingId,
      });
      return;
    }

    const transcriptArtifacts = this.indexArtifacts(job.transcriptOutputPaths, false);
    const summaryArtifacts = this.indexArtifacts(job.summaryOutputPaths, true);
    const availableTranscriptLanguages = Array.from(transcriptArtifacts.keys()).sort();
    const availableSummaryLanguages = Array.from(summaryArtifacts.keys()).sort();

    const results = await Promise.allSettled(
      recipients.map(async (recipient) => {
        const payload = this.buildRecipientPayload({
          recipient,
          job,
          availableSummaryLanguages,
          availableTranscriptLanguages,
          summaryArtifacts,
          transcriptArtifacts,
        });

        if (!payload.summaryPath || !payload.transcriptPath || !recipient.email) {
          logger.warn("Skipping meeting artifact email because required artifacts were missing.", {
            meetingId: job.meetingId,
            recipientId: recipient.id,
            recipientEmail: recipient.email,
            summaryLanguage: payload.summaryLanguage,
            transcriptLanguage: payload.transcriptLanguage,
          });
          return;
        }

        await this.sendRecipientEmail(job, payload);
      }),
    );

    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        return;
      }

      const recipient = recipients[index];
      logger.error("Meeting artifact email delivery failed for recipient.", {
        meetingId: job.meetingId,
        recipientId: recipient?.id || null,
        recipientEmail: recipient?.email || null,
        error: result.reason,
      });
    });
  }

  private async getMeetingRecipients(job: MeetingArtifactEmailJob) {
    const participantIds = Array.from(
      new Set([job.hostId, ...job.attendeeIds].filter(Boolean) as string[]),
    );
    if (participantIds.length === 0) {
      return [] as RecipientRow[];
    }

    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        languageCode: users.languageCode,
      })
      .from(users)
      .where(and(inArray(users.id, participantIds), isNull(users.deletedAt)));

    const liveLanguageById = new Map(
      job.liveParticipants.map((participant) => [participant.id, normalizeLanguage(participant.languageCode)]),
    );
    const liveEmailById = new Map(
      job.liveParticipants.map((participant) => [participant.id, participant.email]),
    );

    return rows.map((row) => ({
      ...row,
      email: liveEmailById.get(row.id) || row.email,
      languageCode: liveLanguageById.get(row.id) || normalizeLanguage(row.languageCode),
    }));
  }

  private buildRecipientPayload({
    recipient,
    job,
    availableSummaryLanguages,
    availableTranscriptLanguages,
    summaryArtifacts,
    transcriptArtifacts,
  }: {
    recipient: RecipientRow;
    job: MeetingArtifactEmailJob;
    availableSummaryLanguages: string[];
    availableTranscriptLanguages: string[];
    summaryArtifacts: Map<string, string>;
    transcriptArtifacts: Map<string, string>;
  }): RecipientEmailPayload {
    const { summaryLanguage, transcriptLanguage } = resolveRecipientArtifactLanguages({
      method: job.method,
      preferredLanguage: recipient.languageCode,
      spokenLanguages: job.spokenLanguages,
      availableSummaryLanguages,
      availableTranscriptLanguages,
    });

    return {
      recipient,
      summaryLanguage,
      transcriptLanguage,
      summaryPath: summaryLanguage ? summaryArtifacts.get(summaryLanguage) || null : null,
      transcriptPath: transcriptLanguage ? transcriptArtifacts.get(transcriptLanguage) || null : null,
    };
  }

  private async sendRecipientEmail(job: MeetingArtifactEmailJob, payload: RecipientEmailPayload) {
    const summaryMarkdown = await Bun.file(payload.summaryPath || "").text();
    const renderedSummary = renderMarkdownEmail(summaryMarkdown);
    const summaryLanguageLabel = getLanguageLabel(payload.summaryLanguage);
    const html = buildSummaryEmailHtml({
      title: job.topic || job.readableId || "Meeting",
      languageLabel: summaryLanguageLabel,
      meetingDateLabel: formatMeetingDateLabel(
        job.endedAt || job.startedAt || job.scheduledTime,
      ),
      renderedSummary,
    });
    const transcriptBytes = await Bun.file(payload.transcriptPath || "").bytes();
    const attachmentContent = Buffer.from(transcriptBytes).toString("base64");

    await this.mailer.sendMail({
      to: payload.recipient.email || "",
      subject: `Your meeting summary and transcript for ${job.topic || job.readableId || job.meetingId}`,
      html,
      attachments: [
        {
          filename: buildMeetingTranscriptFilename(
            {
              id: job.meetingId,
              readable_id: job.readableId,
              topic: job.topic,
              scheduled_time: job.scheduledTime,
              started_at: job.startedAt,
              ended_at: job.endedAt,
            },
            payload.transcriptLanguage || "unknown",
          ),
          contentType: "text/vtt",
          contentBytesBase64: attachmentContent,
        },
      ],
    });

    logger.info("Meeting artifact email delivered.", {
      meetingId: job.meetingId,
      recipientId: payload.recipient.id,
      recipientEmail: payload.recipient.email,
      summaryLanguage: payload.summaryLanguage,
      transcriptLanguage: payload.transcriptLanguage,
    });
  }

  private indexArtifacts(outputPaths: string[], isSummary: boolean) {
    return new Map(
      outputPaths.map((outputPath) => {
        const filename = basename(outputPath, extname(outputPath));
        const language = isSummary ? filename.replace(/^summary-/, "") : filename;
        return [language, outputPath] as const;
      }),
    );
  }
}

export const meetingArtifactEmailService = new MeetingArtifactEmailService();
