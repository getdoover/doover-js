import { useCallback, useEffect, useMemo } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";

import type { MessageStructure } from "../types/common";
import { useDooverClient } from "./context";

export function multiAgentChannelMessagesQueryKey(
  channelName: string,
  agentIds: string[],
) {
  return [
    "doover",
    "channel",
    channelName,
    "messages",
    [...agentIds].sort().join(","),
  ] as const;
}

export interface UseMultiAgentChannelMessagesOptions {
  limit?: number;
  /** If false, skip live subscriptions per agent. Defaults true. */
  liveUpdates?: boolean;
  /**
   * Restrict the returned messages to those whose payload contains any
   * of these top-level field names. Forwarded as `field_name`.
   */
  fields?: string[];
  /** Optional first-page `before` cursor (snowflake id). */
  initialBefore?: string;
}

interface Page {
  results: MessageStructure[];
  next?: string;
}

export interface UseMultiAgentChannelMessagesResult
  extends Omit<UseInfiniteQueryResult<InfiniteData<Page>>, "data"> {
  messages: MessageStructure[];
  data: InfiniteData<Page> | undefined;
}

export function useMultiAgentChannelMessages(
  channelName: string,
  agentIds: string[],
  options?: UseMultiAgentChannelMessagesOptions,
): UseMultiAgentChannelMessagesResult {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  const limit = options?.limit;
  const liveUpdates = options?.liveUpdates ?? true;
  const fields = options?.fields;
  const initialBefore = options?.initialBefore;
  const key = multiAgentChannelMessagesQueryKey(channelName, agentIds);

  const prependMessage = useCallback(
    (message: MessageStructure) => {
      queryClient.setQueryData<InfiniteData<Page>>(key, (current) => {
        if (!current) return current;
        const [firstPage, ...rest] = current.pages;
        const firstResults = firstPage?.results ?? [];
        return {
          ...current,
          pages: [
            { ...firstPage, results: [message, ...firstResults] },
            ...rest,
          ],
        };
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, channelName, agentIds.join(",")],
  );

  useEffect(() => {
    if (!liveUpdates || agentIds.length === 0) return;
    const subscriptions = agentIds.map((agentId) => {
      const identifier = { agentId, channelName };
      const messageCallback = (
        _id: { agentId?: string },
        message: MessageStructure,
      ) => {
        prependMessage(message);
      };
      const aggregateCallback = () => {};
      void client.viewer.subscribeToChannel(
        identifier,
        messageCallback,
        aggregateCallback,
      );
      return { identifier, messageCallback };
    });

    return () => {
      for (const { identifier, messageCallback } of subscriptions) {
        client.viewer
          .unsubscribeFromChannel(identifier, messageCallback)
          .catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, channelName, liveUpdates, agentIds.join(",")]);

  const query = useInfiniteQuery<Page>({
    queryKey: key,
    enabled: agentIds.length > 0,
    staleTime: Infinity,
    initialPageParam: initialBefore as string | undefined,
    getNextPageParam: (lastPage) => lastPage?.next,
    queryFn: async ({ pageParam }) => {
      const page = await client.agents.getMultiAgentMessages(channelName, {
        agent_id: agentIds,
        ...(typeof pageParam === "string" ? { before: pageParam } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(fields && fields.length > 0 ? { field_name: fields } : {}),
      });
      return page;
    },
  });

  const messages = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.results),
    [query.data],
  );

  return { ...query, messages };
}
