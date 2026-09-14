import { useCallback, useSyncExternalStore } from "react";
import type { ServiceReachability } from "../client/service-reachability.js";
import { useDooverClient } from "./context.js";

const unknownSnapshot = (): ServiceReachability => "unknown";
const noop = () => {};

/** Observe data API reachability even when the browser incorrectly reports online.
 * Shares one polling loop per client; the final unmount stops checks.
 * Clients without a reachability source return unknown and make no requests. */
export function useServiceReachability(): ServiceReachability {
  const source = useDooverClient().reachability;
  const subscribe = useCallback(
    (listener: () => void) => source?.subscribe(listener) ?? noop,
    [source],
  );
  const getSnapshot = useCallback(() => source?.getSnapshot() ?? "unknown", [source]);
  return useSyncExternalStore(subscribe, getSnapshot, unknownSnapshot);
}
