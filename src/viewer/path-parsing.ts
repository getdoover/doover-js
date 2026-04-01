import type { ChannelIdentifier } from "../types/viewer";

export function getIdentifierFromPath<TIdentifier extends ChannelIdentifier>(
  path: string,
  _searchParams: URLSearchParams,
): { identifier: TIdentifier; aggregatePath?: string } {
  const cleaned = path.replace(/^\/+|\/+$/g, "");
  const parts = cleaned ? cleaned.split("/") : [];
  if (parts.length === 1) {
    return {
      identifier: {
        agentId: parts[0],
        channelName: undefined,
      } as TIdentifier,
    };
  }
  if (parts.length === 2) {
    return {
      identifier: {
        agentId: parts[0],
        channelName: parts[1],
      } as TIdentifier,
    };
  }
  if (parts.length > 2) {
    return {
      identifier: {
        agentId: parts[0],
        channelName: parts[1],
      } as TIdentifier,
      aggregatePath: parts.slice(2).join("/"),
    };
  }
  return {
    identifier: {
      agentId: undefined,
      channelName: undefined,
    } as TIdentifier,
  };
}
