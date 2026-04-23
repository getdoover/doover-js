import { useEffect, useRef } from "react";

import type { Aggregate, MessageStructure } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";

export interface ChannelSubscriptionHandlers {
  onMessage?: (message: MessageStructure) => void;
  onMessageUpdate?: (message: MessageStructure) => void;
  onAggregate?: (aggregate: Aggregate) => void;
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

    const messageCallback = (_id: ChannelIdentifier, message: MessageStructure) => {
      handlersRef.current.onMessage?.(message);
    };
    const aggregateCallback = (_id: ChannelIdentifier, aggregate: Aggregate) => {
      handlersRef.current.onAggregate?.(aggregate);
    };
    const messageUpdateCallback = (_id: ChannelIdentifier, message: MessageStructure) => {
      handlersRef.current.onMessageUpdate?.(message);
    };

    void client.viewer.subscribeToChannel(
      identifier,
      messageCallback,
      aggregateCallback,
      messageUpdateCallback,
    );

    return () => {
      client.viewer
        .unsubscribeFromChannel(identifier, messageCallback)
        .catch(() => {
          // Already unsubscribed — race between strict-mode double-effect
          // and async subscribe is harmless.
        });
    };
    // Identifier fields are the real deps; we intentionally leave `handlers`
    // out because it's read through handlersRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, identifier?.agentId, identifier?.channelName]);
}
