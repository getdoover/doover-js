import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import type { MessageStructure } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";

export interface UseSendMessageOptions {
  /**
   * Restrict the write to these source ids on a `MultiplexClient`. Ignored
   * for a plain `DooverClient` or `LocalAgentClient`.
   */
  sources?: string[];
}

/**
 * Mutation wrapping `DooverDataProvider.sendMessage`. Posts a JSON message
 * to the channel and resolves with the created `MessageStructure` (including
 * its server-assigned `id` and `timestamp`).
 */
export function useSendMessage<TData extends object = object>(
  identifier: ChannelIdentifier,
  options?: UseSendMessageOptions,
): UseMutationResult<MessageStructure<TData>, Error, TData> {
  const client = useDooverClient();
  const sources = options?.sources;
  return useMutation({
    mutationFn: (data: TData) => {
      if (!identifier.agentId || !identifier.channelName) {
        return Promise.reject(new Error("Identifier must include agentId and channelName"));
      }
      const id = { agentId: identifier.agentId, channelName: identifier.channelName };
      const body = { data: data as Record<string, unknown> };
      // Pass `{ sources }` as a trailing bag only when set — cast through
      // `never` since the TypeScript overloads don't declare it.
      const sourcesArg = sources ? { sources } : undefined;
      return (sourcesArg
        ? (client.messages.postMessage as unknown as (...a: unknown[]) => Promise<MessageStructure<TData>>)(id, body, sourcesArg)
        : client.messages.postMessage(id, body)) as Promise<MessageStructure<TData>>;
    },
  });
}
