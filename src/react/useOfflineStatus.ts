import { useSyncExternalStore } from "react";

import type { OfflineStatusSnapshot } from "../client/offline-cache";
import { useDooverClient } from "./context";

export type { OfflineStatusSnapshot } from "../client/offline-cache";

export interface OfflineStatusClient {
  getOfflineStatus(): OfflineStatusSnapshot;
  onOfflineStatusChange(listener: (status: OfflineStatusSnapshot) => void): () => void;
}

export function hasOfflineStatus(client: unknown): client is OfflineStatusClient {
  return (
    !!client &&
    typeof client === "object" &&
    typeof (client as { getOfflineStatus?: unknown }).getOfflineStatus === "function" &&
    typeof (client as { onOfflineStatusChange?: unknown }).onOfflineStatusChange === "function"
  );
}

const UNAVAILABLE_OFFLINE_STATUS: OfflineStatusSnapshot = {
  online: true,
  state: "online",
  isOfflineFallback: false,
  isExpired: false,
  at: 0,
};

export function useOfflineStatus(): OfflineStatusSnapshot {
  const client = useDooverClient();
  return useSyncExternalStore(
    (listener) => hasOfflineStatus(client)
      ? client.onOfflineStatusChange(listener)
      : () => undefined,
    () => hasOfflineStatus(client)
      ? client.getOfflineStatus()
      : UNAVAILABLE_OFFLINE_STATUS,
    () => UNAVAILABLE_OFFLINE_STATUS,
  );
}
