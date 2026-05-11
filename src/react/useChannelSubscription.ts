import { useEffect, useRef } from "react";

import type { Aggregate, JSONValue, MessageStructure } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";

export interface ChannelSubscriptionHandlers {
  onMessage?: (message: MessageStructure) => void;
  /**
   * Fires on server-side MessageUpdate events. `message` is the full updated
   * MessageStructure; `request_data` (optional) is the diff of what changed
   * in this specific update. Most consumers only need `message`.
   */
  onMessageUpdate?: (
    message: MessageStructure,
    request_data?: JSONValue,
  ) => void;
  onAggregate?: (aggregate: Aggregate) => void;
  /**
   * Reserved for future use. The composite gateway already routes by
   * `channel.agent_id`, so this option is a no-op in v1. Pass it for
   * forward-compatibility; it has no effect on the subscription.
   */
  sources?: string[];
}

/**
 * Attach live-update handlers to a channel for the lifetime of the host
 * component. Wraps `DooverDataProvider.subscribeToChannel` with ref-counted
 * subscribe/unsubscribe and handler refs so changes to the handler closures
 * don't re-trigger the underlying subscribe.
 *
 * Passing `undefined` (or an identifier without both fields) is a no-op.
 */
export function useChannelSubscription(
  identifier: ChannelIdentifier | undefined,
  handlers: ChannelSubscriptionHandlers,
) {
  const client = useDooverClient();
  const handlersRef = useRef<ChannelSubscriptionHandlers>(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!identifier?.agentId || !identifier?.channelName) return;
    const channel = { agent_id: identifier.agentId, name: identifier.channelName };
    const off = client.gateway.subscribeToChannel(channel, {
      onMessage: (msg) => handlersRef.current.onMessage?.(msg),
      onMessageUpdate: (msg, rd) => handlersRef.current.onMessageUpdate?.(msg, rd),
      onAggregate: (agg) => handlersRef.current.onAggregate?.(agg),
    });
    void client.gateway.connect();
    return () => off();
    // Identifier fields are the real deps; we intentionally leave `handlers`
    // out because it's read through handlersRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, identifier?.agentId, identifier?.channelName]);
}
