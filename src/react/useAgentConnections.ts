import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { ConnectionDetails } from "../types/common";
import { useDooverClient } from "./context";

export function agentConnectionsQueryKey(agentId: string | undefined) {
  return ["doover", "agent", agentId, "connections"] as const;
}

/**
 * Fetch the list of active WSS connections for an agent. Query key:
 * `["doover", "agent", agentId, "connections"]`.
 */
export function useAgentConnections(
  agentId: string | undefined,
): UseQueryResult<ConnectionDetails[]> {
  const client = useDooverClient();
  return useQuery({
    queryKey: agentConnectionsQueryKey(agentId),
    enabled: !!agentId,
    staleTime: 30_000,
    queryFn: () =>
      agentId
        ? client.connections.getAgentConnections(agentId)
        : Promise.resolve([] as ConnectionDetails[]),
  });
}
