import { useCallback, useMemo, useState } from "react";
import {
  useMutation,
  type UseMutateAsyncFunction,
  type UseMutateFunction,
  type UseMutationResult,
} from "@tanstack/react-query";

import type { RpcRequest, RpcStatus } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";

export type RpcCommandId = string;

export interface RpcStatusEvent<TPending = undefined> {
  commandId: RpcCommandId;
  status: RpcStatus<TPending>;
  timestamp: number;
}

export interface SendRpcVariables<TRequest = object> {
  commandId: RpcCommandId;
  request: TRequest;
  /** Optional per-call override of the app_key. */
  app_key?: string;
}

interface CommandState<TPending, TResponse> {
  current: RpcStatus<TPending>;
  history: RpcStatusEvent<TPending>[];
  submittedAt: number;
  settledAt?: number;
  data?: TResponse;
  error?: unknown;
}

type CommandStatuses<TPending, TResponse> = Record<
  RpcCommandId,
  CommandState<TPending, TResponse>
>;

export interface UseSendRpcOptions {
  /** Method name passed on every RPC from this hook. */
  method: string;
  /** Default app_key. Overridable per-call via variables.app_key. */
  app_key?: string;
  /**
   * react-query mutation key. Defaults to
   * `["doover", "agent", agentId, "channel", channelName, "rpc", method]`.
   */
  mutationKey?: readonly unknown[];
}

export interface UseSendRpcResult<TRequest, TResponse, TPending>
  extends Omit<
    UseMutationResult<TResponse, unknown, SendRpcVariables<TRequest>, void>,
    "isPending" | "mutate" | "mutateAsync"
  > {
  /** Most recent status across all commands (by `submittedAt`). */
  currentStatus: RpcStatus<TPending> | undefined;
  commandStatuses: CommandStatuses<TPending, TResponse>;
  getStatus: (commandId: RpcCommandId) => RpcStatus<TPending> | undefined;
  getHistory: (commandId: RpcCommandId) => RpcStatusEvent<TPending>[];
  getCommandState: (
    commandId: RpcCommandId,
  ) => CommandState<TPending, TResponse> | undefined;
  isPending: {
    (): boolean;
    (commandId: RpcCommandId): boolean;
  };
  mutate: UseMutateFunction<TResponse, unknown, SendRpcVariables<TRequest>, void>;
  mutateAsync: UseMutateAsyncFunction<
    TResponse,
    unknown,
    SendRpcVariables<TRequest>,
    void
  >;
}

const SENT_STATUS: RpcStatus<never> = { code: "sent" };

function isTerminal<TPending>(status: RpcStatus<TPending> | undefined) {
  return status?.code === "success" || status?.code === "error";
}

function isPendingCode<TPending>(status: RpcStatus<TPending> | undefined) {
  return (
    status?.code === "sent" ||
    status?.code === "acknowledged" ||
    status?.code === "deferred" ||
    status?.code === "pending"
  );
}

function toErrorStatus(error: unknown): RpcStatus<never> {
  if (error instanceof Error) return { code: "error", message: error.message };
  if (typeof error === "string") return { code: "error", message: error };
  return { code: "error", message: "Unknown RPC error" };
}

/**
 * A react-query-integrated RPC hook. Calls
 * `DooverDataProvider.sendRPC(identifier, { method, request, app_key })`
 * under the hood and tracks a per-`commandId` status history so callers can
 * render multi-step progress UIs and error popovers.
 *
 * For low-latency ephemeral commands (camera PTZ etc.) reach for
 * `client.gateway.sendOneShotMessage` directly instead — those are not
 * persisted and don't flow through this hook.
 */
export function useSendRpc<
  TRequest = object,
  TResponse = object,
  TPending = undefined,
