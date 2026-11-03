import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { AgentCredential } from "../apis/agents-api.js";
import { useDooverClient } from "./context.js";

export function agentCredentialsQueryKey(agentId: string | undefined) {
  return ["doover", "agent", agentId ?? null, "credentials"] as const;
}

/** An agent's API keys and device keys, revoked ones included. */
export function useAgentCredentials(
  agentId: string | undefined,
  options?: { enabled?: boolean },
): UseQueryResult<AgentCredential[]> {
  const client = useDooverClient();
  return useQuery({
    queryKey: agentCredentialsQueryKey(agentId),
    enabled: (options?.enabled ?? true) && Boolean(agentId),
    queryFn: () => client.agents.listCredentials(agentId as string),
  });
}

function useCredentialMutation<V, R>(
  agentId: string | undefined,
  mutationFn: (agentId: string, vars: V) => Promise<R>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: V) => mutationFn(agentId as string, vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: agentCredentialsQueryKey(agentId),
      });
    },
  });
}

/** Mint an API key. The key is in the result once; hand it straight to the user. */
export function useCreateApiKey(agentId: string | undefined) {
  const client = useDooverClient();
  return useCredentialMutation(agentId, (id, name: string) =>
    client.agents.createApiKey(id, name),
  );
}

/** Register a device's P-256 public key (PEM or JWK). */
export function useAddDeviceKey(agentId: string | undefined) {
  const client = useDooverClient();
  return useCredentialMutation(
    agentId,
    (id, vars: { name: string; publicKey: string }) =>
      client.agents.addDeviceKey(id, vars.name, vars.publicKey),
  );
}

/** Revoke an API key or device key. Takes effect at once. */
export function useRevokeCredential(agentId: string | undefined) {
  const client = useDooverClient();
  return useCredentialMutation(agentId, (id, credentialId: string) =>
    client.agents.revokeCredential(id, credentialId),
  );
}
