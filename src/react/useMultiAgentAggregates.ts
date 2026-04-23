import { useCallback, useEffect, useMemo } from "react";
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { Aggregate } from "../types/common";
import type { AgentAggregate } from "../types/openapi";
import { useDooverClient } from "./context";

export function multiAgentAggregatesQueryKey(
  channelName: string,
  agentIds: string[],
) {
  return [
    "doover",
    "channel",
    channelName,
    "aggregates",
    [...agentIds].sort().join(","),
  ] as const;
}

export interface UseMultiAgentAggregatesOptions {
  /** If false, skip per-agent live subscriptions. Defaults true. */
  liveUpdates?: boolean;
}

export interface UseMultiAgentAggregatesResult {
  /** Keyed by `agent_id` for O(1) lookup. */
  aggregatesByAgent: Record<string, Aggregate>;
  query: UseQueryResult<{ results: AgentAggregate[]; count: number }>;
}

/**
 * Batch-fetch aggregates for a channel across many agents, then keep each
 * agent's slot live via its own gateway subscription. Reconciles per-agent
 * `channelSync`/`aggregateUpdate` events into the batched query cache.
 */
export function useMultiAgentAggregates(
  channelName: string,
  agentIds: string[],
  options?: UseMultiAgentAggregatesOptions,
): UseMultiAgentAggregatesResult {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  const liveUpdates = options?.liveUpdates ?? true;
  const key = multiAgentAggregatesQueryKey(channelName, agentIds);

  const query = useQuery({
    queryKey: key,
    enabled: agentIds.length > 0,
    staleTime: Infinity,
    queryFn: () =>
      client.agents.getMultiAgentAggregates(channelName, { agent_id: agentIds }),
  });

  const patchAgentAggregate = useCallback(
    (agentId: string, aggregate: Aggregate) => {
      queryClient.setQueryData<{ results: AgentAggregate[]; count: number }>(
        key,
        (current) => {
          if (!current) return current;
          const idx = current.results.findIndex((r) => r.agent_id === agentId);
          const next: AgentAggregate = {
            agent_id: agentId,
            ...(aggregate as Aggregate),
          };
          const results =
            idx === -1
              ? [...current.results, next]
              : current.results.map((r, i) => (i === idx ? next : r));
          return { ...current, results };
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, channelName, agentIds.join(",")],
  );

  useEffect(() => {
    if (!liveUpdates || agentIds.length === 0) return;
    const noopMessage = () => {};
    const subscriptions = agentIds.map((agentId) => {
      const identifier = { agentId, channelName };
      const messageCallback = noopMessage;
      const aggregateCallback = (
        _id: { agentId?: string },
        aggregate: Aggregate,
      ) => {
        patchAgentAggregate(agentId, aggregate);
      };
      void client.viewer.subscribeToChannel(
        identifier,
        messageCallback,
        aggregateCallback,
      );
      return { identifier, messageCallback };
    });

    return () => {
      for (const { identifier, messageCallback } of subscriptions) {
        client.viewer
          .unsubscribeFromChannel(identifier, messageCallback)
          .catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, channelName, liveUpdates, agentIds.join(",")]);

  const aggregatesByAgent = useMemo(() => {
    const map: Record<string, Aggregate> = {};
    for (const entry of query.data?.results ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { agent_id, ...aggregate } = entry;
      map[agent_id] = aggregate as Aggregate;
    }
    return map;
  }, [query.data]);

  return { aggregatesByAgent, query };
}