>(
  identifier: ChannelIdentifier,
  options: UseSendRpcOptions,
): UseSendRpcResult<TRequest, TResponse, TPending> {
  const client = useDooverClient();
  const [commandStatuses, setCommandStatuses] = useState<
    CommandStatuses<TPending, TResponse>
  >({});

  const mutationKey =
    options.mutationKey ??
    ([
      "doover",
      "agent",
      identifier.agentId,
      "channel",
      identifier.channelName,
      "rpc",
      options.method,
    ] as const);

  const appendStatus = useCallback(
    (commandId: RpcCommandId, status: RpcStatus<TPending>) => {
      const timestamp = Date.now();
      setCommandStatuses((current) => {
        const existing = current[commandId];
        if (!existing || existing.settledAt !== undefined) return current;
        return {
          ...current,
          [commandId]: {
            ...existing,
            current: status,
            history: [...existing.history, { commandId, status, timestamp }],
          },
        };
      });
    },
    [],
  );

  const settleCommand = useCallback(
    (
      commandId: RpcCommandId,
      updates: {
        data?: TResponse;
        error?: unknown;
        fallbackStatus?: RpcStatus<TPending>;
      },
    ) => {
      setCommandStatuses((current) => {
        const existing = current[commandId];
        if (!existing) return current;
        const settledAt = Date.now();
        const next: CommandState<TPending, TResponse> = {
          ...existing,
          settledAt,
        };
        if ("data" in updates) next.data = updates.data;
        if ("error" in updates) next.error = updates.error;
        if (updates.fallbackStatus && !isTerminal(existing.current)) {
          next.current = updates.fallbackStatus;
          next.history = [
            ...existing.history,
            {
              commandId,
              status: updates.fallbackStatus,
              timestamp: settledAt,
            },
          ];
        }
        return { ...current, [commandId]: next };
      });
    },
    [],
  );

  const mutation = useMutation<
    TResponse,
    unknown,
    SendRpcVariables<TRequest>,
    void
  >({
    mutationKey: [...mutationKey],
    mutationFn: async ({ commandId, request, app_key }) => {
      const submittedAt = Date.now();
      setCommandStatuses((current) => ({
        ...current,
        [commandId]: {
          current: SENT_STATUS as RpcStatus<TPending>,
          history: [
            {
              commandId,
              status: SENT_STATUS as RpcStatus<TPending>,
              timestamp: submittedAt,
            },
          ],
          submittedAt,
        },
      }));

      const rpcRequest: RpcRequest<TRequest> = {
        method: options.method,
        request,
        ...(app_key !== undefined
          ? { app_key }
          : options.app_key !== undefined
            ? { app_key: options.app_key }
            : {}),
      };

      return client.viewer.sendRPC<TRequest, TResponse, TPending>(
        identifier,
        rpcRequest,
        {
          onStatus: (status) => appendStatus(commandId, status),
        },
      );
    },
    onSuccess: (data, variables) =>
      settleCommand(variables.commandId, {
        data,
        fallbackStatus: { code: "success" },
      }),
    onError: (error, variables) =>
      settleCommand(variables.commandId, {
        error,
        fallbackStatus: toErrorStatus(error) as RpcStatus<TPending>,
      }),
  });

  const getCommandState = useCallback(
    (commandId: RpcCommandId) => commandStatuses[commandId],
    [commandStatuses],
  );
  const getStatus = useCallback(
    (commandId: RpcCommandId) => getCommandState(commandId)?.current,
    [getCommandState],
  );
  const getHistory = useCallback(
    (commandId: RpcCommandId) => getCommandState(commandId)?.history ?? [],
    [getCommandState],
  );

  const currentStatus = useMemo(() => {
    const latest = Object.values(commandStatuses).reduce<
      CommandState<TPending, TResponse> | undefined
    >((acc, state) => {
      if (!acc || state.submittedAt > acc.submittedAt) return state;
      return acc;
    }, undefined);
    return latest?.current;
  }, [commandStatuses]);

  const isPending = ((commandId?: RpcCommandId) => {
    if (commandId === undefined) return mutation.isPending;
    return isPendingCode(getStatus(commandId));
  }) as UseSendRpcResult<TRequest, TResponse, TPending>["isPending"];

  return {
    ...mutation,
    mutate: mutation.mutate,
    mutateAsync: mutation.mutateAsync,
    currentStatus,
    commandStatuses,
    getStatus,
    getHistory,
    getCommandState,
    isPending,
  };
}
