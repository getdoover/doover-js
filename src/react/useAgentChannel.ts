import type { Aggregate } from "../types/common";
import {
  useChannelAggregate,
  type UseChannelAggregateOptions,
} from "./useChannelAggregate";

/**
 * Convenience wrapper around `useChannelAggregate` that accepts an agent id
 * and channel name as separate arguments — the most common shape at call
 * sites where the identifier isn't already a `ChannelIdentifier`.
 */
export function useAgentChannel<TData = Aggregate["data"]>(
  agentId: string | undefined,
  channelName: string,
  options?: UseChannelAggregateOptions,
) {
  return useChannelAggregate<TData>({ agentId, channelName }, options);
}
