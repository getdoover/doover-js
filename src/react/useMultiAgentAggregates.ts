import { useCallback, useEffect, useMemo } from "react";
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { Aggregate, JSONValue, AgentAggregate } from "../types/common";
import { useDooverClient } from "./context";
import { channelAggregateQueryKey } from "./useChannelAggregate";

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

export interface UseMultiAgentAggregatesResult<TData> {
  /** Keyed by `agent_id` for O(1) lookup. */
  aggregatesByAgent: Record<string, Aggregate<TData>>;
  query: UseQueryResult<{ results: AgentAggregate<TData>[]; count: number }>;
}

/**
 * Batch-fetch aggregates for a channel across many agents, then keep each
 * agent's slot live via its own gateway subscription. Reconciles per-agent
 * `channelSync`/`aggregateUpdate` events into the batched query cache.
 */
export function useMultiAgentAggregates<
  TData = Record<string, JSONValue>,
>(
  channelName: string,
  agentIds: string[],
  options?: UseMultiAgentAggregatesOptions,
): UseMultiAgentAggregatesResult<TData> {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  const liveUpdates = options?.liveUpdates ?? true;
  const key = multiAgentAggregatesQueryKey(channelName, agentIds);

  const query = useQuery<{ results: AgentAggregate<TData>[]; count: number }>({
    queryKey: key,
    enabled: agentIds.length > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const response = await client.agents.getMultiAgentAggregates(
        channelName,
        { agent_id: agentIds },
      );
      // Seed the per-agent `channelAggregateQueryKey` cache so that
      // sibling `useChannelAggregate(id, channelName)` calls for any
      // of these agents get an instant cache hit rather than issuing
      // a second fetch for data we already have.
      for (const result of response.results) {
        const { agent_id, ...aggregate } = result;
        queryClient.setQueryData(
          channelAggregateQueryKey(agent_id, channelName),
          aggregate as Aggregate<TData>,
        );
      }
      return response as unknown as {
        results: AgentAggregate<TData>[];
        count: number;
      };
    },
  });

  const patchAgentAggregate = useCallback(
    (agentId: string, aggregate: Aggregate<TData>) => {
      queryClient.setQueryData<{
        results: AgentAggregate<TData>[];
        count: number;
      }>(key, (current) => {
        if (!current) return current;
        const idx = current.results.findIndex((r) => r.agent_id === agentId);
        const next: AgentAggregate<TData> = {
          agent_id: agentId,
          ...aggregate,
        };
        const results =
          idx === -1
            ? [...current.results, next]
            : current.results.map((r, i) => (i === idx ? next : r));
        return { ...current, results };
      });
      // Mirror live updates into the per-agent cache so sibling
      // `useChannelAggregate` consumers see them too.
      queryClient.setQueryData(
        channelAggregateQueryKey(agentId, channelName),
        aggregate,
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
        patchAgentAggregate(agentId, aggregate as Aggregate<TData>);
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
    const map: Record<string, Aggregate<TData>> = {};
    for (const entry of query.data?.results ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { agent_id, ...aggregate } = entry;
      map[agent_id] = aggregate as Aggregate<TData>;
    }
    return map;
  }, [query.data]);

  return { aggregatesByAgent, query };
}
