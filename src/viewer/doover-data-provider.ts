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

interface SubscriptionEntry {
  messageCallback: (
    identifier: ChannelIdentifier,
    message: MessageStructure,
  ) => void;
  aggregateCallback: (
    identifier: ChannelIdentifier,
    aggregate: Aggregate,
  ) => void;
  messageUpdateCallback?: (
    identifier: ChannelIdentifier,
    message: MessageStructure,
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
    this.gateway.on("messageUpdate", (message) => {
      const key = this.channelKey(message.channel.agent_id, message.channel.name);
      const identifier = this.toIdentifier(message.channel.agent_id, message.channel.name);
      this.subscriptions.get(key)?.forEach((entry) =>
        entry.messageUpdateCallback?.(identifier, message),
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

  getAgents(): Promise<AgentsResponse> {
    return this.rest.request<AgentsResponse>({
      path: "/agents",
      baseUrl: this.config.controlApiUrl,
      omitSharingHeader: true,
    });
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
