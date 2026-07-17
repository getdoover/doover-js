import type { MessageStructure } from "../types/common";

/**
 * A per-channel cache of *proven-complete* id ranges.
 *
 * `useChannelMessages` models history as a chain of cursors: each page's oldest
 * id is the next page's `before`. That chain is anchored at its first cursor, so
 * two windows over the same channel are two unrelated chains — re-anchoring
 * always refetches, even over data already held.
 *
 * This store keeps the fact the chain throws away. A response to
 * `before=X, limit=N` is "the N newest messages strictly older than X", so a
 * full page proves that *every* message in `[oldest.id, X)` is in hand. History
 * is append-only, so that stays true forever. Overlapping windows then merge
 * into one segment instead of duplicating, and revisiting a range costs nothing.
 *
 * The store sits under the query, not beside it: the chains stay as they are and
 * remain the cache React Query sees, while this layer removes the network calls
 * underneath them.
 *
 * Ids are decimal snowflakes of varying length, so every comparison goes through
 * `BigInt` — string ordering would put "500" after "4000".
 */

/** A contiguous range of history we can prove we hold in full. */
export interface RangeSegment {
  /** Id of the oldest message held. Meaningless when `atStart` (coverage runs to -inf). */
  lo: bigint;
  /** Exclusive upper bound of proven coverage. */
  hi: bigint;
  /** No messages exist below `lo` — the channel (or its retention window) starts here. */
  atStart: boolean;
  /**
   * `hi` tracks the live feed. Only true while a fetch has proven coverage up to
   * roughly now AND the socket has not dropped since — see `sealTips`.
   */
  live: boolean;
  /** Ascending by id. */
  messages: MessageStructure[];
}

/**
 * How close to "now" a fetch's `before` must be for its segment to accept live
 * pushes. Beyond this the feed and the segment may not be contiguous.
 */
const LIVE_PROOF_TOLERANCE_MS = 60_000;

const idOf = (message: MessageStructure) => BigInt(message.id);

function sortById(messages: MessageStructure[]) {
  return [...messages].sort((a, b) => (idOf(a) < idOf(b) ? -1 : idOf(a) > idOf(b) ? 1 : 0));
}

function dedupeById(messages: MessageStructure[]) {
  const seen = new Map<string, MessageStructure>();
  // Later wins: a live push or a refetch supersedes an older copy
  for (const message of messages) seen.set(message.id, message);
  return sortById([...seen.values()]);
}

export class ChannelRangeStore {
  /** Disjoint, ascending by `lo`. */
  private segments: RangeSegment[] = [];

  /**
   * Answer "the newest `limit` messages strictly older than `before`" from cache,
   * or `undefined` when the range isn't proven and the caller must fetch.
   *
   * Returns ascending by id, matching `listMessages({ order: "asc" })`.
   */
  read(before: bigint, limit: number): MessageStructure[] | undefined {
    const segment = this.segments.find(
      (s) => before <= s.hi && (s.atStart || before >= s.lo),
    );
    if (!segment) return undefined;

    const older = segment.messages.filter((m) => idOf(m) < before);
    if (older.length >= limit) return older.slice(older.length - limit);
    // Short of `limit` only tells us the range is exhausted if nothing precedes it
    return segment.atStart ? older : undefined;
  }

  /**
   * Record a fetched page. `before` is the cursor actually sent and `limit` the
   * one actually requested — a short page proves the range bottoms out, which is
   * only sound because the server rejects an over-cap `limit` rather than
   * silently clamping it.
   */
  record(params: {
    before: bigint;
    limit: number;
    page: MessageStructure[];
    /** Epoch ms the request was issued, for deciding whether this segment is live. */
    at?: number;
  }): void {
    const { before, limit, page } = params;
    const at = params.at ?? Date.now();
    const messages = sortById(page);
    const atStart = messages.length < limit;
    const lo = messages.length > 0 ? idOf(messages[0]) : before;
    const live = timestampOf(before) >= at - LIVE_PROOF_TOLERANCE_MS;

    this.merge({ lo, hi: before, atStart, live, messages });
  }

  /**
   * Extend the live segment with a pushed message. Ignored unless a segment is
   * currently live: outside that, the message and the segment may have a gap
   * between them, and claiming coverage across it would hide messages forever.
   */
  recordLive(message: MessageStructure): void {
    const id = idOf(message);
    const tip = this.segments.find((s) => s.live);
    if (!tip || id < tip.lo) return;

    tip.messages = dedupeById([...tip.messages, message]);
    if (id >= tip.hi) tip.hi = id + 1n;
  }

  /**
   * Stop trusting the live feed to extend coverage — call when the socket drops.
   * Messages sent while disconnected would leave a hole, so segments go back to
   * proving coverage by fetching.
   */
  sealTips(): void {
    for (const segment of this.segments) segment.live = false;
  }

  /** Test/debug view. */
  snapshot(): RangeSegment[] {
    return this.segments.map((s) => ({ ...s, messages: [...s.messages] }));
  }

  clear(): void {
    this.segments = [];
  }

  /** Union `incoming` with every segment it overlaps or merely touches. */
  private merge(incoming: RangeSegment): void {
    const overlapping: RangeSegment[] = [];
    const rest: RangeSegment[] = [];
    for (const segment of this.segments) {
      // Touching counts: [a,b) and [b,c) are both proven, so [a,c) is too
      const disjoint = segment.hi < incoming.lo || segment.lo > incoming.hi;
      (disjoint ? rest : overlapping).push(segment);
    }

    const merged = overlapping.reduce<RangeSegment>(
      (acc, s) => ({
        lo: s.lo < acc.lo ? s.lo : acc.lo,
        hi: s.hi > acc.hi ? s.hi : acc.hi,
        atStart: acc.atStart || s.atStart,
        live: acc.live || s.live,
        messages: [...acc.messages, ...s.messages],
      }),
      incoming,
    );
    merged.messages = dedupeById(merged.messages);
    if (merged.atStart && merged.messages.length > 0) {
      merged.lo = idOf(merged.messages[0]);
    }

    this.segments = [...rest, merged].sort((a, b) => (a.lo < b.lo ? -1 : a.lo > b.lo ? 1 : 0));
  }
}

const SNOWFLAKE_EPOCH_MS = 1735689600000n;

/** Epoch ms encoded in a snowflake, without going through the string round-trip. */
function timestampOf(id: bigint) {
  return Number((id >> 22n) + SNOWFLAKE_EPOCH_MS);
}

const stores = new Map<string, ChannelRangeStore>();

/**
 * Stores are per *stream* — agent, channel, and any `fields` filter, which
 * returns a different set of messages. Deliberately NOT per anchor: sharing
 * across anchors is the entire point.
 */
export function getChannelRangeStore(key: string): ChannelRangeStore {
  let store = stores.get(key);
  if (!store) {
    store = new ChannelRangeStore();
    stores.set(key, store);
  }
  return store;
}

/** Drop every store. Tests only — there is no eviction in normal operation. */
export function resetChannelRangeStores(): void {
  stores.clear();
}
