import { useEffect, useState } from "react";

import { useDooverClient } from "./context";

export type ConnectionStatus = "connecting" | "open";

export interface ConnectionState {
  /**
   * `"open"` once the gateway has received a `Ready` frame;
   * `"connecting"` any time the socket is reconnecting or awaiting Ready.
   */
  status: ConnectionStatus;
  /** Round-trip latency from the last heartbeat ack, in ms. `null` until the first ack. */
  latencyMs: number | null;
  /** Timestamp of the most recent `Ready` frame, or `null` until the first one. */
  lastOpenedAt: number | null;
}

const INITIAL: ConnectionState = {
  status: "connecting",
  latencyMs: null,
  lastOpenedAt: null,
};

/**
 * Subscribes to the gateway's connection lifecycle and returns a snapshot
 * suitable for a connection-indicator UI.
 */
export function useConnectionState(): ConnectionState {
  const client = useDooverClient();
  const [state, setState] = useState<ConnectionState>(() =>
    client.gateway.isConnected() && client.gateway.getSession()
      ? {
          status: "open",
          latencyMs: client.gateway.getLatency(),
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
    const onHeartbeatAck = (latency: number | null) =>
      setState((prev) => ({ ...prev, latencyMs: latency }));

    client.gateway.on("ready", onReady);
    client.gateway.on("close", onClose);
    client.gateway.on("heartbeatAck", onHeartbeatAck);

    return () => {
      client.gateway.off("ready", onReady);
      client.gateway.off("close", onClose);
      client.gateway.off("heartbeatAck", onHeartbeatAck);
    };
  }, [client]);

  return state;
}
