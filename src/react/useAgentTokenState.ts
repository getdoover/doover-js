import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import type {
  AgentTokenPolicy,
  AgentTokenState,
  ResourcePermission,
} from "../apis/agents-api.js";
import { useDooverClient } from "./context.js";

export function agentTokenStateQueryKey(agentId: string | undefined) {
  return ["doover", "agent", agentId ?? null, "tokenState"] as const;
}

export interface UseAgentTokenStateOptions {
  enabled?: boolean;
  staleTime?: number;
}

/**
 * Read an agent's credential state — revocation floor, auth kill-switch, and the
 * token posture resolved across the per-agent override and organisation default.
 *
 * Deliberately short `staleTime`: `auth_locked` can be flipped by doover-data
 * itself (automatic lockout on suspected token reuse), so this value changes
 * without any action from this client. Showing a stale "not locked" on the one
 * screen someone opens *because* their device went offline would be worse than
 * an extra fetch.
 */
export function useAgentTokenState(
  agentId: string | undefined,
  options?: UseAgentTokenStateOptions,
): UseQueryResult<AgentTokenState> {
  const client = useDooverClient();
  return useQuery({
    queryKey: agentTokenStateQueryKey(agentId),
    enabled: (options?.enabled ?? true) && Boolean(agentId),
    staleTime: options?.staleTime ?? 15 * 1000,
    queryFn: () => client.agents.getTokenState(agentId as string),
  });
}

/**
 * Write an agent's token-posture override. Full replacement — a null field means
 * "inherit the organisation default".
 *
 * Invalidates the token-state query on success so the inherited-vs-overridden
 * display reflects the write without the caller wiring that up.
 */
export function useSetAgentTokenPolicy(agentId: string | undefined) {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (policy: AgentTokenPolicy) =>
      client.agents.setTokenPolicy(agentId as string, policy),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: agentTokenStateQueryKey(agentId),
      });
    },
  });
}

/** Set or clear the auth kill-switch. */
export function useSetAgentAuthLock(agentId: string | undefined) {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (locked: boolean) =>
      client.agents.setAuthLock(agentId as string, locked),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: agentTokenStateQueryKey(agentId),
      });
    },
  });
}

/**
 * Mint a short-lived scoped token for ad-hoc access to an agent.
 *
 * Does not invalidate the token-state query: an ad-hoc token is a JWT with its
 * own expiry and doesn't touch the revocation floor or the agent's posture, so
 * there is nothing in that query for it to change.
 *
 * The resulting token is returned once and is not retrievable afterwards — hand
 * it straight to the user and don't cache it.
 */
export function useCreateAdhocToken(agentId: string | undefined) {
  const client = useDooverClient();
  return useMutation({
    mutationFn: (options: {
      permissions?: ResourcePermission[];
      timeout?: number;
    }) => client.agents.createAdhocToken(agentId as string, options),
  });
}

/**
 * Set the revocation floor to an explicit point; pass `0` or `null` to clear it.
 *
 * Lowering it reverses a revocation, so this is for undoing one made by mistake
 * rather than for recovering a device whose credentials leaked.
 */
export function useSetRevocationFloor(agentId: string | undefined) {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (tokensValidFrom: number | null) =>
      client.agents.setRevocationFloor(agentId as string, tokensValidFrom),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: agentTokenStateQueryKey(agentId),
      });
    },
  });
}

/**
 * Mint the device's long-lived credential for manual provisioning, returned once.
 *
 * Invalidates the token-state query so the revocation floor display stays honest
 * — the mint itself is additive and doesn't move the floor, but refetching keeps
 * this in step with anything else that has changed since the panel loaded.
 */
export function useCreateDeviceToken(agentId: string | undefined) {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.agents.createDeviceToken(agentId as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: agentTokenStateQueryKey(agentId),
      });
    },
  });
}

/**
 * Revoke every outstanding long-lived credential for an agent.
 *
 * Break-glass: the device stays offline until it is re-provisioned. Confirm with
 * the user before calling.
 */
export function useRevokeAgentTokens(agentId: string | undefined) {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => client.agents.revokeAllTokens(agentId as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: agentTokenStateQueryKey(agentId),
      });
    },
  });
}
