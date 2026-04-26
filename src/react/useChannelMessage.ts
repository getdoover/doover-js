import { useCallback } from "react";
import {
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { JSONValue, MessageAttachment, MessageStructure } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";
import { useChannelSubscription } from "./useChannelSubscription";

export function channelMessageQueryKey(
  agentId: string | undefined,
  channelName: string | undefined,
  messageId: string | undefined,
) {
  return [
    "doover",
    "agent",
    agentId,
    "channel",
    channelName,
    "message",
    messageId,
  ] as const;
}

export interface UseChannelMessageOptions {
  /** If false, skip subscribing for live message-update events. Defaults true. */
  liveUpdates?: boolean;
}

/**
 * Shape returned by `useChannelMessage`. Mirrors `UseChannelAggregateResult`:
 * `data` is unwrapped to the message payload (`message.data`) so the common
 * `const { data } = useChannelMessage(…)` pattern works without a secondary
 * access. The full `MessageStructure` and a couple of useful slots
 * (`attachments`, `timestamp`) are hoisted alongside.
 */
export interface UseChannelMessageResult<TData>
  extends Omit<UseQueryResult<MessageStructure<TData> | undefined>, "data"> {
  /** Unwrapped message payload (`message.data`). Undefined until first fetch. */
  data: TData | undefined;
  /** Full message structure, or undefined until first fetch. */
  message: MessageStructure<TData> | undefined;
  attachments: MessageAttachment[] | undefined;
  /** Server timestamp reported by the message. */
  timestamp: number | undefined;
}

/**
 * Fetch a single channel message by id and keep it live via gateway
 * `MessageUpdate` events. Mirrors `useChannelAggregate`'s pattern: REST seeds
 * the cache, then `onMessageUpdate` patches it whenever the message body is
 * mutated server-side — handy for watching long-running RPC-style messages
 * where the receiver writes progress into a `response` field.
 *
 * Channel subscriptions deliver every message in the channel, so the
 * handlers filter to the requested `messageId` before patching the cache.
 *
 * Typed on `TData` — the shape of `message.data`. Defaults to `JSONValue` to
 * match `MessageStructure`.
 */
export function useChannelMessage<TData = JSONValue>(
  identifier: ChannelIdentifier,
  messageId: string | undefined,
  options?: UseChannelMessageOptions,
): UseChannelMessageResult<TData> {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  const { agentId, channelName } = identifier;
  const liveUpdates = options?.liveUpdates ?? true;
  const key = channelMessageQueryKey(agentId, channelName, messageId);

  const onMessageUpdate = useCallback(
    (message: MessageStructure) => {
      if (message.id !== messageId) return;
      queryClient.setQueryData(key, message as MessageStructure<TData>);
    },
    // The key array is structurally stable per (agentId, channelName, messageId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, agentId, channelName, messageId],
  );

  // Cover the case where the caller has the id before the create event has
  // landed on this client — patch the cache when it shows up.
  const onMessage = useCallback(
    (message: MessageStructure) => {
      if (message.id !== messageId) return;
      queryClient.setQueryData(key, message as MessageStructure<TData>);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, agentId, channelName, messageId],
  );

  useChannelSubscription(
    liveUpdates && messageId ? identifier : undefined,
    { onMessage, onMessageUpdate },
  );

  const query = useQuery<MessageStructure<TData> | undefined>({
    queryKey: key,
    enabled: !!agentId && !!channelName && !!messageId,
    staleTime: Infinity,
    queryFn: () =>
      client.messages.getMessage(
        agentId as string,
        channelName as string,
        messageId as string,
      ) as Promise<MessageStructure<TData> | undefined>,
  });

  const message = query.data;
  const { data: _ignored, ...rest } = query;
  return {
    ...rest,
    data: message?.data,
    message,
    attachments: message?.attachments,
    timestamp: message?.timestamp,
  };
}
