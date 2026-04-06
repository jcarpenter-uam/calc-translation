/**
 * Formats a language code into a human-readable fallback label.
 */
export function getLanguageLabel(code: string | null | undefined) {
  const normalized = typeof code === "string" ? code.trim() : "";
  if (!normalized) {
    return "Unknown";
  }

  if (normalized === "two_way") {
    return "Shared Transcript";
  }

  return normalized;
}
