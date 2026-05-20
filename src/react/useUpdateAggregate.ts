import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import type { AggregateMutationParams } from "../apis/aggregates-api";
import type { Aggregate } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";
import { channelAggregateQueryKey } from "./useChannelAggregate";

export interface UseUpdateAggregateOptions {
  /** If true, use PUT semantics (replace) instead of PATCH (merge). */
  replace?: boolean;
  /**
   * Forwarded as query params to the aggregate endpoint:
   * `log_update` (record a history message), `clear_attachments`,
   * `suppress_response`. See `AggregateMutationParams`.
   */
  params?: AggregateMutationParams;
  /**
   * Restrict the write to these source ids on a `MultiplexClient`. Ignored
   * for a plain `DooverClient` or `LocalAgentClient`. Also scopes the
   * react-query cache invalidation to the matching source-dimensioned key.
   */
  sources?: string[];
}

/**
 * Mutation wrapping `DooverDataProvider.updateAggregate` (PATCH) or
 * `putAggregate` (PUT when `replace: true`). Also writes the returned
 * aggregate into the react-query cache for its channel so consumers of
 * `useChannelAggregate` see the change immediately.
 */
export function useUpdateAggregate<TData extends object = object>(
  identifier: ChannelIdentifier,
  options?: UseUpdateAggregateOptions,
): UseMutationResult<Aggregate<TData>, Error, TData> {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  const replace = options?.replace ?? false;
  const params = options?.params;
  const sources = options?.sources;

  return useMutation({
    mutationFn: (data: TData) => {
      if (!identifier.agentId || !identifier.channelName) {
        return Promise.reject(new Error("Identifier must include agentId and channelName"));
      }
      const id = { agentId: identifier.agentId, channelName: identifier.channelName };
      const body = data as Record<string, unknown>;
      // Pass `{ sources }` as a trailing bag only when set — cast through
      // `never` since the TypeScript overloads don't declare it.
      const sourcesArg = sources ? { sources } : undefined;
      if (replace) {
        return (sourcesArg
          ? (client.aggregates.putAggregate as unknown as (...a: unknown[]) => Promise<Aggregate<TData>>)(id, body, params, sourcesArg)
          : client.aggregates.putAggregate(id, body, params)) as Promise<Aggregate<TData>>;
      }
      return (sourcesArg
        ? (client.aggregates.patchAggregate as unknown as (...a: unknown[]) => Promise<Aggregate<TData>>)(id, body, params, sourcesArg)
        : client.aggregates.patchAggregate(id, body, params)) as Promise<Aggregate<TData>>;
    },
    onSuccess: (aggregate) => {
      queryClient.setQueryData(
        channelAggregateQueryKey(identifier.agentId, identifier.channelName, sources),
        aggregate,
      );
    },
  });
}
