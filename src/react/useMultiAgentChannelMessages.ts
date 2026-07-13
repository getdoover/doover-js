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
  /**
   * Global cap on the total number of messages returned across all agents
   * for a single request. The server distributes this budget across agents
   * in newest-first order, so a noisy agent can starve quieter ones.
   * Prefer `agentMessageLimit` when you want a fair per-agent slice.
   */
  limit?: number;
  /**
   * Per-agent cap on messages returned. Forwarded as `agent_message_limit`.
   * Use this when fanning out across many agents that have wildly different
   * message rates and you want each agent's window represented.
   */
  agentMessageLimit?: number;
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
   * Keep paging older automatically until `hasNextPage` is false. Each page
   * resumes only the agents that hit `agentMessageLimit`, using their own
   * cursors, so a noisy agent doesn't drag the quiet ones back through
   * messages they've already returned. Almost always combined with `after`
   * — without a lower bound this walks every agent's channel back to its
   * first message. `maxPages` caps the walk.
   */
  autoPaginate?: boolean;
  /**
   * Hard cap on pages fetched when `autoPaginate` is set. Defaults to 20.
   * Guards against a window that's wider than `agentMessageLimit × maxPages`
   * messages turning into an unbounded fetch loop.
   */
  maxPages?: number;
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
  /**
   * Per-agent resume cursors, keyed by agent id. Present (and non-empty)
   * only for agents that hit the per-agent limit before draining the
   * window. This is the canonical "there is more" signal.
   */
  next_cursors?: Record<string, string>;
  /** Legacy single-cursor signal, for servers predating `next_cursors`. */
  next?: string | null;
  /** Legacy: agent ids that may have more older messages. */
  at_limit_agent_ids?: string[];
}

/**
 * Cursor for the next page. `agentIds` narrows the fetch to the agents that
 * still have older messages; `agentBefore` is parallel to it, giving each
 * one its own upper bound. `before` is only used on the legacy path.
 */
interface PageParam {
  before?: string;
  agentIds?: string[];
  agentBefore?: string[];
}

function nextPageParam<TData>(lastPage: Page<TData> | undefined): PageParam | undefined {
  if (!lastPage) return undefined;
  const cursors = lastPage.next_cursors;
  if (cursors) {
    const entries = Object.entries(cursors);
    // Present-but-empty means every agent drained its window: we're done.
    if (entries.length === 0) return undefined;
    return {
      agentIds: entries.map(([id]) => id),
      agentBefore: entries.map(([, cursor]) => cursor),
    };
  }
  // Legacy server: one global `before` for whichever agents were at limit.
  // Those agents whose own cursor is older than `next` re-return a few
  // messages we already hold — harmless, since we dedupe by id below.
  if (typeof lastPage.next === "string" && lastPage.next) {
    return {
      before: lastPage.next,
      ...(lastPage.at_limit_agent_ids?.length
        ? { agentIds: lastPage.at_limit_agent_ids }
        : {}),
    };
  }
  return undefined;
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
  const agentMessageLimit = options?.agentMessageLimit;
  const liveUpdates = options?.liveUpdates ?? true;
  const fields = options?.fields;
  const initialBefore = options?.initialBefore;
  const sources = options?.sources;
  const after = options?.after;
  const autoPaginate = options?.autoPaginate ?? false;
  const maxPages = options?.maxPages ?? 20;
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
    // `key` captures every scope dim (agentIds + sources + after + fields);
    // serialise the whole thing so the closure refreshes when any dim
    // changes — listing dims by hand drops live updates whenever the list
    // grows (we used to omit `after`/`fields`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, JSON.stringify(key)],
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

  const query = useInfiniteQuery<Page<TData>, Error, InfiniteData<Page<TData>>, typeof key, PageParam>({
    queryKey: key,
    enabled: agentIds.length > 0,
    staleTime: Infinity,
    initialPageParam: (initialBefore ? { before: initialBefore } : {}) as PageParam,
    getNextPageParam: nextPageParam,
    queryFn: async ({ pageParam }) => {
      const params = {
        agent_id: pageParam.agentIds ?? agentIds,
        ...(pageParam.before ? { before: pageParam.before } : {}),
        ...(pageParam.agentBefore ? { agent_before: pageParam.agentBefore } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(agentMessageLimit !== undefined
          ? { agent_message_limit: agentMessageLimit }
          : {}),
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

  useEffect(() => {
    if (!autoPaginate) return;
    if (query.isFetching || !query.hasNextPage) return;
    if ((query.data?.pages.length ?? 0) >= maxPages) return;
    query.fetchNextPage();
  }, [
    autoPaginate,
    maxPages,
    query.isFetching,
    query.hasNextPage,
    query.fetchNextPage,
    query.data?.pages.length,
  ]);

  const messages = useMemo(() => {
    // The legacy single-cursor path (and a live push that races a page
    // fetch) can hand us the same message twice; keep the first copy.
    const seen = new Set<string>();
    const out: MessageStructure<TData>[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const message of page.results) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        out.push(message);
      }
    }
    return out;
  }, [query.data]);

  return { ...query, messages };
}
