/**
 * Bounded pagination window used by list endpoints.
 */
export interface PaginationWindow {
  limit: number;
  offset: number;
}

/**
 * Parses a bounded integer query value with sensible fallback behavior.
 */
export function parseBoundedInteger(
  value: unknown,
  {
    defaultValue,
    min,
    max,
  }: {
    defaultValue: number;
    min: number;
    max: number;
  },
) {
  const numericValue = Number(value ?? defaultValue);
  if (!Number.isFinite(numericValue)) {
    return defaultValue;
  }

  return Math.min(Math.max(Math.floor(numericValue), min), max);
}

/**
 * Parses a limit/offset pair for paginated endpoints.
 */
export function parsePaginationWindow(
  query: { limit?: unknown; offset?: unknown } | null | undefined,
  {
    defaultLimit,
    maxLimit,
  }: {
    defaultLimit: number;
    maxLimit: number;
  },
): PaginationWindow {
  return {
    limit: parseBoundedInteger(query?.limit, {
      defaultValue: defaultLimit,
      min: 1,
      max: maxLimit,
    }),
    offset: parseBoundedInteger(query?.offset, {
      defaultValue: 0,
      min: 0,
      max: Number.MAX_SAFE_INTEGER,
    }),
  };
}

/**
 * Converts a `limit + 1` query result into the API pagination payload.
 */
export function paginateRows<T>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;

  return {
    items,
    hasMore,
  };
}
