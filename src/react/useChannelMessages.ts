import { useCallback, useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";

import type { MessageStructure } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { generateSnowflakeIdAtTime } from "../utils/snowflake";
import { getChannelRangeStore } from "./messageRangeStore";
import { useDooverClient } from "./context";
import { useChannelSubscription } from "./useChannelSubscription";
import { useOfflineStatus, type OfflineStatusSnapshot } from "./useOfflineStatus";

export function channelMessagesQueryKey(
  agentId: string | undefined,
  channelName: string | undefined,
  fields?: readonly string[],
  sources?: string[],
  anchor?: string,
) {
  // Source-dimension the key (multiplex source subsets cache independently);
  // "*" means "all/unspecified" for a plain DooverClient/LocalAgentClient.
  const sourceDim = sources && sources.length ? [...sources].sort().join(",") : "*";
  const base = ["doover", "agent", agentId, "channel", channelName, "messages", "src", sourceDim] as const;
  // An anchored window is its own chain of cursors, so it must not share a cache
  // entry with the live one — same reasoning as `fields` below. Note this is
  // deliberately absent from the range store's key: sharing ranges across
  // anchors is the point of it.
  const key = anchor ? ([...base, { anchor }] as const) : base;
  if (!fields || fields.length === 0) return key;
  // A `field_name`-filtered request returns a different message stream than
  // the unfiltered (or differently-filtered) one, so it must live under its
  // own cache entry — otherwise one filter's pagination cursor leaks into
  // another's `getNextPageParam`, and the "next page" fetch ends up anchored
  // to an unrelated (often much older) message id. Sort so call-site argument
  // order doesn't fragment the cache.
  return [...key, { fields: [...fields].sort() }] as const;
}

export interface UseChannelMessagesOptions {
  limit?: number;
  /** If false, skip subscribing for live message-create updates. Defaults true. */
  liveUpdates?: boolean;
  /**
   * Restrict the returned messages to those whose payload contains any of
   * these top-level field names. Passed through as `field_name` on the
   * REST call.
   */
  fields?: string[];
  /**
   * Optional first-page `before` cursor (snowflake id). Defaults to
   * unset, which returns the latest messages. Use this when you need to
   * guard against client-side clock skew (seed with a slightly-future
   * snowflake so server-stamped messages don't get missed).
   */
  initialBefore?: string;
  /**
   * Pin the window to a point in history (snowflake id), for "jump to this
   * date" navigation. Changing it re-anchors and refetches.
   *
   * Distinct from `initialBefore`, which is a clock-skew seed regenerated per
   * mount and therefore must NOT dimension the cache key. An anchor identifies
   * a stream the caller means to look at, so it does. Pass a stable value — a
   * per-render `now` would refetch on every render.
   *
   * Cheaper than it looks: anchored windows share the range cache with every
   * other window on the channel, so re-anchoring over already-fetched history
   * costs no requests.
   */
  anchor?: string;
  /**
   * Optional lower-bound snowflake id. The server only returns messages
   * newer than this on every page, so paginating older eventually returns
   * an empty page and `hasNextPage` flips to false — useful for fetching
   * a bounded time window (e.g. last 24h) without a manual cutoff loop on
   * the consumer side.
   */
  after?: string;
  /**
   * Keep paging older automatically until `hasNextPage` is false. Almost
   * always combined with `after` (or a small channel) — without a lower
   * bound this will walk the channel back to its first message.
   */
  autoPaginate?: boolean;
  /**
   * Restrict to these source ids on a `MultiplexClient`. Ignored for a plain
   * `DooverClient` or `LocalAgentClient`. When set, the query key is
   * source-dimensioned so data from different source subsets is cached
   * independently.
   */
  sources?: string[];
}

type Page<TData> = MessageStructure<TData>[];

/** Mirrors `MessagesApi.listMessages`'s own default. */
const DEFAULT_PAGE_LIMIT = 10;

export interface UseChannelMessagesResult<TData>
  extends Omit<UseInfiniteQueryResult<InfiniteData<Page<TData>>>, "data"> {
  /** Flat chronological list across all loaded pages. */
  messages: MessageStructure<TData>[];
  /** Raw react-query data (pages). */
  data: InfiniteData<Page<TData>> | undefined;
  /** Offline/cache status when the provided client supports offline caching. */
  offline: OfflineStatusSnapshot;
}

/**
 * Paginated infinite query over `DooverDataProvider.getMessages`, with live
 * `messageCreate` pushes prepended/appended to the newest page. The "next"
 * page fetches older messages (cursor = oldest-loaded message id).
 */
export function useChannelMessages<TData = unknown>(
  identifier: ChannelIdentifier,
  options?: UseChannelMessagesOptions,
): UseChannelMessagesResult<TData> {
  const client = useDooverClient();
  const offline = useOfflineStatus();
  const queryClient = useQueryClient();
  const { agentId, channelName } = identifier;
  const limit = options?.limit;
  const liveUpdates = options?.liveUpdates ?? true;
  const fields = options?.fields;
  const initialBefore = options?.initialBefore;
  const anchor = options?.anchor;
  const after = options?.after;
  const autoPaginate = options?.autoPaginate ?? false;
  const sources = options?.sources;
  const key = channelMessagesQueryKey(agentId, channelName, fields, sources, anchor);

  // Keyed per stream, NOT per anchor — every window on this channel shares it.
  const storeKey = JSON.stringify(
    channelMessagesQueryKey(agentId, channelName, fields, sources),
  );
  const store = getChannelRangeStore(storeKey);

  // `after`/`sources` change what a page means (a short page proves a bound was
  // hit, not that history ran out; multiplex merges several streams), so those
  // requests bypass the range cache rather than record unsound coverage.
  const rangeCacheable = after === undefined && !sources;

  // A dropped socket may have swallowed messages, so the live feed stops being
  // proof of coverage until a fetch re-establishes it.
  useEffect(() => {
    const onClose = () => store.sealTips();
    client.gateway.on("close", onClose);
    return () => {
      client.gateway.off("close", onClose);
    };
  }, [client, store]);

  const onMessage = useCallback(
    (message: MessageStructure) => {
      // This cache entry is scoped to `fields`; the gateway delivers every
      // message on the channel, so drop live pushes whose payload doesn't
      // carry one of those fields rather than letting them pollute it.
      if (fields && fields.length > 0) {
        const data = message.data as unknown;
        if (
          !data ||
          typeof data !== "object" ||
          !fields.some((f) => f in data)
        ) {
          return;
        }
      }
      if (rangeCacheable) store.recordLive(message);

      queryClient.setQueryData<InfiniteData<Page<TData>>>(key, (current) => {
        if (!current) return current;
        const typed = message as MessageStructure<TData>;
        // Newest page is index 0 — prepend there.
        const [firstPage, ...rest] = current.pages;
        return {
          ...current,
          pages: [[...(firstPage ?? []), typed], ...rest],
        };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, agentId, channelName, fields?.join(","), sources?.join(",")],
  );

  useChannelSubscription(liveUpdates ? identifier : undefined, { onMessage });

  const query = useInfiniteQuery<Page<TData>>({
    queryKey: key,
    enabled: !!agentId && !!channelName,
    staleTime: Infinity,
    initialPageParam: (anchor ?? initialBefore) as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage && lastPage.length > 0 ? lastPage[0]?.id : undefined,
    queryFn: async ({ pageParam }) => {
      if (!agentId || !channelName) return [] as Page<TData>;
      const id = { agentId, channelName };
      // Resolve `before` here rather than letting the API default it, so the
      // range store records the exact bound the request proved.
      const before =
        typeof pageParam === "string"
          ? pageParam
          : generateSnowflakeIdAtTime(new Date());
      // Mirrors the API's own default; the store needs the limit actually applied
      const effectiveLimit = limit ?? DEFAULT_PAGE_LIMIT;

      if (rangeCacheable) {
        const cached = store.read(BigInt(before), effectiveLimit);
        if (cached) return cached as Page<TData>;
      }

      const requestedAt = Date.now();
      const params = {
        before,
        ...(limit !== undefined ? { limit } : {}),
        ...(fields && fields.length > 0 ? { field_name: fields } : {}),
        ...(after !== undefined ? { after } : {}),
        order: "asc" as const,
      };
      // Pass `{ sources }` as a trailing bag only when set — cast through
      // `never` since the TypeScript overloads don't declare it.
      const sourcesArg = sources ? { sources } : undefined;
      const page = sourcesArg
        ? await (client.messages.listMessages as unknown as (...a: unknown[]) => Promise<Page<TData>>)(id, params, sourcesArg)
        : await client.messages.listMessages(id, params);

      if (rangeCacheable) {
        store.record({
          before: BigInt(before),
          limit: effectiveLimit,
          page: page as MessageStructure[],
          at: requestedAt,
        });
      }
      return page as Page<TData>;
    },
  });

  useEffect(() => {
    if (!autoPaginate) return;
    if (query.isFetching || !query.hasNextPage) return;
    query.fetchNextPage();
  }, [autoPaginate, query.isFetching, query.hasNextPage, query.fetchNextPage]);

  const messages = useMemo(
    () => (query.data?.pages ?? []).flat(),
    [query.data],
  );

  return { ...query, messages, offline };
}
