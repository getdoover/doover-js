import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import type { MessageBody, MessageMutationParams } from "../apis/messages-api";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";

export interface UseUpdateMessageOptions {
  /** If true, use PUT (replace) instead of PATCH (merge). Default PATCH. */
  replace?: boolean;
  params?: MessageMutationParams;
}

export interface UpdateMessageVariables {
  messageId: string;
  body: MessageBody;
}

/**
 * Mutation wrapping `MessagesApi.patchMessage` or `putMessage`. Bound to a
 * single channel; the message id and body are passed per-call.
 */
export function useUpdateMessage(
  identifier: ChannelIdentifier,
  options?: UseUpdateMessageOptions,
): UseMutationResult<unknown, Error, UpdateMessageVariables> {
  const client = useDooverClient();
  const replace = options?.replace ?? false;
  const params = options?.params;

  return useMutation({
    mutationFn: ({ messageId, body }: UpdateMessageVariables) => {
      if (!identifier.agentId || !identifier.channelName) {
        throw new Error(
          "useUpdateMessage requires both agentId and channelName on the identifier.",
        );
      }
      return replace
        ? client.messages.putMessage(
            identifier.agentId,
            identifier.channelName,
            messageId,
            body,
            params,
          )
        : client.messages.patchMessage(
            identifier.agentId,
            identifier.channelName,
            messageId,
            body,
            params,
          );
    },
  });
}
