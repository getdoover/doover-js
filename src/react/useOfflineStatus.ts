import { useMemo, useSyncExternalStore } from "react";

import type { OfflineStatusSnapshot } from "../client/offline-cache.js";
import { browserNetworkStatus } from "../client/network-status.js";
import { useDooverClient } from "./context.js";

export type { OfflineStatusSnapshot } from "../client/offline-cache.js";

export interface OfflineStatusClient {
  getOfflineStatus(): OfflineStatusSnapshot;
  onOfflineStatusChange(listener: (status: OfflineStatusSnapshot) => void): () => void;
}

export function hasOfflineStatus(client: unknown): client is OfflineStatusClient {
  return !!client && typeof client === "object" &&
    "getOfflineStatus" in client && typeof client.getOfflineStatus === "function" &&
    "onOfflineStatusChange" in client && typeof client.onOfflineStatusChange === "function";
}

const SERVER_OFFLINE_STATUS: OfflineStatusSnapshot = {
  online: true, state: "online", isOfflineFallback: false, isExpired: false, at: 0,
};

export function useOfflineStatus(): OfflineStatusSnapshot {
  const client = useDooverClient();
  const store = useMemo(() => {
    if (hasOfflineStatus(client)) {
      return {
        subscribe: (listener: () => void) => client.onOfflineStatusChange(listener),
        getSnapshot: () => client.getOfflineStatus(),
      };
    }
    const network = client.networkStatus ?? browserNetworkStatus;
    let previous = network.getSnapshot();
    let snapshot: OfflineStatusSnapshot = { ...SERVER_OFFLINE_STATUS, ...previous };
    return {
      subscribe: (listener: () => void) => network.subscribe(listener),
      getSnapshot: () => {
        const next = network.getSnapshot();
        if (next !== previous) {
          previous = next;
          snapshot = { ...SERVER_OFFLINE_STATUS, ...next };
        }
        return snapshot;
      },
    };
  }, [client]);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => SERVER_OFFLINE_STATUS);
}
