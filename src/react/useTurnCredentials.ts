import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { TurnCredential } from "../types/common";
import type { TurnTokenRequest } from "../types/openapi";
import { useDooverClient } from "./context";

/**
 * Fetch TURN (relay) credentials for a camera stream. Cached for 10 minutes
 * by default since the token has a server-controlled TTL; consumers that
 * need refresh-on-expiry should do so at the call site.
 */
export function useTurnCredentials(
  request: TurnTokenRequest,
  options?: { enabled?: boolean; staleTime?: number },
): UseQueryResult<TurnCredential> {
  const client = useDooverClient();
  return useQuery({
    queryKey: [
      "doover",
      "turn",
      request.role,
      request.device_id ?? null,
      request.camera_name,
    ] as const,
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 10 * 60 * 1000,
    queryFn: () => client.turn.createTurnToken(request),
  });
}
