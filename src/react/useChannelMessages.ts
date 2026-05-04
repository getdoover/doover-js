import { useCallback, useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";

import type { MessageStructure } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";
import { useChannelSubscription } from "./useChannelSubscription";

export function channelMessagesQueryKey(
  agentId: string | undefined,
  channelName: string | undefined,
) {
  return ["doover", "agent", agentId, "channel", channelName, "messages"] as const;
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
}

type Page<TData> = MessageStructure<TData>[];

export interface UseChannelMessagesResult<TData>
  extends Omit<UseInfiniteQueryResult<InfiniteData<Page<TData>>>, "data"> {
  /** Flat chronological list across all loaded pages. */
  messages: MessageStructure<TData>[];
  /** Raw react-query data (pages). */
  data: InfiniteData<Page<TData>> | undefined;
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
  const queryClient = useQueryClient();
  const { agentId, channelName } = identifier;
  const limit = options?.limit;
  const liveUpdates = options?.liveUpdates ?? true;
  const fields = options?.fields;
  const initialBefore = options?.initialBefore;
  const after = options?.after;
  const autoPaginate = options?.autoPaginate ?? false;
  const key = channelMessagesQueryKey(agentId, channelName);

  const onMessage = useCallback(
    (message: MessageStructure) => {
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
    [queryClient, agentId, channelName],
  );

  useChannelSubscription(liveUpdates ? identifier : undefined, { onMessage });

  const query = useInfiniteQuery<Page<TData>>({
    queryKey: key,
    enabled: !!agentId && !!channelName,
    staleTime: Infinity,
    initialPageParam: initialBefore as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage && lastPage.length > 0 ? lastPage[0]?.id : undefined,
    queryFn: async ({ pageParam }) => {
      const page = await client.viewer.getMessages(identifier, {
        ...(typeof pageParam === "string" ? { before: pageParam } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(fields && fields.length > 0 ? { field_name: fields } : {}),
        ...(after !== undefined ? { after } : {}),
      });
      return (page ?? []) as Page<TData>;
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

  return { ...query, messages };
}
