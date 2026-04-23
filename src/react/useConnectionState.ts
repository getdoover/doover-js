import { useEffect, useState } from "react";

import { useDooverClient } from "./context";

export type ConnectionStatus = "connecting" | "open";

export interface ConnectionState {
  /**
   * `"open"` once the gateway has received a `Ready` frame;
   * `"connecting"` any time the socket is reconnecting or awaiting Ready.
   */
  status: ConnectionStatus;
  /** Timestamp of the most recent `Ready` frame, or `null` until the first one. */
  lastOpenedAt: number | null;
}

const INITIAL: ConnectionState = {
  status: "connecting",
  lastOpenedAt: null,
};

/**
 * Subscribes to the gateway's connection lifecycle and returns a snapshot
 * suitable for a connection-indicator UI.
 *
 * The gateway doesn't measure application-level latency — liveness is
 * handled at the WebSocket-protocol layer via ping/pong frames (opcodes
 * 0x9 / 0xA) which browsers answer automatically but don't expose to JS.
 * Dead connections surface as the `close` event, which we already handle
 * via auto-reconnect.
 */
export function useConnectionState(): ConnectionState {
  const client = useDooverClient();
  const [state, setState] = useState<ConnectionState>(() =>
    client.gateway.isConnected() && client.gateway.getSession()
      ? {
          status: "open",
          lastOpenedAt: Date.now(),
        }
      : INITIAL,
  );

  useEffect(() => {
    const onReady = () =>
      setState((prev) => ({
        ...prev,
        status: "open",
        lastOpenedAt: Date.now(),
      }));
    const onClose = () =>
      setState((prev) => ({ ...prev, status: "connecting" }));

    client.gateway.on("ready", onReady);
    client.gateway.on("close", onClose);

    return () => {
      client.gateway.off("ready", onReady);
      client.gateway.off("close", onClose);
    };
  }, [client]);

  return state;
}
