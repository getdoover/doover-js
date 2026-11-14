import { useMemo } from "react";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";

import type {
  AgentConnectionHistory,
  ConnectionHistoryResponse,
} from "../types/connection.js";
import { useDooverClient } from "./context.js";

export interface UseMultiAgentConnectionHistoryOptions {
  /** Snowflake id bounds. Defaults to the last 7 days; at most 31 days apart. */
  before?: string;
  after?: string;
  /** A state held shorter than this is folded into the one before it. Default one minute; 0 for every change. */
  minGapMs?: number;
  /**
   * How long the result stays cached once nothing shows it, in ms: a page
   * left and come back to within that time does not fetch again. Defaults
   * to the query client's.
   */
  gcTime?: number;
  /**
   * While a new window or set of agents loads, keep handing back the last
   * result, flagged by `query.isPlaceholderData`, rather than nothing.
   */
  keepPreviousData?: boolean;
  /** Defaults true; the query also waits for a non-empty `agentIds`. */
  enabled?: boolean;
}

export function multiAgentConnectionHistoryQueryKey(
  agentIds: string[],
  options?: UseMultiAgentConnectionHistoryOptions,
) {
  return [
    "doover",
    "connection_history",
    [...agentIds].sort().join(","),
    {
      before: options?.before ?? null,
      after: options?.after ?? null,
      min_gap_ms: options?.minGapMs ?? null,
    },
  ] as const;
}

export interface UseMultiAgentConnectionHistoryResult {
  history: ConnectionHistoryResponse | undefined;
  /** Keyed by agent id for O(1) lookup. */
  agentsById: Record<string, AgentConnectionHistory>;
  query: UseQueryResult<ConnectionHistoryResponse>;
}

/**
 * The whole window's connection timeline for a set of agents: each one's
 * state at the window's start and end, and every change of state inside
 * it, newest first, with every page already read. The window is part of
 * the key, so callers that want a stable cache across remounts should snap
 * `before` to a grid rather than pass a fresh "now" each render. Never
 * stale on its own: history does not change, and the trailing edge moves
 * only as far as the caller's `before` does.
 */
export function useMultiAgentConnectionHistory(
  agentIds: string[],
  options?: UseMultiAgentConnectionHistoryOptions,
): UseMultiAgentConnectionHistoryResult {
  const client = useDooverClient();
  const key = multiAgentConnectionHistoryQueryKey(agentIds, options);
  const enabled = (options?.enabled ?? true) && agentIds.length > 0;

  const query = useQuery<ConnectionHistoryResponse>({
    queryKey: key,
    enabled,
    staleTime: Infinity,
    ...(options?.gcTime !== undefined ? { gcTime: options.gcTime } : {}),
    ...(options?.keepPreviousData ? { placeholderData: keepPreviousData } : {}),
    queryFn: () =>
      client.agents.getAllConnectionHistory({
        agent_id: agentIds,
        ...(options?.before !== undefined ? { before: options.before } : {}),
        ...(options?.after !== undefined ? { after: options.after } : {}),
        ...(options?.minGapMs !== undefined ? { min_gap_ms: options.minGapMs } : {}),
      }),
  });

  const agentsById = useMemo(() => {
    const map: Record<string, AgentConnectionHistory> = {};
    for (const agent of query.data?.agents ?? []) map[agent.id] = agent;
    return map;
  }, [query.data]);

  return { history: query.data, agentsById, query };
}
