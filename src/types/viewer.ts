import type {
  Aggregate,
  Channel,
  ConnectionDetails,
  MessageStructure,
} from "./common";

export interface ChannelIdentifier {
  agentId?: string;
  channelName?: string;
  error?: string;
}

export interface Agent {
  id: string;
  organisation: string;
  name: string;
  display_name: string;
  archived: boolean;
  group: string;
  fa_icon: string;
  type: "device" | "dashboard" | "organisation" | "user";
  fixed_location: {
    latitude: number;
    longitude: number;
  };
  extra_config: Record<string, unknown>;
  connection_determination?: "Online" | "Offline";
}

export interface User {
  id: string;
  email?: string;
  name?: string;
  [key: string]: unknown;
}

export interface GetAgentsOptions {
  includeArchived?: boolean;
  includeOrganisations?: boolean;
  includeUsers?: boolean;
  /**
   * When `true`, normalized organisations and users are appended into the
   * canonical `agents` list (and mirrored to `results` / `count`). Defaults
   * to `false`, which preserves the legacy behaviour of returning only the
   * raw `agents` array.
   */
  mergeIncludedAsAgents?: boolean;
}

export interface AgentsResponse {
  agents?: Agent[];
  results?: Agent[];
  count?: number;
  [key: string]: unknown;
}

export interface SubscriptionDetails {
  channel: {
    agent_id: string;
    name: string;
  };
  connection_id: string;
  subscribed_at: number;
}

export interface ChannelsDataProvider<
  TIdentifier extends ChannelIdentifier = ChannelIdentifier,
> {
  getMe: () => Promise<User>;
  getAgents: (options?: GetAgentsOptions) => Promise<AgentsResponse>;
  getChannels: (
    identifier: TIdentifier,
    options?: { includeArchived?: boolean },
  ) => Promise<Channel[] | undefined>;
  createChannel: (
    identifier: TIdentifier,
    channelName: string,
    options?: { is_private?: boolean },
  ) => Promise<unknown>;
  archiveChannel: (identifier: TIdentifier) => Promise<unknown>;
  unarchiveChannel: (identifier: TIdentifier) => Promise<unknown>;
  getChannel: (identifier: TIdentifier) => Promise<Channel | undefined>;
  subscribeToChannel: (
    identifier: TIdentifier,
    callback: (
      identifier: ChannelIdentifier,
      message: MessageStructure,
    ) => void,
    aggregateCallback: (
      identifier: ChannelIdentifier,
      aggregate: Aggregate,
    ) => void,
  ) => Promise<void | undefined>;
  unsubscribeFromChannel: (
    identifier: TIdentifier,
    callback: (
      identifier: ChannelIdentifier,
      message: MessageStructure,
    ) => void,
  ) => Promise<void | undefined>;
  getAggregate: (identifier: TIdentifier) => Promise<Aggregate | undefined>;
  getMessages: (
    identifier: TIdentifier,
    beforeId?: string,
  ) => Promise<MessageStructure[] | undefined>;
  deleteMessage: (identifier: TIdentifier, messageId: string) => Promise<unknown>;
  sendMessage: (
    identifier: TIdentifier,
    message: object,
  ) => Promise<MessageStructure>;
  updateAggregate: (
    identifier: TIdentifier,
    message: object,
  ) => Promise<Aggregate>;
  putAggregate: (
    identifier: TIdentifier,
    message: object,
  ) => Promise<Aggregate>;
  getChannelSubscriptions: (
    identifier: TIdentifier,
  ) => Promise<SubscriptionDetails[]>;
  getAgentConnections: (
    identifier: TIdentifier,
  ) => Promise<ConnectionDetails[]>;
  getIdentifierFromPath: (
    path: string,
    searchParams: URLSearchParams,
  ) => {
    identifier: TIdentifier;
    aggregatePath?: string;
  };
  getAgentInfo: (agentId: string) => Promise<Agent | undefined>;
}
