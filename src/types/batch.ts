/**
 * Shared types for the bounded batch mutation endpoints.
 *
 * The data API exposes cross-agent batch mutations at `/agents/aggregates`
 * and `/agents/messages`. Every item carries its own `agent_id` and
 * `channel_name`, each is authorised independently, and the batch can
 * partially succeed — results come back in request order and callers should
 * retry only the failed entries.
 *
 * See `docs/batch-aggregate-updates.md` in channels-rest for the contract.
 */

/**
 * Server-enforced ceiling on items per batch request. Exceeding it is a 400,
 * so callers must chunk. `chunkBatchItems` does this for you.
 */
export const MAX_BATCH_ITEMS = 50;

/** A single merge-patch against one agent's channel aggregate. */
export interface BatchAggregateUpdateItem {
  agent_id: string;
  channel_name: string;
  /** Merge patch. `null` at a leaf clears that key. */
  data: Record<string, unknown>;
  /**
   * Dot-paths to replace outright rather than merge into. Mirrors the
   * `replace` query parameter on the single-aggregate PATCH.
   */
  replace?: string[];
  /** Skip aggregate hooks (alarms, SNS fan-out, websocket publish). */
  suppress_hooks?: boolean;
}

export interface BatchCreateMessageItem {
  agent_id: string;
  channel_name: string;
  /**
   * Supplying a stable ID makes create retries idempotent. Without one the
   * server generates an ID and a lost response can duplicate the message.
   */
  message_id?: string;
  data: unknown;
  /** Message timestamp, ms since epoch. Defaults to server receipt time. */
  ts?: number;
  /** Time-to-live in seconds. */
  ttl?: number;
}

export interface BatchUpdateMessageItem {
  agent_id: string;
  channel_name: string;
  message_id: string;
  data: unknown;
}

export interface BatchDeleteMessageItem {
  agent_id: string;
  channel_name: string;
  message_id: string;
}

/** Per-item outcome. `error` is present only when `success` is false. */
export interface BatchResultItem {
  agent_id: string;
  channel_name: string;
  success: boolean;
  error?: string;
}

export interface BatchMessageResultItem extends BatchResultItem {
  /** Present for creates — the server-generated ID when none was supplied. */
  message_id?: string;
}

export interface BatchResponse<TItem extends BatchResultItem = BatchResultItem> {
  /** Results in request order, one per submitted item. */
  items: TItem[];
  count: number;
  succeeded: number;
  failed: number;
}

export type BatchAggregateResponse = BatchResponse<BatchResultItem>;
export type BatchMessageResponse = BatchResponse<BatchMessageResultItem>;

/**
 * Split `items` into server-acceptable chunks. Returns `[]` for an empty
 * input, since an empty batch is a 400 rather than a no-op.
 */
export function chunkBatchItems<T>(items: T[], size = MAX_BATCH_ITEMS): T[][] {
  if (size < 1) throw new RangeError("chunk size must be at least 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

/**
 * Merge several batch responses into one, as if the whole set had been sent
 * in a single request. Useful after chunking.
 */
export function mergeBatchResponses<TItem extends BatchResultItem>(
  responses: BatchResponse<TItem>[],
): BatchResponse<TItem> {
  const items = responses.flatMap((r) => r.items);
  return {
    items,
    count: items.length,
    succeeded: items.filter((i) => i.success).length,
    failed: items.filter((i) => !i.success).length,
  };
}
