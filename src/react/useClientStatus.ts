import { useEffect, useState } from "react";

import type { DataClientStatus } from "../client/data-client";
import { useDooverClient } from "./context";

/**
 * Returns the live `DataClientStatus` for the client in context. Seeds with
 * `client.getStatus()`, subscribes via `client.onStatusChange(...)` for the
 * component's lifetime. Works for a `DooverClient` (single-source) or a
 * `MultiplexClient` (rolled-up status with a `members` breakdown). Prefer this
 * over `useConnectionState` for new code — it carries session, latency, last
 * error and per-source state.
 */
export function useClientStatus(): DataClientStatus {
  const client = useDooverClient();
  const [status, setStatus] = useState<DataClientStatus>(() => client.getStatus());

  useEffect(() => {
    setStatus(client.getStatus());
    return client.onStatusChange(setStatus);
  }, [client]);

  return status;
}
