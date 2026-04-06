/**
 * Sanitizes meeting metadata into a filesystem-friendly filename segment.
 */
export function sanitizeMeetingFilenamePart(value: string | null | undefined, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }

  const sanitized = value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || fallback;
}

/**
 * Chooses the most relevant meeting date for artifact filenames.
 */
export function resolveMeetingArtifactDate(meeting: {
  ended_at?: Date | string | null;
  started_at?: Date | string | null;
  scheduled_time?: Date | string | null;
}) {
  const candidate = meeting.ended_at || meeting.started_at || meeting.scheduled_time;
  const parsed = candidate ? new Date(candidate) : new Date();

  if (Number.isNaN(parsed.getTime())) {
    const fallback = new Date();
    return `${String(fallback.getUTCMonth() + 1).padStart(2, "0")}-${String(fallback.getUTCDate()).padStart(2, "0")}`;
  }

  return `${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Builds a transcript filename for downloads and email attachments.
 */
export function buildMeetingTranscriptFilename(
  meeting: {
    id?: string | null;
    readable_id?: string | null;
    topic?: string | null;
    ended_at?: Date | string | null;
    started_at?: Date | string | null;
    scheduled_time?: Date | string | null;
  },
  language: string,
) {
  const safeTitle = sanitizeMeetingFilenamePart(
    meeting.topic || meeting.readable_id || meeting.id,
    "meeting",
  );
  const transcriptDate = resolveMeetingArtifactDate(meeting);
  const safeLanguage = sanitizeMeetingFilenamePart(language, "unknown");
  return `${safeTitle}_${transcriptDate}_${safeLanguage}.vtt`;
}

/**
 * Builds a summary filename for downloads.
 */
export function buildMeetingSummaryFilename(
  meeting: {
    id?: string | null;
    readable_id?: string | null;
    topic?: string | null;
    ended_at?: Date | string | null;
    started_at?: Date | string | null;
    scheduled_time?: Date | string | null;
  },
  language: string,
) {
  const safeTitle = sanitizeMeetingFilenamePart(
    meeting.topic || meeting.readable_id || meeting.id,
    "meeting",
  );
  const summaryDate = resolveMeetingArtifactDate(meeting);
  const safeLanguage = sanitizeMeetingFilenamePart(language, "unknown");
  return `${safeTitle}_${summaryDate}_${safeLanguage}_summary.md`;
}
