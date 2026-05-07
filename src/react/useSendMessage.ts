import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import type { MessageStructure } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";

/**
 * Mutation wrapping `DooverDataProvider.sendMessage`. Posts a JSON message
 * to the channel and resolves with the created `MessageStructure` (including
 * its server-assigned `id` and `timestamp`).
 */
export function useSendMessage<TData extends object = object>(
  identifier: ChannelIdentifier,
): UseMutationResult<MessageStructure<TData>, Error, TData> {
  const client = useDooverClient();
  return useMutation({
    mutationFn: (data: TData) => {
      if (!identifier.agentId || !identifier.channelName) {
        return Promise.reject(new Error("Identifier must include agentId and channelName"));
      }
      return client.messages.postMessage(
        { agentId: identifier.agentId, channelName: identifier.channelName },
        { data: data as Record<string, unknown> },
      ) as Promise<MessageStructure<TData>>;
    },
  });
}
