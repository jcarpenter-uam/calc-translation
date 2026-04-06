import { describe, expect, it } from "bun:test";
import { buildSummaryEmailHtml, renderMarkdownEmail } from "../../services/markdownEmailRenderer";
import { resolveRecipientArtifactLanguages } from "../../services/meetingArtifactEmailService";

describe("meeting artifact language resolution", () => {
  it("prefers the recipient language for one-way summaries and transcripts", () => {
    expect(
      resolveRecipientArtifactLanguages({
        method: "one_way",
        preferredLanguage: "fr",
        spokenLanguages: ["en"],
        availableSummaryLanguages: ["en", "fr"],
        availableTranscriptLanguages: ["en", "fr"],
      }),
    ).toEqual({
      summaryLanguage: "fr",
      transcriptLanguage: "fr",
    });
  });

  it("falls back to shared two-way transcript and first available summary", () => {
    expect(
      resolveRecipientArtifactLanguages({
        method: "two_way",
        preferredLanguage: "de",
        spokenLanguages: ["en", "es"],
        availableSummaryLanguages: ["en", "es"],
        availableTranscriptLanguages: ["two_way"],
      }),
    ).toEqual({
      summaryLanguage: "en",
      transcriptLanguage: "two_way",
    });
  });
});

describe("markdown email rendering", () => {
  it("renders headings, paragraphs, and bullet lists to html", () => {
    const rendered = renderMarkdownEmail(`# Title\n\nHello **team**\n\n- One\n- Two`);

    expect(rendered).toContain("<h1>Title</h1>");
    expect(rendered).toContain("<p>Hello <strong>team</strong></p>");
    expect(rendered).toContain("<ul>");
    expect(rendered).toContain("<li>One</li>");
  });

  it("wraps rendered markdown in an email-safe html shell", () => {
    const html = buildSummaryEmailHtml({
      title: "Weekly Sync",
      languageLabel: "fr",
      meetingDateLabel: "April 6, 2026",
      renderedSummary: "<p>Bonjour</p>",
    });

    expect(html).toContain("Weekly Sync");
    expect(html).toContain("April 6, 2026");
    expect(html).toContain("Attached is the transcript");
    expect(html).toContain("Visit Calc-Translation");
    expect(html).toContain("<p>Bonjour</p>");
  });
});
