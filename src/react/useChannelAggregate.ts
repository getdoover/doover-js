import { useCallback } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import type { Aggregate } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { DooverApiError } from "../http/errors";
import { useDooverClient } from "./context";
import { useChannelSubscription } from "./useChannelSubscription";

export function channelAggregateQueryKey(
  agentId: string | undefined,
  channelName: string | undefined,
) {
  return ["doover", "agent", agentId, "channel", channelName] as const;
}

/**
 * Shape returned by `useChannelAggregate`. Shadows the react-query
 * `data` field with the unwrapped aggregate payload (`TData`) so the
 * common call-site pattern — `const { data } = useChannelAggregate(…)` —
 * just works without a secondary `.data` access or cast. The
 * `attachments` and `last_updated` slots are hoisted alongside for the
 * same reason; everything else (isLoading, isError, refetch, status,
 * …) passes through from react-query unchanged.
 */
export interface UseChannelAggregateResult<TData>
  extends Omit<UseQueryResult<Aggregate<TData> | undefined>, "data"> {
  /** The aggregate payload. `undefined` until the first fetch lands. */
  data: TData | undefined;
  /** Attachments (files/blobs) on the aggregate. */
  attachments: Aggregate["attachments"] | undefined;
  /** Server timestamp (epoch seconds) of the last aggregate update. */
  last_updated: number | null | undefined;
}

export interface UseChannelAggregateOptions {
  /**
   * Whether to fetch the initial aggregate over REST on mount.
   *
   * Defaults to `true` — the hook does a one-shot HTTP GET to seed the cache
   * before the gateway WebSocket has connected, so the first paint isn't
   * empty.
   *
   * Set to `false` for purely WS-driven consumers that don't want the REST
   * round-trip (e.g. when the gateway's upsert-on-subscribe semantics make
   * the REST call redundant or actively wrong, like channels that don't yet
   * exist). The cache is then populated only by `ChannelSync` /
   * `AggregateUpdate` events.
   */
  fetchInitial?: boolean;
}

/**
 * Fetch a channel's aggregate and keep it live via the gateway. Incoming
 * `channelSync` and `aggregateUpdate` events patch the react-query cache
 * under `channelAggregateQueryKey(agentId, channelName)`.
 *
 * Typed on `TData` — the shape of `aggregate.data`. Defaults to the generic
 * `Record<string, JSONValue>` used by `Aggregate`. No `extends` constraint
 * on the generic: typed aggregate interfaces (e.g. `{ enabled: boolean }`)
 * don't have the implicit index signature that `Aggregate["data"]` carries
 * and enforcing compatibility there just forces `as` casts at call sites.
 */
export function useChannelAggregate<TData = Aggregate["data"]>(
  identifier: ChannelIdentifier,
  options?: UseChannelAggregateOptions,
): UseChannelAggregateResult<TData> {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  const { agentId, channelName } = identifier;
  const key = channelAggregateQueryKey(agentId, channelName);
  const fetchInitial = options?.fetchInitial ?? true;

  const onAggregate = useCallback(
    (aggregate: Aggregate) => {
      queryClient.setQueryData(key, aggregate as Aggregate<TData>);
    },
    // The key array is structurally stable per (agentId, channelName).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, agentId, channelName],
  );

  useChannelSubscription(identifier, { onAggregate });

  const query = useQuery({
    queryKey: key,
    enabled: fetchInitial && !!agentId && !!channelName,
    staleTime: Infinity,
    queryFn: () =>
      client.viewer.getAggregate(identifier) as Promise<Aggregate<TData> | undefined>,
    // A 404 means the aggregate doesn't exist — retrying won't change that,
    // and the caller needs the error promptly to render an empty/"not
    // installed" state. Fall back to the react-query default (3 retries) for
    // every other failure.
    retry: (failureCount, error) => {
      if (error instanceof DooverApiError && error.status === 404) return false;
      return failureCount < 3;
    },
  });

  const aggregate = query.data;
  const { data: _ignored, ...rest } = query;
  return {
    ...rest,
    data: aggregate?.data,
    attachments: aggregate?.attachments,
    last_updated: aggregate?.last_updated,
  };
}
