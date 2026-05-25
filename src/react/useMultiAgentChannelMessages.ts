import { useCallback, useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";

import type { MessageStructure } from "../types/common";
import { useDooverClient } from "./context";

export function multiAgentChannelMessagesQueryKey(
  channelName: string,
  agentIds: string[],
  sources?: string[],
  scope?: { after?: string; fields?: readonly string[] },
) {
  const sourceDim = sources && sources.length ? [...sources].sort().join(",") : "*";
  const base = [
    "doover",
    "channel",
    channelName,
    "messages",
    [...agentIds].sort().join(","),
    "src",
    sourceDim,
  ] as const;
  // Pagination cursors come from the first page's response and are scoped
  // to *that* response's `after`/`fields`. Mixing them under one cache
  // entry would cause `getNextPageParam` to anchor on an unrelated page,
  // so a differently-bounded request must live under its own key.
  const scopeKey: Record<string, unknown> = {};
  if (scope?.after) scopeKey.after = scope.after;
  if (scope?.fields && scope.fields.length > 0) {
    scopeKey.fields = [...scope.fields].sort();
  }
  return Object.keys(scopeKey).length > 0
    ? ([...base, scopeKey] as const)
    : base;
}

export interface UseMultiAgentChannelMessagesOptions {
  limit?: number;
  /** If false, skip live subscriptions per agent. Defaults true. */
  liveUpdates?: boolean;
  /**
   * Restrict the returned messages to those whose payload contains any
   * of these top-level field names. Forwarded as `field_name`.
   */
  fields?: string[];
  /** Optional first-page `before` cursor (snowflake id). */
  initialBefore?: string;
  /**
   * Optional lower-bound snowflake id. Forwarded server-side so each
   * agent's pagination stops on its own once it walks past the bound —
   * mirrors `useChannelMessages`'s `after`. Use this to fetch a bounded
   * time window (e.g. last 24h) across many agents without filtering
   * on the client.
   */
  after?: string;
  /**
   * Restrict to these source ids on a `MultiplexClient`. Ignored for a plain
   * `DooverClient` or `LocalAgentClient`. When set, the query key is
   * source-dimensioned so data from different source subsets is cached
   * independently.
   */
  sources?: string[];
}

interface Page<TData> {
  results: MessageStructure<TData>[];
  next?: string;
}

export interface UseMultiAgentChannelMessagesResult<TData>
  extends Omit<UseInfiniteQueryResult<InfiniteData<Page<TData>>>, "data"> {
  messages: MessageStructure<TData>[];
  data: InfiniteData<Page<TData>> | undefined;
}

export function useMultiAgentChannelMessages<TData = unknown>(
  channelName: string,
  agentIds: string[],
  options?: UseMultiAgentChannelMessagesOptions,
): UseMultiAgentChannelMessagesResult<TData> {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  const limit = options?.limit;
  const liveUpdates = options?.liveUpdates ?? true;
  const fields = options?.fields;
  const initialBefore = options?.initialBefore;
  const sources = options?.sources;
  const after = options?.after;
  const key = multiAgentChannelMessagesQueryKey(channelName, agentIds, sources, {
    after,
    fields,
  });

  const prependMessage = useCallback(
    (message: MessageStructure) => {
      queryClient.setQueryData<InfiniteData<Page<TData>>>(key, (current) => {
        if (!current) return current;
        const typed = message as MessageStructure<TData>;
        const [firstPage, ...rest] = current.pages;
        const firstResults = firstPage?.results ?? [];
        return {
          ...current,
          pages: [
            { ...firstPage, results: [typed, ...firstResults] },
            ...rest,
          ],
        };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, channelName, agentIds.join(","), sources?.join(",")],
  );

  useEffect(() => {
    if (!liveUpdates || agentIds.length === 0) return;
    const offs = agentIds.map((agentId) => {
      const channel = { agent_id: agentId, name: channelName };
      return client.gateway.subscribeToChannel(channel, {
        onMessage: (msg) => prependMessage(msg),
      });
    });
    void client.gateway.connect();
    return () => {
      for (const off of offs) off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, channelName, liveUpdates, agentIds.join(",")]);

  const query = useInfiniteQuery<Page<TData>>({
    queryKey: key,
    enabled: agentIds.length > 0,
    staleTime: Infinity,
    initialPageParam: initialBefore as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.next,
    queryFn: async ({ pageParam }) => {
      const params = {
        agent_id: agentIds,
        ...(typeof pageParam === "string" ? { before: pageParam } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(fields && fields.length > 0 ? { field_name: fields } : {}),
        ...(after !== undefined ? { after } : {}),
      };
      // Pass `{ sources }` as a trailing bag only when set — cast through
      // `never` since the TypeScript overloads don't declare it.
      const sourcesArg = sources ? { sources } : undefined;
      const page = await (sourcesArg
        ? (client.agents.getMultiAgentMessages as unknown as (...a: unknown[]) => Promise<Page<TData>>)(channelName, params, sourcesArg)
        : client.agents.getMultiAgentMessages(channelName, params));
      return page as unknown as Page<TData>;
    },
  });

  const messages = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.results),
    [query.data],
  );

  return { ...query, messages };
}
