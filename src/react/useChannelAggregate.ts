import { useCallback } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import type { Aggregate } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";
import { useChannelSubscription } from "./useChannelSubscription";

export function channelAggregateQueryKey(
  agentId: string | undefined,
  channelName: string | undefined,
) {
  return ["doover", "agent", agentId, "channel", channelName] as const;
}

/**
 * Fetch a channel's aggregate and keep it live via the gateway. Incoming
 * `channelSync` and `aggregateUpdate` events patch the react-query cache
 * under `channelAggregateQueryKey(agentId, channelName)`.
 *
 * Typed on `TData` — the shape of `aggregate.data`. Defaults to the generic
 * `Record<string, JSONValue>` used by `Aggregate`.
 */
export function useChannelAggregate<
  TData extends Aggregate["data"] = Aggregate["data"],
>(
  identifier: ChannelIdentifier,
): UseQueryResult<Aggregate<TData> | undefined> {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  const { agentId, channelName } = identifier;
  const key = channelAggregateQueryKey(agentId, channelName);

  const onAggregate = useCallback(
    (aggregate: Aggregate) => {
      queryClient.setQueryData(key, aggregate as Aggregate<TData>);
    },
    // The key array is structurally stable per (agentId, channelName).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, agentId, channelName],
  );

  useChannelSubscription(identifier, { onAggregate });

  return useQuery({
    queryKey: key,
    enabled: !!agentId && !!channelName,
    staleTime: Infinity,
    queryFn: () =>
      client.viewer.getAggregate(identifier) as Promise<Aggregate<TData> | undefined>,
  });
}
