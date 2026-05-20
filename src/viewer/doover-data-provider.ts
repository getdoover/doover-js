import { AgentsApi } from "../apis/agents-api";
import { AggregatesApi, type AggregateMutationParams } from "../apis/aggregates-api";
import { ChannelsApi } from "../apis/channels-api";
import { ConnectionsApi } from "../apis/connections-api";
import { MessagesApi, type ListMessagesParams } from "../apis/messages-api";
import { UsersApi } from "../apis/users-api";
import type { DooverAuth } from "../auth/doover-auth";
import { GatewayClient } from "../gateway/gateway-client";
import { DooverValidationError } from "../http/errors";
import { RestClient, type DooverClientConfig } from "../http/rest-client";
import { RpcDispatcher } from "../rpc/rpc-dispatcher";
import type {
  Aggregate,
  Channel,
  ConnectionDetails,
  JSONValue,
  MessageStructure,
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
import { getIdentifierFromPath as parseIdentifierFromPath } from "./path-parsing";

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

/** @deprecated Use DooverClient subclients directly. Removed in 0.6.0. */
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
  private readonly controlApiUrl?: string;
  private bridges = new Map<SubscriptionEntry["messageCallback"], () => void>();
  private dispatcher?: RpcDispatcher;

  // overload signatures
  constructor(config: DooverClientConfig, auth?: DooverAuth);
  constructor(injected: { rest: RestClient; gateway: GatewayClient; controlApiUrl?: string });
  // implementation
  constructor(
    configOrInjected:
      | DooverClientConfig
      | { rest: RestClient; gateway: GatewayClient; controlApiUrl?: string },
    auth?: DooverAuth,
  ) {
    if ("rest" in configOrInjected && "gateway" in configOrInjected) {
      this.rest = configOrInjected.rest;
      this.gateway = configOrInjected.gateway;
      this.controlApiUrl = configOrInjected.controlApiUrl;
    } else {
      this.rest = new RestClient(configOrInjected, auth);
      this.gateway = new GatewayClient(configOrInjected, auth);
      this.controlApiUrl = configOrInjected.controlApiUrl;
    }
    this.agentsApi = new AgentsApi(this.rest, this.controlApiUrl);
    this.channelsApi = new ChannelsApi(this.rest);
    this.messagesApi = new MessagesApi(this.rest);
    this.aggregatesApi = new AggregatesApi(this.rest);
    this.connectionsApi = new ConnectionsApi(this.rest);
  }

  /** @deprecated Use `client.users.getMe()` instead. Removed in 0.6.0. */
  getMe(): Promise<User> {
    return new UsersApi(this.rest, this.controlApiUrl).getMe();
  }

  /** @deprecated Use `client.agents.listAgents(opts)` instead. Removed in 0.6.0. */
  async getAgents(options?: GetAgentsOptions): Promise<AgentsResponse> {
    return this.agentsApi.listAgents(options);
  }

  /** @deprecated Use `client.channels.listChannels(id, opts)` instead. Removed in 0.6.0. */
  async getChannels(
    identifier: ChannelIdentifier,
    options?: { includeArchived?: boolean },
  ): Promise<Channel[] | undefined> {
    if (!identifier.agentId) return undefined;
    return this.channelsApi.listChannels(identifier.agentId, {
      include_archived: options?.includeArchived,
    });
  }

  /** @deprecated Use `client.channels.putChannel(id, name, body)` instead. Removed in 0.6.0. */
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

  /** @deprecated Use `client.channels.archiveChannel(id)` instead. Removed in 0.6.0. */
  archiveChannel(identifier: ChannelIdentifier): Promise<unknown> {
    const v = this.requireChannel(identifier);
    return this.channelsApi.archiveChannel(v.agentId, v.channelName);
  }

  /** @deprecated Use `client.channels.unarchiveChannel(id)` instead. Removed in 0.6.0. */
  unarchiveChannel(identifier: ChannelIdentifier): Promise<unknown> {
    const v = this.requireChannel(identifier);
    return this.channelsApi.unarchiveChannel(v.agentId, v.channelName);
  }

  /** @deprecated Use `client.channels.getChannel(id)` instead. Removed in 0.6.0. */
  getChannel(identifier: ChannelIdentifier): Promise<Channel | undefined> {
    if (!identifier.agentId || !identifier.channelName) {
      return Promise.resolve(undefined);
    }
    return this.channelsApi.getChannel(identifier.agentId, identifier.channelName);
  }

  /** @deprecated Use `client.gateway.subscribeToChannel(channel, handlers)` instead. Removed in 0.6.0. */
  async subscribeToChannel(
    identifier: ChannelIdentifier,
    callback: SubscriptionEntry["messageCallback"],
    aggregateCallback: SubscriptionEntry["aggregateCallback"],
    messageUpdateCallback?: SubscriptionEntry["messageUpdateCallback"],
  ): Promise<void> {
    const validated = this.requireChannel(identifier);
    const channel = { agent_id: validated.agentId, name: validated.channelName };
    const off = this.gateway.subscribeToChannel(channel, {
      onMessage: (msg) => callback(identifier, msg),
      onAggregate: (agg) => aggregateCallback(identifier, agg),
      onMessageUpdate: messageUpdateCallback
        ? (msg, rd) => messageUpdateCallback(identifier, msg, rd)
        : undefined,
    });
    this.bridges.set(callback, off);
    await this.gateway.connect();
  }

  /** @deprecated Call the unsubscribe fn returned by `client.gateway.subscribeToChannel`. Removed in 0.6.0. */
  async unsubscribeFromChannel(
    _identifier: ChannelIdentifier,
    callback: SubscriptionEntry["messageCallback"],
  ): Promise<void> {
    const off = this.bridges.get(callback);
    if (!off) {
      throw new DooverValidationError("Not Currently Subscribed to Channel");
    }
    off();
    this.bridges.delete(callback);
  }

  /** @deprecated Compose `client.channels.getChannel(id).then(c => c.aggregate ?? client.aggregates.getAggregate(id))` instead. Removed in 0.6.0. */
  async getAggregate(identifier: ChannelIdentifier): Promise<Aggregate | undefined> {
    if (!identifier.agentId || !identifier.channelName) return undefined;
    const ch = await this.channelsApi.getChannel(identifier.agentId, identifier.channelName);
    if (ch.aggregate) return ch.aggregate;
    return this.aggregatesApi.getAggregate(identifier.agentId, identifier.channelName);
  }

  /** @deprecated Use `client.messages.listMessages(id, { ...opts, order: "asc" })` instead. Removed in 0.6.0. */
  async getMessages(
    identifier: ChannelIdentifier,
    optionsOrBefore?: string | ListMessagesParams,
  ): Promise<MessageStructure[] | undefined> {
    if (!identifier.agentId || !identifier.channelName) return undefined;
    const params: ListMessagesParams =
      typeof optionsOrBefore === "string"
        ? { before: optionsOrBefore }
        : (optionsOrBefore ?? {});
    return this.messagesApi.listMessages(identifier.agentId, identifier.channelName, {
      ...params,
      order: "asc",
    });
  }

  /** @deprecated Use `client.messages.deleteMessage(id, msgId)` instead. Removed in 0.6.0. */
  deleteMessage(identifier: ChannelIdentifier, messageId: string): Promise<unknown> {
    const v = this.requireChannel(identifier);
    return this.messagesApi.deleteMessage(v.agentId, v.channelName, messageId);
  }

  /** @deprecated Use `client.messages.postMessage(id, { data })` instead. Removed in 0.6.0. */
  sendMessage(identifier: ChannelIdentifier, message: object): Promise<MessageStructure> {
    const v = this.requireChannel(identifier);
    return this.messagesApi.postMessage(v.agentId, v.channelName, {
      data: message as Record<string, unknown>,
    });
  }

  /** @deprecated Use `client.rpc.send(id, req, opts)` instead. Removed in 0.6.0. */
  sendRPC<TRequest = object, TResponse = object, TPending = undefined>(
    identifier: ChannelIdentifier,
    rpcRequest: RpcRequest<TRequest>,
    options?: { onStatus?: (status: RpcStatus<TPending>) => void },
  ): Promise<TResponse> {
    const v = this.requireChannel(identifier);
    if (!this.dispatcher) {
      this.dispatcher = new RpcDispatcher(this.gateway, this.messagesApi);
    }
    return this.dispatcher.send<TRequest, TResponse, TPending>(
      { agentId: v.agentId, channelName: v.channelName },
      rpcRequest,
      options,
    );
  }

  /** @deprecated Use `client.aggregates.patchAggregate(id, data, params)` instead. Removed in 0.6.0. */
  updateAggregate(
    identifier: ChannelIdentifier,
    message: object,
    params?: AggregateMutationParams,
  ): Promise<Aggregate> {
    const v = this.requireChannel(identifier);
    return this.aggregatesApi.patchAggregate(
      v.agentId,
      v.channelName,
      message as Record<string, unknown>,
      params,
    );
  }

  /** @deprecated Use `client.aggregates.putAggregate(id, data, params)` instead. Removed in 0.6.0. */
  putAggregate(
    identifier: ChannelIdentifier,
    message: object,
    params?: AggregateMutationParams,
  ): Promise<Aggregate> {
    const v = this.requireChannel(identifier);
    return this.aggregatesApi.putAggregate(
      v.agentId,
      v.channelName,
      message as Record<string, unknown>,
      params,
    );
  }

  /** @deprecated Use `client.connections.getChannelSubscriptions(id)` instead. Removed in 0.6.0. */
  getChannelSubscriptions(identifier: ChannelIdentifier): Promise<SubscriptionDetails[]> {
    const v = this.requireChannel(identifier);
    return this.connectionsApi.getChannelSubscriptions(v.agentId, v.channelName) as Promise<SubscriptionDetails[]>;
  }

  /** @deprecated Use `client.connections.getAgentConnections(id)` instead. Removed in 0.6.0. */
  getAgentConnections(identifier: ChannelIdentifier): Promise<ConnectionDetails[]> {
    if (!identifier.agentId) {
      return Promise.reject(new DooverValidationError("Invalid Identifier"));
    }
    return this.connectionsApi.getAgentConnections(identifier.agentId);
  }

  /** @deprecated Use the free function `getIdentifierFromPath(path, search)` instead. Removed in 0.6.0. */
  getIdentifierFromPath(path: string, searchParams: URLSearchParams) {
    return parseIdentifierFromPath<ChannelIdentifier>(path, searchParams);
  }

  /** @deprecated No replacement — this was a synthesized stub. Removed in 0.6.0. */
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
}
