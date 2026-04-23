import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import type { Aggregate } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";
import { channelAggregateQueryKey } from "./useChannelAggregate";

export interface UseUpdateAggregateOptions {
  /** If true, use PUT semantics (replace) instead of PATCH (merge). */
  replace?: boolean;
}

/**
 * Mutation wrapping `DooverDataProvider.updateAggregate` (PATCH) or
 * `putAggregate` (PUT when `replace: true`). Also writes the returned
 * aggregate into the react-query cache for its channel so consumers of
 * `useChannelAggregate` see the change immediately.
 */
export function useUpdateAggregate(
  identifier: ChannelIdentifier,
  options?: UseUpdateAggregateOptions,
): UseMutationResult<Aggregate, Error, object> {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  const replace = options?.replace ?? false;

  return useMutation({
    mutationFn: (data: object) =>
      replace
        ? client.viewer.putAggregate(identifier, data)
        : client.viewer.updateAggregate(identifier, data),
    onSuccess: (aggregate) => {
      queryClient.setQueryData(
        channelAggregateQueryKey(identifier.agentId, identifier.channelName),
        aggregate,
      );
    },
  });
}
