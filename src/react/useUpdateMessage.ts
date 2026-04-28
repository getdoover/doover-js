import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import type { MessageBody, MessageMutationParams } from "../apis/messages-api";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";

export interface UpdateMessageCallOptions {
  /**
   * If true, use PUT (replace) instead of PATCH (merge). Falls back to
   * the hook-level `replace` option, which itself defaults to PATCH.
   */
  replace?: boolean;
  /**
   * Query params forwarded to the message endpoint. Merged over the
   * hook-level `params` option (per-call keys win).
   */
  params?: MessageMutationParams;
}

export interface UseUpdateMessageOptions extends UpdateMessageCallOptions {}

export interface UpdateMessageVariables<TBody extends MessageBody = MessageBody> {
  messageId: string;
  body: TBody;
  /**
   * Per-call overrides. Extensible — add new knobs here without breaking
   * the variables shape.
   */
  options?: UpdateMessageCallOptions;
}

/**
 * Mutation wrapping `MessagesApi.patchMessage` or `putMessage`. Bound to a
 * single channel; the message id and body are passed per-call. Each
 * invocation can override `replace` / `params` via `variables.options` for
 * mutation sites that sometimes PUT and sometimes PATCH the same channel.
 */
export function useUpdateMessage<TBody extends MessageBody = MessageBody>(
  identifier: ChannelIdentifier,
  options?: UseUpdateMessageOptions,
): UseMutationResult<unknown, Error, UpdateMessageVariables<TBody>> {
  const client = useDooverClient();
  const defaultReplace = options?.replace ?? false;
  const defaultParams = options?.params;

  return useMutation({
    mutationFn: ({
      messageId,
      body,
      options: call,
    }: UpdateMessageVariables<TBody>) => {
      if (!identifier.agentId || !identifier.channelName) {
        throw new Error(
          "useUpdateMessage requires both agentId and channelName on the identifier.",
        );
      }
      const replace = call?.replace ?? defaultReplace;
      const params =
        call?.params || defaultParams
          ? { ...defaultParams, ...call?.params }
          : undefined;
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
