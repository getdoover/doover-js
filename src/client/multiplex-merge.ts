import type { MessageStructure } from "../types/common";

/** Keep the first item for each key; preserve input order otherwise. */
export function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyOf(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Compare two snowflake-ish id strings numerically when possible, else lexically. */
function compareIds(a: string, b: string): number {
  try {
    const ba = BigInt(a);
    const bb = BigInt(b);
    return ba < bb ? -1 : ba > bb ? 1 : 0;
  } catch {
    return a < b ? -1 : a > b ? 1 : 0;
  }
}

/**
 * Merge per-member message arrays: concatenate, de-dup by `id` (first member
 * wins), sort by id to match `order` ("desc" = newest first, the cloud's
 * native order; "asc" = oldest first), then truncate to `limit` if given.
 */
export function mergeMessages(
  perMember: MessageStructure[][],
  opts: { order: "asc" | "desc"; limit?: number },
): MessageStructure[] {
  const all = ([] as MessageStructure[]).concat(...perMember);
  const unique = dedupeBy(all, (m) => m.id);
  unique.sort((x, y) => {
    const c = compareIds(x.id, y.id);
    return opts.order === "asc" ? c : -c;
  });
  return typeof opts.limit === "number" ? unique.slice(0, opts.limit) : unique;
}
