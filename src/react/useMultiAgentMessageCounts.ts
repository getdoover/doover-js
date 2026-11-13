import { useMemo } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { DayCount, MessageCountsResponse } from "../types/openapi.js";
import { useDooverClient } from "./context.js";

export interface UseMultiAgentMessageCountsOptions {
  /** Snowflake id bounds. Defaults to the last 7 days; at most 92 days apart. */
  before?: string;
  after?: string;
  /** Defaults true; the query also waits for a non-empty `agentIds`. */
  enabled?: boolean;
}

export function multiAgentMessageCountsQueryKey(
  channelName: string,
  agentIds: string[],
  options?: UseMultiAgentMessageCountsOptions,
) {
  return [
    "doover",
    "channel",
    channelName,
    "message_counts",
    [...agentIds].sort().join(","),
    { before: options?.before ?? null, after: options?.after ?? null },
  ] as const;
}

export interface UseMultiAgentMessageCountsResult {
  counts: MessageCountsResponse | undefined;
  /** Each agent's days, keyed by agent id. */
  daysByAgent: Record<string, DayCount[]>;
  query: UseQueryResult<MessageCountsResponse>;
}

/**
 * Messages stored per UTC day on a channel for a set of agents, with fleet
 * totals. Cheap enough for a quarter of a fleet; the window is part of
 * the key, so snap `before` to a grid for a cache that survives remounts.
 */
export function useMultiAgentMessageCounts(
  channelName: string,
  agentIds: string[],
  options?: UseMultiAgentMessageCountsOptions,
): UseMultiAgentMessageCountsResult {
  const client = useDooverClient();
  const key = multiAgentMessageCountsQueryKey(channelName, agentIds, options);
  const enabled = (options?.enabled ?? true) && agentIds.length > 0;

  const query = useQuery<MessageCountsResponse>({
    queryKey: key,
    enabled,
    staleTime: Infinity,
    queryFn: () =>
      client.agents.getMultiAgentMessageCounts(channelName, {
        agent_id: agentIds,
        ...(options?.before !== undefined ? { before: options.before } : {}),
        ...(options?.after !== undefined ? { after: options.after } : {}),
      }),
  });

  const daysByAgent = useMemo(() => {
    const map: Record<string, DayCount[]> = {};
    for (const agent of query.data?.agents ?? []) map[agent.id] = agent.days;
    return map;
  }, [query.data]);

  return { counts: query.data, daysByAgent, query };
}
