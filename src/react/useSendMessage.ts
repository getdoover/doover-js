import { useMutation, type UseMutationResult } from "@tanstack/react-query";

import type { MessageStructure } from "../types/common";
import type { ChannelIdentifier } from "../types/viewer";
import { useDooverClient } from "./context";

/**
 * Mutation wrapping `DooverDataProvider.sendMessage`. Posts a JSON message
 * to the channel and resolves with the created `MessageStructure` (including
 * its server-assigned `id` and `timestamp`).
 */
export function useSendMessage(
  identifier: ChannelIdentifier,
): UseMutationResult<MessageStructure, Error, object> {
  const client = useDooverClient();
  return useMutation({
    mutationFn: (data: object) => client.viewer.sendMessage(identifier, data),
  });
}
