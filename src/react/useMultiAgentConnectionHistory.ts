import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type {
  AgentConnectionHistory,
  ConnectionHistoryResponse,
} from "../types/connection.js";
import { useDooverClient } from "./context.js";

export interface UseMultiAgentConnectionHistoryOptions {
  /** Snowflake id bounds. Defaults to the last 7 days; at most 31 days apart. */
  before?: string;
  after?: string;
  /** Slot width in ms for the fleet `buckets` series. Omit for no buckets. */
  bucketMs?: number;
  /** Include each agent's state segments (at most 25 agents per call). */
  includeSegments?: boolean;
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
      bucket_ms: options?.bucketMs ?? null,
      include_segments: options?.includeSegments ?? false,
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
 * Connection state over time for a set of agents, in one request:
 * per-agent summaries (and segments on request) plus an optional fleet
 * series per slot. The window is part of the key, so callers that want a
 * stable cache across remounts should snap `before` to a grid rather than
 * pass a fresh "now" each render. Never stale on its own: history does
 * not change, and the trailing edge moves only as far as the caller's
 * `before` does.
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
    queryFn: () =>
      client.agents.getMultiAgentConnectionHistory({
        agent_id: agentIds,
        ...(options?.before !== undefined ? { before: options.before } : {}),
        ...(options?.after !== undefined ? { after: options.after } : {}),
        ...(options?.bucketMs !== undefined ? { bucket_ms: options.bucketMs } : {}),
        ...(options?.includeSegments ? { include_segments: true } : {}),
      }),
  });

  const agentsById = useMemo(() => {
    const map: Record<string, AgentConnectionHistory> = {};
    for (const agent of query.data?.agents ?? []) map[agent.id] = agent;
    return map;
  }, [query.data]);

  return { history: query.data, agentsById, query };
}
