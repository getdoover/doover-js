import { AgentsApi } from "../apis/agents-api";
import { AggregatesApi, type AggregateMutationParams } from "../apis/aggregates-api";
import { ChannelsApi } from "../apis/channels-api";
import { ConnectionsApi } from "../apis/connections-api";
import { MessagesApi, type ListMessagesParams } from "../apis/messages-api";
import type { DooverAuth } from "../auth/doover-auth";
import { GatewayClient } from "../gateway/gateway-client";
import { DooverValidationError } from "../http/errors";
import { RestClient, type DooverClientConfig } from "../http/rest-client";
import type {
  Aggregate,
  Channel,
  ConnectionDetails,
  JSONValue,
  MessageStructure,
  RpcMessageData,
  RpcRequest,
  RpcStatus,
} from "../types/common";
import type {
  Agent,
  AgentsResponse,
  ChannelIdentifier,
  ChannelsDataProvider,
  GetAgentsOptions,
  SubscriptionDetails,
  User,
} from "../types/viewer";
import { generateSnowflakeIdAtTime } from "../utils/snowflake";
import { getIdentifierFromPath as parseIdentifierFromPath } from "./path-parsing";

function isRpcMessageData<
  TRequest = object,
  TResponse = object,
  TPending = undefined,
>(data: unknown): data is RpcMessageData<TRequest, TResponse, TPending> {
  return (
    typeof data === "object" &&
    data !== null &&
    "status" in data &&
    "method" in data &&
    "request" in data
  );
}

function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

interface SubscriptionEntry {
  messageCallback: (
    identifier: ChannelIdentifier,
    message: MessageStructure,
  ) => void;
  aggregateCallback: (
    identifier: ChannelIdentifier,
    aggregate: Aggregate,
  ) => void;
  /**
   * `message` is the full post-update MessageStructure (server-side `.message`
   * field). `request_data` is the diff of just-changed fields, or undefined
   * if the server didn't provide one. Most consumers only need `message`.
   */
  messageUpdateCallback?: (
    identifier: ChannelIdentifier,
    message: MessageStructure,
    request_data?: JSONValue,
  ) => void;
}

