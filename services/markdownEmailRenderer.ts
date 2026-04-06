import { env } from "../core/config";

const HTML_ESCAPE_MAP: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const CALC_TRANSLATION_LOGO_URL =
  "https://github.com/jcarpenter-uam/calc-translation/raw/master/clients/web/public/icon.png";

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) => HTML_ESCAPE_MAP[character] || character,
  );
}

function renderInlineMarkdown(value: string) {
  const escaped = escapeHtml(value);
  return escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

/**
 * Converts plain markdown summary text into lightweight HTML for email delivery.
 */
export function renderMarkdownEmail(markdown: string) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const htmlParts: string[] = [];
  let paragraphLines: string[] = [];
  let isInsideList = false;

  const flushParagraph = () => {
    if (paragraphLines.length === 0) {
      return;
    }

    htmlParts.push(`<p>${renderInlineMarkdown(paragraphLines.join(" "))}</p>`);
    paragraphLines = [];
  };

  const flushList = () => {
    if (!isInsideList) {
      return;
    }

    htmlParts.push("</ul>");
    isInsideList = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1]?.length || 1, 3);
      htmlParts.push(
        `<h${level}>${renderInlineMarkdown(heading[2] || "")}</h${level}>`,
      );
      continue;
    }

    const listItem = line.match(/^[-*]\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      if (!isInsideList) {
        htmlParts.push("<ul>");
        isInsideList = true;
      }
      htmlParts.push(`<li>${renderInlineMarkdown(listItem[1] || "")}</li>`);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();

  return htmlParts.join("\n");
}

/**
 * Wraps rendered markdown with minimal email-friendly layout styles.
 */
export function buildSummaryEmailHtml({
  title,
  languageLabel: _languageLabel,
  meetingDateLabel,
  renderedSummary,
}: {
  title: string;
  languageLabel: string;
  meetingDateLabel: string;
  renderedSummary: string;
}) {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#edf2f7;color:#1f2937;font-family:Inter,Segoe UI,sans-serif;">
    <div style="padding:24px 12px;">
      <div style="max-width:720px;margin:0 auto;background:#ffffff;border:1px solid #d9e2ec;border-radius:24px;overflow:hidden;box-shadow:0 16px 40px rgba(15,23,42,0.08);">
        <div style="padding:32px 28px 24px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 100%);color:#f8fafc;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
            <tr>
              <td align="center" style="text-align:center;padding:0 0 16px;">
                <a href="${escapeHtml(env.BASE_URL)}" target="_blank" rel="noreferrer" style="display:inline-block;text-decoration:none;">
                  <img src="${CALC_TRANSLATION_LOGO_URL}" alt="Calc-Translation Logo" width="88" height="88" style="display:block;width:88px;height:88px;border:0;border-radius:22px;box-shadow:0 10px 24px rgba(15,23,42,0.22);background:rgba(255,255,255,0.08);" />
                </a>
              </td>
            </tr>
            <tr>
              <td align="center" style="text-align:center;padding:0;">
                <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(255,255,255,0.14);font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">Calc-Translation</div>
              </td>
            </tr>
          </table>
          <h1 style="margin:18px 0 10px;text-align:center;font-size:30px;line-height:1.15;color:#ffffff;">Meeting Summary</h1>
          <p style="max-width:560px;margin:0 auto;font-size:15px;line-height:1.7;color:rgba(248,250,252,0.84);">Attached is the transcript for <strong>${escapeHtml(title)}</strong> from <strong>${escapeHtml(meetingDateLabel)}</strong>.</p>
        </div>
        <div style="padding:28px;">
          <div style="padding:22px 22px 24px;border:1px solid #dbe7f3;border-left:4px solid #2563eb;border-radius:20px;background:linear-gradient(180deg,#ffffff 0%,#f8fbff 100%);">
            <h2 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f172a;">Meeting Summary</h2>
            <div style="font-size:15px;line-height:1.8;color:#334155;">
              ${renderedSummary}
            </div>
          </div>
          <hr style="border:0;border-top:1px solid #e2e8f0;margin:28px 0 20px;">
          <p style="margin:0 0 10px;text-align:center;font-size:12px;line-height:1.6;color:#64748b;">This is an automated email. Please do not reply directly to this mailbox.</p>
          <p style="margin:0 0 18px;text-align:center;font-size:11px;line-height:1.6;font-style:italic;color:#94a3b8;">AI-generated summaries may contain mistakes. Please refer to the attached transcript for the exact meeting record.</p>
          <div style="text-align:center;">
            <a href="${escapeHtml(env.BASE_URL)}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#2563eb;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;box-shadow:0 8px 18px rgba(37,99,235,0.2);">Visit Calc-Translation</a>
          </div>
        </div>
      </div>
    </div>
    <style>
      h1,h2,h3,p,ul,li { margin-top: 0; }
      p { margin: 0 0 14px; }
      ul { margin: 0 0 16px; padding-left: 20px; }
      li { margin: 0 0 8px; }
      strong { color: #0f172a; }
      em { color: #475569; }
      code {
        padding: 2px 6px;
        border-radius: 6px;
        background: #eff6ff;
        color: #1d4ed8;
        font-family: SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 0.92em;
      }
      a { color: #2563eb; }
    </style>
  </body>
</html>`;
}
