import type { Aggregate } from "../types/common.js";
import {
  useChannelAggregate,
  type UseChannelAggregateOptions,
} from "./useChannelAggregate.js";

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
