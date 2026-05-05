import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";

export function invocationLogsQueryKey(
  agentId: string | undefined,
  channelName: string | undefined,
  messageId: string | undefined,
) {
  return [
    "doover",
    "agent",
    agentId,
    "channel",
    channelName,
    "message",
    messageId,
    "logs",
  ] as const;
}

export interface UseInvocationLogsOptions {
  /** Defaults to true. Set false to skip the query (e.g. dialog closed). */
  enabled?: boolean;
  /**
   * react-query retry behaviour. Defaults to false — the logs endpoint
   * commonly 404s while logs are still materialising server-side, and a
   * manual refetch button is friendlier than silent retry.
   */
  retry?: boolean | number;
}

/**
 * Fetch the log entries for a single invocation message. The `/logs`
 * endpoint is only meaningful for invocation messages (channel name like
 * `dv-proc-inv-…`); other message types return 404.
 *
 * Generic on `TLog` — the shape of a single log entry. Defaults to `unknown`
 * because log payloads are domain-specific (lambda telemetry, app-level
 * structured logs, etc.) and doover-js does not own the canonical shape.
 */
export function useInvocationLogs<TLog = unknown>(
  identifier: ChannelIdentifier,
  messageId: string | undefined,
  options?: UseInvocationLogsOptions,
): UseQueryResult<TLog[]> {
  const client = useDooverClient();
  const { agentId, channelName } = identifier;
  return useQuery({
    queryKey: invocationLogsQueryKey(agentId, channelName, messageId),
    queryFn: () =>
      client.messages.getInvocationLogs<TLog>(
        agentId as string,
        channelName as string,
        messageId as string,
      ),
    enabled:
      !!agentId &&
      !!channelName &&
      !!messageId &&
      (options?.enabled ?? true),
    retry: options?.retry ?? false,
    staleTime: Infinity,
  });
}