export class DooverDataProvider
  implements ChannelsDataProvider<ChannelIdentifier>
{
  readonly rest: RestClient;
  readonly gateway: GatewayClient;
  readonly agentsApi: AgentsApi;
  readonly channelsApi: ChannelsApi;
  readonly messagesApi: MessagesApi;
  readonly aggregatesApi: AggregatesApi;
  readonly connectionsApi: ConnectionsApi;
  private readonly subscriptions = new Map<string, SubscriptionEntry[]>();

  constructor(private readonly config: DooverClientConfig, auth?: DooverAuth) {
    this.rest = new RestClient(config, auth);
    this.gateway = new GatewayClient(config, auth);
    this.agentsApi = new AgentsApi(this.rest);
    this.channelsApi = new ChannelsApi(this.rest);
    this.messagesApi = new MessagesApi(this.rest);
    this.aggregatesApi = new AggregatesApi(this.rest);
    this.connectionsApi = new ConnectionsApi(this.rest);

    this.gateway.on("messageCreate", (message) => {
      const key = this.channelKey(message.channel.agent_id, message.channel.name);
      const identifier = this.toIdentifier(message.channel.agent_id, message.channel.name);
      this.subscriptions.get(key)?.forEach((entry) => entry.messageCallback(identifier, message));
    });
    this.gateway.on("messageUpdate", (message, request_data) => {
      const key = this.channelKey(message.channel.agent_id, message.channel.name);
      const identifier = this.toIdentifier(message.channel.agent_id, message.channel.name);
      this.subscriptions.get(key)?.forEach((entry) =>
        entry.messageUpdateCallback?.(identifier, message, request_data),
      );
    });
    this.gateway.on("channelSync", (event) => {
      const key = this.channelKey(event.channel.agent_id, event.channel.name);
      const identifier = this.toIdentifier(event.channel.agent_id, event.channel.name);
      this.subscriptions.get(key)?.forEach((entry) =>
        entry.aggregateCallback(identifier, event.aggregate),
      );
    });
    this.gateway.on("aggregateUpdate", (event) => {
      const key = this.channelKey(event.channel.agent_id, event.channel.name);
      const identifier = this.toIdentifier(event.channel.agent_id, event.channel.name);
      this.subscriptions.get(key)?.forEach((entry) =>
        entry.aggregateCallback(identifier, event.aggregate),
      );
    });
  }

  getMe(): Promise<User> {
    return this.rest.get<User>("/users/me", undefined, this.config.controlApiUrl);
  }

  async getAgents(options?: GetAgentsOptions): Promise<AgentsResponse> {
    const query: Record<string, boolean> = {};
    if (options?.includeArchived) {
      query["include-archived"] = true;
    }
    if (options?.includeOrganisations) {
      query["include-organisations"] = true;
    }
    if (options?.includeUsers) {
      query["include-users"] = true;
    }

    const raw = await this.rest.request<AgentsResponse>({
      path: "/agents/",
      baseUrl: this.config.controlApiUrl,
      omitSharingHeader: true,
      query: Object.keys(query).length > 0 ? query : undefined,
    });

    const rawAgents = Array.isArray(raw.agents) ? raw.agents : [];
    const normalizedAgents = rawAgents.map((agent) =>
      this.normalizeAgentEntry(agent),
    );

    if (!options?.mergeIncludedAsAgents) {
      return {
        ...raw,
        agents: normalizedAgents,
      };
    }

    const merged: Agent[] = [...normalizedAgents];

    if (options.includeOrganisations) {
      const rawOrganisations = Array.isArray(raw.organisations)
        ? (raw.organisations as unknown[])
        : [];
      for (const org of rawOrganisations) {
        merged.push(this.normalizeOrganisationEntry(org));
      }
    }

    if (options.includeUsers) {
      const rawUsers = Array.isArray(raw.users) ? (raw.users as unknown[]) : [];
      for (const user of rawUsers) {
        merged.push(this.normalizeUserEntry(user));
      }
    }

    return {
      ...raw,
      agents: merged,
      results: merged,
      count: merged.length,
    };
  }

  async getChannels(
    identifier: ChannelIdentifier,
    options?: { includeArchived?: boolean },
  ): Promise<Channel[] | undefined> {
    if (!identifier.agentId) {
      return undefined;
    }
    return this.channelsApi.listChannels(identifier.agentId, {
      include_archived: options?.includeArchived,
    });
  }

  createChannel(
    identifier: ChannelIdentifier,
    channelName: string,
    options?: { is_private?: boolean },
  ): Promise<unknown> {
    if (!identifier.agentId) {
      throw new DooverValidationError("Identifier must contain agentId");
    }
    return this.channelsApi.putChannel(identifier.agentId, channelName, {
      is_private: options?.is_private ?? false,
    });
  }

  archiveChannel(identifier: ChannelIdentifier): Promise<unknown> {
    const validated = this.requireChannel(identifier);
    return this.rest.post(
      `/agents/${validated.agentId}/channels/${validated.channelName}/archive`,
      {},
    );
  }

  unarchiveChannel(identifier: ChannelIdentifier): Promise<unknown> {
    const validated = this.requireChannel(identifier);
    return this.rest.post(
      `/agents/${validated.agentId}/channels/${validated.channelName}/unarchive`,
      {},
    );
  }

  getChannel(identifier: ChannelIdentifier): Promise<Channel | undefined> {
    if (!identifier.agentId || !identifier.channelName) {
      return Promise.resolve(undefined);
    }
    return this.channelsApi.getChannel(identifier.agentId, identifier.channelName);
  }

  async subscribeToChannel(
    identifier: ChannelIdentifier,
    callback: SubscriptionEntry["messageCallback"],
    aggregateCallback: SubscriptionEntry["aggregateCallback"],
    messageUpdateCallback?: SubscriptionEntry["messageUpdateCallback"],
  ) {
    const validated = this.requireChannel(identifier);
    const key = this.channelKey(validated.agentId, validated.channelName);
    const entries = this.subscriptions.get(key) ?? [];
    entries.push({
      messageCallback: callback,
      aggregateCallback,
      messageUpdateCallback,
    });
    this.subscriptions.set(key, entries);
    await this.gateway.connect();
    this.gateway.subscribe({
      agent_id: validated.agentId,
      name: validated.channelName,
    });
    return Promise.resolve();
  }

  async unsubscribeFromChannel(
    identifier: ChannelIdentifier,
    callback: SubscriptionEntry["messageCallback"],
  ) {
    const validated = this.requireChannel(identifier);
    const key = this.channelKey(validated.agentId, validated.channelName);
    const entries = this.subscriptions.get(key);
    if (!entries) {
      return Promise.reject(new DooverValidationError("Not Currently Subscribed to Channel"));
    }
    const next = entries.filter((entry) => entry.messageCallback !== callback);
    if (next.length === 0) {
      this.subscriptions.delete(key);
      this.gateway.unsubscribe({
        agent_id: validated.agentId,
        name: validated.channelName,
      });
    } else {
      this.subscriptions.set(key, next);
    }
    return Promise.resolve();
  }

  async getAggregate(identifier: ChannelIdentifier): Promise<Aggregate | undefined> {
    if (!identifier.agentId || !identifier.channelName) {
      return undefined;
    }
    const channel = await this.channelsApi.getChannel(
      identifier.agentId,
      identifier.channelName,
    );
    if (channel.aggregate) {
      return channel.aggregate;
    }
    return this.aggregatesApi.getAggregate(identifier.agentId, identifier.channelName);
  }

  /**
   * Fetch a page of messages for a channel.
   *
   * Accepts either a cursor string (legacy — shorthand for `{ before }`)
   * or a `ListMessagesParams` options object.
   *
   * Default limit is 10 for backwards compatibility; pass `limit` explicitly
   * for larger pages.
   */
  async getMessages(
    identifier: ChannelIdentifier,
    optionsOrBefore?: string | ListMessagesParams,
  ): Promise<MessageStructure[] | undefined> {
    if (!identifier.agentId || !identifier.channelName) {
      return undefined;
    }
    const options: ListMessagesParams =
      typeof optionsOrBefore === "string"
        ? { before: optionsOrBefore }
        : (optionsOrBefore ?? {});
    const messages = await this.messagesApi.listMessages(identifier.agentId, identifier.channelName, {
      before: options.before ?? generateSnowflakeIdAtTime(new Date()),
      limit: options.limit ?? 10,
      ...(options.after !== undefined ? { after: options.after } : {}),
      ...(options.field_name !== undefined ? { field_name: options.field_name } : {}),
    });
    return messages.reverse();
  }

  deleteMessage(identifier: ChannelIdentifier, messageId: string): Promise<unknown> {
    const validated = this.requireChannel(identifier);
    return this.messagesApi.deleteMessage(
      validated.agentId,
      validated.channelName,
      messageId,
    );
  }

  sendMessage(identifier: ChannelIdentifier, message: object): Promise<MessageStructure> {
    const validated = this.requireChannel(identifier);
    return this.messagesApi.postMessage(validated.agentId, validated.channelName, {
      data: message as Record<string, unknown>,
    });
  }

  /**
   * Send a message-based RPC to a channel and await a settled response.
   *
   * Wire protocol: POST a message with `{ type: "rpc", ...rpcRequest }`; the
   * server echoes progress via `MessageUpdate` events keyed by the message id,
   * carrying a `status` envelope. Resolves on `success` with the `response`
   * payload, rejects on `error` with the status message.
   *
   * For low-latency ephemeral commands (camera PTZ etc.), use
   * `gateway.sendOneShotMessage` directly instead — that path is not persisted
   * to the database.
   *
   * `onStatus` fires on every intermediate status (`sent`, `acknowledged`,
   * `deferred`, `pending`) and once more on terminal states.
   */
  sendRPC<TRequest = object, TResponse = object, TPending = undefined>(
    identifier: ChannelIdentifier,
    rpcRequest: RpcRequest<TRequest>,
    options?: {
      onStatus?: (status: RpcStatus<TPending>) => void;
    },
  ): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      let rpcMessageId: string | undefined;
      let settled = false;

      const onUpdate = (
        _identifier: ChannelIdentifier,
        message: MessageStructure,
      ) => {
        if (settled) return;
        if (rpcMessageId === undefined || message.id !== rpcMessageId) return;
        if (!isRpcMessageData<TRequest, TResponse, TPending>(message.data)) return;
        const rpcMessage = message.data;
        options?.onStatus?.(rpcMessage.status);
        if (rpcMessage.status.code === "success") {
          settled = true;
          void this.unsubscribeFromChannel(identifier, noopMessageCallback);
          resolve(rpcMessage.response);
        } else if (rpcMessage.status.code === "error") {
          settled = true;
          void this.unsubscribeFromChannel(identifier, noopMessageCallback);
          reject(rpcMessage.status.message);
        }
      };

      // noopMessageCallback is used as the identity handle for this
      // subscription — subscribe/unsubscribe pair matches by reference.
      const noopMessageCallback: SubscriptionEntry["messageCallback"] = () => {};
      const noopAggregateCallback: SubscriptionEntry["aggregateCallback"] = () => {};

      this.subscribeToChannel(
        identifier,
        noopMessageCallback,
        noopAggregateCallback,
        onUpdate,
      )
        .then(() =>
          this.sendMessage(identifier, { type: "rpc", ...rpcRequest }),
        )
        .then((message) => {
          rpcMessageId = message.id;
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          void this.unsubscribeFromChannel(identifier, noopMessageCallback);
          reject(error);
        });
    });
  }

  updateAggregate(
    identifier: ChannelIdentifier,
    message: object,
    params?: AggregateMutationParams,
  ): Promise<Aggregate> {
    const validated = this.requireChannel(identifier);
    return this.aggregatesApi.patchAggregate(
      validated.agentId,
      validated.channelName,
      message as Record<string, unknown>,
      params,
    );
  }

  putAggregate(
    identifier: ChannelIdentifier,
    message: object,
    params?: AggregateMutationParams,
  ): Promise<Aggregate> {
    const validated = this.requireChannel(identifier);
    return this.aggregatesApi.putAggregate(
      validated.agentId,
      validated.channelName,
      message as Record<string, unknown>,
      params,
    );
  }

  getChannelSubscriptions(identifier: ChannelIdentifier): Promise<SubscriptionDetails[]> {
    const validated = this.requireChannel(identifier);
    return this.connectionsApi.getChannelSubscriptions(
      validated.agentId,
      validated.channelName,
    ) as Promise<SubscriptionDetails[]>;
  }

  getAgentConnections(identifier: ChannelIdentifier): Promise<ConnectionDetails[]> {
    if (!identifier.agentId) {
      return Promise.reject(new DooverValidationError("Invalid Identifier"));
    }
    return this.connectionsApi.getAgentConnections(identifier.agentId);
  }

  getIdentifierFromPath(path: string, searchParams: URLSearchParams) {
    return parseIdentifierFromPath<ChannelIdentifier>(path, searchParams);
  }

  getAgentInfo(agentId: string): Promise<Agent | undefined> {
    return Promise.resolve({
      id: agentId,
      name: agentId,
      display_name: agentId,
      type: "device",
      fa_icon: "fa-solid fa-robot",
      organisation: "Organisation",
      group: "group",
      archived: false,
      fixed_location: { latitude: 0, longitude: 0 },
      extra_config: {},
    });
  }

  private normalizeAgentEntry(rawAgent: unknown): Agent {
    const source: Record<string, unknown> = isPlainObject(rawAgent)
      ? rawAgent
      : {};
    const fixedLocation = source.fixed_location;
    const normalizedFixedLocation =
      isPlainObject(fixedLocation) &&
      typeof fixedLocation.latitude === "number" &&
      typeof fixedLocation.longitude === "number"
        ? {
            latitude: fixedLocation.latitude,
            longitude: fixedLocation.longitude,
          }
        : { latitude: 0, longitude: 0 };

    const faIcon =
      typeof source.fa_icon === "string" && source.fa_icon.length > 0
        ? source.fa_icon
        : "fa-solid fa-robot";

    return {
      ...(source as Record<string, unknown>),
      id: typeof source.id === "string" ? source.id : String(source.id ?? ""),
      organisation:
        typeof source.organisation === "string" ? source.organisation : "",
      name: typeof source.name === "string" ? source.name : "",
      display_name:
        typeof source.display_name === "string" ? source.display_name : "",
      archived: typeof source.archived === "boolean" ? source.archived : false,
      group: typeof source.group === "string" ? source.group : "",
      fa_icon: faIcon,
      type:
        source.type === "device" ||
        source.type === "dashboard" ||
        source.type === "organisation" ||
        source.type === "user"
          ? source.type
          : "device",
      fixed_location: normalizedFixedLocation,
      extra_config: this.coerceExtraConfig(source.extra_config),
    } as Agent;
  }

  private normalizeOrganisationEntry(rawOrganisation: unknown): Agent {
    const source: Record<string, unknown> = isPlainObject(rawOrganisation)
      ? rawOrganisation
      : {};
    const name = typeof source.name === "string" ? source.name : "";
    const rootGroup = isPlainObject(source.root_group) ? source.root_group : null;
    const groupName =
      rootGroup && typeof rootGroup.name === "string" ? rootGroup.name : "";

    return {
      id: typeof source.id === "string" ? source.id : String(source.id ?? ""),
      organisation: name,
      name,
      display_name: name,
      archived: typeof source.archived === "boolean" ? source.archived : false,
      group: groupName,
      fa_icon: "fa-solid fa-building",
      type: "organisation",
      fixed_location: { latitude: 0, longitude: 0 },
      extra_config: this.coerceExtraConfig(source.extra_config),
    };
  }

  private normalizeUserEntry(rawUser: unknown): Agent {
    const source: Record<string, unknown> = isPlainObject(rawUser)
      ? rawUser
      : {};
    const id = typeof source.id === "string" ? source.id : String(source.id ?? "");
    const username = typeof source.username === "string" ? source.username : "";
    const email = typeof source.email === "string" ? source.email : "";

    const name = username !== "" ? username : email !== "" ? email : id;

    return {
      id,
      organisation: "",
      name,
      display_name: this.buildUserDisplayName(source),
      archived: false,
      group: "",
      fa_icon: "fa-solid fa-user",
      type: "user",
      fixed_location: { latitude: 0, longitude: 0 },
      extra_config: this.coerceExtraConfig(source.custom_data),
    };
  }

  private buildUserDisplayName(rawUser: unknown): string {
    const source: Record<string, unknown> = isPlainObject(rawUser)
      ? rawUser
      : {};
    const firstName = typeof source.first_name === "string" ? source.first_name.trim() : "";
    const lastName = typeof source.last_name === "string" ? source.last_name.trim() : "";
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName !== "") {
      return fullName;
    }
    if (typeof source.username === "string" && source.username !== "") {
      return source.username;
    }
    if (typeof source.email === "string" && source.email !== "") {
      return source.email;
    }
    if (typeof source.id === "string" && source.id !== "") {
      return source.id;
    }
    return String(source.id ?? "");
  }

  private coerceExtraConfig(value: unknown): Record<string, unknown> {
    return isPlainObject(value) ? (value as Record<string, unknown>) : {};
  }

  private requireChannel(identifier: ChannelIdentifier) {
    if (!identifier.agentId || !identifier.channelName) {
      throw new DooverValidationError(
        "Identifier must contain agentId and channelName",
      );
    }
    return {
      agentId: identifier.agentId,
      channelName: identifier.channelName,
    };
  }

  private channelKey(agentId: string, channelName: string) {
    return `${agentId}/${channelName}`;
  }

  private toIdentifier(agentId: string, channelName: string): ChannelIdentifier {
    return { agentId, channelName };
  }
}
