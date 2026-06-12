import type {
  AgentScope,
  AgentsApiLike,
  AggregatesApiLike,
  AlarmsApiLike,
  ChannelsApiLike,
  ConnectionsApiLike,
  DataClient,
  DataClientStatus,
  GatewayClientLike,
  MessagesApiLike,
  NotificationsApiLike,
  PermissionsApiLike,
  ProcessorsApiLike,
  RpcDispatcherLike,
  TurnApiLike,
  UsersApiLike,
} from "./data-client";
import type { Capability } from "./capabilities";
import { DooverOfflineError } from "./errors";
import {
  delegateRequestOptions,
  splitRequestOptions,
  type DooverRequestOptions,
} from "./request-options";
import type { Aggregate, MessageStructure } from "../types/common";

export const DEFAULT_OFFLINE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type OfflineCacheMode =
  | "read-through"
  | "network-first"
  | "cache-first"
  | "cache-only";

export interface OfflineReadCacheOptions {
  enabled?: boolean;
  mode?: OfflineCacheMode;
  policy?: string;
  retentionMs?: number;
  allowExpired?: boolean;
}

export interface OfflineChannelPolicy {
  id?: string;
  channel: {
    agentId?: string;
    channelName: string;
  };
  cache?: boolean;
  retentionMs?: number;
  messages?: {
    mode?: "latest";
    count?: number;
  };
  messageAttachments?: {
    include?: "none" | "metadata-only" | "metadata-and-selected-blobs";
  };
  aggregateAttachments?: {
    include?: "none" | "metadata-only" | "metadata-and-selected-blobs";
  };
}

export interface OfflineCacheScope {
  userId: string;
  organisationId?: string | null;
  sourceId?: string;
  sharing?: string;
  assumeUserId?: string | null;
}

export interface OfflineCacheRecord<T = unknown> {
  key: string;
  scope: OfflineCacheScope;
  kind: string;
  value: T;
  cachedAt: number;
  lastAccessedAt: number;
  expiresAt: number | null;
  serverUpdatedAt?: number | null;
  schemaVersion: number;
  policyId?: string;
}

export type OfflineReadState =
  | "online"
  | "cache-fallback"
  | "cache-hit"
  | "cache-miss"
  | "expired";

export interface OfflineStatusSnapshot {
  online: boolean;
  state: OfflineReadState;
  operation?: string;
  cacheKey?: string;
  cachedAt?: number;
  expiresAt?: number | null;
  serverUpdatedAt?: number | null;
  isOfflineFallback: boolean;
  isExpired: boolean;
  at: number;
}

export interface OfflineStorageAdapter {
  getJson<T>(key: string): Promise<OfflineCacheRecord<T> | undefined>;
  setJson<T>(key: string, record: OfflineCacheRecord<T>): Promise<void>;
  deleteJson?(key: string): Promise<void>;
  listJsonKeys?(prefix?: string): Promise<string[]>;
  clearScope?(scope: OfflineCacheScope): Promise<void>;
  getBlob?(key: string): Promise<Blob | undefined>;
  setBlob?(key: string, blob: Blob, metadata: OfflineCacheRecord): Promise<void>;
  deleteBlob?(key: string): Promise<void>;
}

export class MemoryOfflineStorageAdapter implements OfflineStorageAdapter {
  private readonly json = new Map<string, OfflineCacheRecord>();
  private readonly blobs = new Map<string, { blob: Blob; metadata: OfflineCacheRecord }>();

  async getJson<T>(key: string): Promise<OfflineCacheRecord<T> | undefined> {
    return this.json.get(key) as OfflineCacheRecord<T> | undefined;
  }

  async setJson<T>(key: string, record: OfflineCacheRecord<T>): Promise<void> {
    this.json.set(key, record as OfflineCacheRecord);
  }

  async deleteJson(key: string): Promise<void> {
    this.json.delete(key);
  }

  async listJsonKeys(prefix?: string): Promise<string[]> {
    const keys = [...this.json.keys()];
    return prefix ? keys.filter((key) => key.startsWith(prefix)) : keys;
  }

  async clearScope(scope: OfflineCacheScope): Promise<void> {
    for (const [key, record] of this.json) {
      if (scopeMatches(record.scope, scope)) this.json.delete(key);
    }
    for (const [key, record] of this.blobs) {
      if (scopeMatches(record.metadata.scope, scope)) this.blobs.delete(key);
    }
  }

  async getBlob(key: string): Promise<Blob | undefined> {
    return this.blobs.get(key)?.blob;
  }

  async setBlob(key: string, blob: Blob, metadata: OfflineCacheRecord): Promise<void> {
    this.blobs.set(key, { blob, metadata });
  }

  async deleteBlob(key: string): Promise<void> {
    this.blobs.delete(key);
  }
}

export interface OfflineDataClientOptions {
  client: DataClient;
  storage: OfflineStorageAdapter;
  scope: OfflineCacheScope;
  policies?: OfflineChannelPolicy[];
  defaultRetentionMs?: number;
  /**
   * Apps may provide their own reachability signal. When omitted, the wrapper
   * uses `navigator.onLine` when present and otherwise assumes online.
   */
  isOnline?: () => boolean;
}

interface CacheDescriptor {
  operation: string;
  kind: string;
  keyParts: unknown[];
  fallbackKeyParts?: unknown[];
  request?: DooverRequestOptions;
  agentId?: string;
  channelName?: string;
  serverUpdatedAt?: (value: unknown) => number | null | undefined;
}

interface EffectivePolicy {
  enabled: boolean;
  mode: OfflineCacheMode;
  retentionMs: number;
  allowExpired: boolean;
  policyId?: string;
}

const SCHEMA_VERSION = 1;
type AnyFn = (...args: any[]) => any;
const INITIAL_OFFLINE_STATUS: OfflineStatusSnapshot = {
  online: true,
  state: "online",
  isOfflineFallback: false,
  isExpired: false,
  at: 0,
};

export class OfflineDataClient implements DataClient {
  readonly agents: AgentsApiLike;
  readonly channels: ChannelsApiLike;
  readonly messages: MessagesApiLike;
  readonly aggregates: AggregatesApiLike;
  readonly alarms: AlarmsApiLike;
  readonly connections: ConnectionsApiLike;
  readonly notifications: NotificationsApiLike;
  readonly permissions: PermissionsApiLike;
  readonly processors: ProcessorsApiLike;
  readonly turn: TurnApiLike;
  readonly users: UsersApiLike;
  readonly gateway: GatewayClientLike;
  readonly rpc: RpcDispatcherLike;

  private readonly client: DataClient;
  private readonly storage: OfflineStorageAdapter;
  private readonly scope: OfflineCacheScope;
  private readonly defaultRetentionMs: number;
  private readonly isOnlineFn?: () => boolean;
  private readonly offlineStatusListeners = new Set<(status: OfflineStatusSnapshot) => void>();
  private policies: OfflineChannelPolicy[];
  private offlineStatus: OfflineStatusSnapshot = INITIAL_OFFLINE_STATUS;
  private persistQueue: Promise<void> = Promise.resolve();

  constructor(options: OfflineDataClientOptions) {
    this.client = options.client;
    this.storage = options.storage;
    this.scope = options.scope;
    this.defaultRetentionMs = options.defaultRetentionMs ?? DEFAULT_OFFLINE_RETENTION_MS;
    this.isOnlineFn = options.isOnline;
    this.policies = [...(options.policies ?? [])];

    this.agents = this.makeAgentsFacade();
    this.channels = this.makeChannelsFacade();
    this.messages = this.makeMessagesFacade();
    this.aggregates = this.makeAggregatesFacade();
    this.alarms = this.passThroughSubclient<AlarmsApiLike>("alarms");
    this.connections = this.passThroughSubclient<ConnectionsApiLike>("connections");
    this.notifications = this.passThroughSubclient<NotificationsApiLike>("notifications");
    this.permissions = this.passThroughSubclient<PermissionsApiLike>("permissions");
    this.processors = this.passThroughSubclient<ProcessorsApiLike>("processors");
    this.turn = this.passThroughSubclient<TurnApiLike>("turn");
    this.users = this.passThroughSubclient<UsersApiLike>("users");
    this.gateway = this.makeGatewayFacade();
    this.rpc = this.makeRpcFacade();
  }

  setChannelPolicy(policy: OfflineChannelPolicy): void {
    const id = policy.id ?? `${policy.channel.agentId ?? "*"}/${policy.channel.channelName}`;
    this.policies = [
      ...this.policies.filter((existing) => (existing.id ?? `${existing.channel.agentId ?? "*"}/${existing.channel.channelName}`) !== id),
      { ...policy, id },
    ];
  }

  setChannelPolicies(policies: OfflineChannelPolicy[]): void {
    this.policies = [...policies];
  }

  getChannelPolicies(): readonly OfflineChannelPolicy[] {
    return this.policies;
  }

  getOfflineStatus(): OfflineStatusSnapshot {
    return {
      ...this.offlineStatus,
      online: this.isOnline(),
    };
  }

  onOfflineStatusChange(listener: (status: OfflineStatusSnapshot) => void): () => void {
    this.offlineStatusListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.offlineStatusListeners.delete(listener);
    };
  }

  async clearScope(scope: OfflineCacheScope = this.scope): Promise<void> {
    if (this.storage.clearScope) {
      await this.storage.clearScope(scope);
      return;
    }
    const keys = await this.storage.listJsonKeys?.(this.scopePrefix(scope));
    if (!keys || !this.storage.deleteJson) return;
    await Promise.all(keys.map((key) => this.storage.deleteJson!(key)));
  }

  getCapabilities(): ReadonlySet<Capability> { return this.client.getCapabilities(); }
  supports(cap: Capability): boolean { return this.client.supports(cap); }
  isConnected(): boolean { return this.client.isConnected(); }
  getStatus(): DataClientStatus { return this.client.getStatus(); }
  onStatusChange(listener: (status: DataClientStatus) => void): () => void {
    return this.client.onStatusChange(listener);
  }
  getAgentScope(): Promise<AgentScope> { return this.client.getAgentScope(); }
  getKnownAgentScope(): AgentScope | "unknown" { return this.client.getKnownAgentScope(); }

  private makeAgentsFacade(): AgentsApiLike {
    const target = this.client.agents;
    return {
      listAgents: ((...rawArgs: unknown[]) => {
        const { args, request } = splitRequestOptions(rawArgs);
        return this.readCached(
          () => (target.listAgents as (...inner: unknown[]) => Promise<unknown>)(...this.withDelegateOptions(args, request)),
          {
            operation: "agents.listAgents",
            kind: "agents.list",
            keyParts: ["agents", "list", args],
            request,
          },
        );
      }) as AgentsApiLike["listAgents"],
      getMultiAgentMessages: ((channelName: unknown, ...rest: unknown[]) => {
        const { args, request } = splitRequestOptions([channelName, ...rest]);
        const params = args[1] as { agent_id?: string[] } | undefined;
        return this.readCached(
          () => (target.getMultiAgentMessages as (...inner: unknown[]) => Promise<unknown>)(...this.withDelegateOptions(args, request)),
          {
            operation: "agents.getMultiAgentMessages",
            kind: "agents.multiAgentMessages",
            keyParts: ["agents", "multiAgentMessages", args],
            channelName: String(args[0]),
            agentId: params?.agent_id?.join(","),
            request,
          },
        );
      }) as AgentsApiLike["getMultiAgentMessages"],
      getMultiAgentAggregates: ((channelName: unknown, ...rest: unknown[]) => {
        const { args, request } = splitRequestOptions([channelName, ...rest]);
        const params = args[1] as { agent_id?: string[] } | undefined;
        return this.readCached(
          () => (target.getMultiAgentAggregates as (...inner: unknown[]) => Promise<unknown>)(...this.withDelegateOptions(args, request)),
          {
            operation: "agents.getMultiAgentAggregates",
            kind: "agents.multiAgentAggregates",
            keyParts: ["agents", "multiAgentAggregates", args],
            channelName: String(args[0]),
            agentId: params?.agent_id?.join(","),
            request,
          },
        );
      }) as AgentsApiLike["getMultiAgentAggregates"],
    } as AgentsApiLike;
  }

  private makeChannelsFacade(): ChannelsApiLike {
    const target = this.client.channels;
    return {
      listChannels: ((...rawArgs: unknown[]) => {
        const { args, request } = splitRequestOptions(rawArgs);
        const agentId = extractAgentId(args);
        return this.readCached(
          () => (target.listChannels as (...inner: unknown[]) => Promise<unknown>)(...this.withDelegateOptions(args, request)),
          {
            operation: "channels.listChannels",
            kind: "channels.list",
            keyParts: ["channels", "list", args],
            agentId,
            request,
          },
        );
      }) as ChannelsApiLike["listChannels"],
      getChannel: ((...rawArgs: unknown[]) => {
        const { args, request } = splitRequestOptions(rawArgs);
        const { agentId, channelName } = extractChannelId(args);
        return this.readCached(
          () => (target.getChannel as (...inner: unknown[]) => Promise<unknown>)(...this.withDelegateOptions(args, request)),
          {
            operation: "channels.getChannel",
            kind: "channels.get",
            keyParts: ["channels", "get", args],
            agentId,
            channelName,
            request,
          },
        );
      }) as ChannelsApiLike["getChannel"],
      createChannel: this.offlineGuard("channels.createChannel", target.createChannel.bind(target)) as ChannelsApiLike["createChannel"],
      putChannel: this.offlineGuard("channels.putChannel", target.putChannel.bind(target)) as ChannelsApiLike["putChannel"],
      archiveChannel: this.offlineGuard("channels.archiveChannel", target.archiveChannel.bind(target)) as ChannelsApiLike["archiveChannel"],
      unarchiveChannel: this.offlineGuard("channels.unarchiveChannel", target.unarchiveChannel.bind(target)) as ChannelsApiLike["unarchiveChannel"],
      listDataSeries: ((...args: unknown[]) =>
        (target.listDataSeries as (...inner: unknown[]) => Promise<unknown>)(...args)) as ChannelsApiLike["listDataSeries"],
    } as ChannelsApiLike;
  }

  private makeAggregatesFacade(): AggregatesApiLike {
    const target = this.client.aggregates;
    return {
      getAggregate: ((...rawArgs: unknown[]) => {
        const { args, request } = splitRequestOptions(rawArgs);
        const { agentId, channelName } = extractChannelId(args);
        return this.readCached(
          () => (target.getAggregate as (...inner: unknown[]) => Promise<unknown>)(...this.withDelegateOptions(args, request)),
          {
            operation: "aggregates.getAggregate",
            kind: "aggregates.get",
            keyParts: ["aggregates", "get", args],
            agentId,
            channelName,
            request,
            serverUpdatedAt: (value) =>
              typeof (value as { last_updated?: unknown } | undefined)?.last_updated === "number"
                ? (value as { last_updated: number }).last_updated
                : undefined,
          },
        );
      }) as AggregatesApiLike["getAggregate"],
      putAggregate: this.offlineGuard("aggregates.putAggregate", target.putAggregate.bind(target)) as AggregatesApiLike["putAggregate"],
      patchAggregate: this.offlineGuard("aggregates.patchAggregate", target.patchAggregate.bind(target)) as AggregatesApiLike["patchAggregate"],
      getAggregateAttachment: ((...rawArgs: unknown[]) => {
        const { args, request } = splitRequestOptions(rawArgs);
        const { agentId, channelName } = extractChannelId(args);
        const attachmentId = String(args[2] ?? args[1] ?? "");
        return this.readBlobCached(
          () => (target.getAggregateAttachment as (...inner: unknown[]) => Promise<unknown>)(...this.withDelegateOptions(args, request)),
          {
            operation: "aggregates.getAggregateAttachment",
            kind: "aggregates.attachment",
            keyParts: ["aggregates", "attachment", args, attachmentId],
            agentId,
            channelName,
            request,
          },
        );
      }) as AggregatesApiLike["getAggregateAttachment"],
    } as AggregatesApiLike;
  }

  private makeMessagesFacade(): MessagesApiLike {
    const target = this.client.messages;
    return {
      listMessages: ((...rawArgs: unknown[]) => {
        const { args, request } = splitRequestOptions(rawArgs);
        const { agentId, channelName } = extractChannelId(args);
        return this.readCached(
          () => (target.listMessages as (...inner: unknown[]) => Promise<unknown>)(...this.withDelegateOptions(args, request)),
          {
            operation: "messages.listMessages",
            kind: "messages.list",
            keyParts: ["messages", "list", args],
            fallbackKeyParts: this.latestMessagesKeyParts(agentId ?? "", channelName ?? ""),
            agentId,
            channelName,
            request,
            serverUpdatedAt: newestMessageTimestamp,
          },
        );
      }) as MessagesApiLike["listMessages"],
      getMessage: ((...rawArgs: unknown[]) => {
        const { args, request } = splitRequestOptions(rawArgs);
        const { agentId, channelName } = extractChannelId(args);
        const messageId = String(args[2] ?? args[1] ?? "");
        return this.readCached(
          () => (target.getMessage as (...inner: unknown[]) => Promise<unknown>)(...this.withDelegateOptions(args, request)),
          {
            operation: "messages.getMessage",
            kind: "messages.get",
            keyParts: ["messages", "get", args, messageId],
            agentId,
            channelName,
            request,
            serverUpdatedAt: (value) =>
              typeof (value as { timestamp?: unknown } | undefined)?.timestamp === "number"
                ? (value as { timestamp: number }).timestamp
                : undefined,
          },
        );
      }) as MessagesApiLike["getMessage"],
      postMessage: this.offlineGuard("messages.postMessage", target.postMessage.bind(target)) as MessagesApiLike["postMessage"],
      putMessage: this.offlineGuard("messages.putMessage", target.putMessage.bind(target)) as MessagesApiLike["putMessage"],
      patchMessage: this.offlineGuard("messages.patchMessage", target.patchMessage.bind(target)) as MessagesApiLike["patchMessage"],
      deleteMessage: this.offlineGuard("messages.deleteMessage", target.deleteMessage.bind(target)) as MessagesApiLike["deleteMessage"],
      getTimeseries: ((...args: unknown[]) =>
        (target.getTimeseries as (...inner: unknown[]) => Promise<unknown>)(...args)) as MessagesApiLike["getTimeseries"],
      getMessageAttachment: ((...rawArgs: unknown[]) => {
        const { args, request } = splitRequestOptions(rawArgs);
        const { agentId, channelName } = extractChannelId(args);
        const messageId = String(args[2] ?? args[1] ?? "");
        const attachmentId = String(args[3] ?? args[2] ?? "");
        return this.readBlobCached(
          () => (target.getMessageAttachment as (...inner: unknown[]) => Promise<unknown>)(...this.withDelegateOptions(args, request)),
          {
            operation: "messages.getMessageAttachment",
            kind: "messages.attachment",
            keyParts: ["messages", "attachment", args, messageId, attachmentId],
            agentId,
            channelName,
            request,
          },
        );
      }) as MessagesApiLike["getMessageAttachment"],
      getInvocationLogs: ((...args: unknown[]) =>
        (target.getInvocationLogs as (...inner: unknown[]) => Promise<unknown>)(...args)) as MessagesApiLike["getInvocationLogs"],
      createMultipartPayload: target.createMultipartPayload.bind(target),
    } as MessagesApiLike;
  }

  private makeGatewayFacade(): GatewayClientLike {
    const target = this.client.gateway;
    return {
      ...target,
      connect: target.connect.bind(target),
      disconnect: target.disconnect.bind(target),
      on: target.on.bind(target),
      off: target.off.bind(target),
      subscribe: target.subscribe.bind(target),
      unsubscribe: target.unsubscribe.bind(target),
      subscribeToChannel: ((channel, handlers) =>
        target.subscribeToChannel(channel, {
          ...handlers,
          onMessage: (message) => {
            this.enqueuePersist(() => this.persistGatewayMessage(message));
            handlers.onMessage?.(message);
          },
          onMessageUpdate: (message, requestData) => {
            this.enqueuePersist(() => this.persistGatewayMessage(message));
            handlers.onMessageUpdate?.(message, requestData);
          },
          onAggregate: (aggregate) => {
            this.enqueuePersist(() => this.persistGatewayAggregate(channel, aggregate));
            handlers.onAggregate?.(aggregate);
          },
        })) as GatewayClientLike["subscribeToChannel"],
      syncChannel: this.offlineGuard("gateway.syncChannel", target.syncChannel.bind(target)) as GatewayClientLike["syncChannel"],
      sendOneShotMessage: this.offlineGuard("gateway.sendOneShotMessage", target.sendOneShotMessage.bind(target)) as GatewayClientLike["sendOneShotMessage"],
      getSession: target.getSession.bind(target),
      isConnected: target.isConnected.bind(target),
      getSubscriptionCount: target.getSubscriptionCount.bind(target),
      getSubscriptions: target.getSubscriptions.bind(target),
      reconnect: target.reconnect.bind(target),
    } as GatewayClientLike;
  }

  private makeRpcFacade(): RpcDispatcherLike {
    const target = this.client.rpc;
    return {
      setStats: target.setStats?.bind(target) ?? (() => undefined),
      send: this.offlineGuard("rpc.send", target.send.bind(target)) as RpcDispatcherLike["send"],
    } as RpcDispatcherLike;
  }

  private passThroughSubclient<T extends object>(name: keyof DataClient & string): T {
    const target = this.client[name] as Record<string, unknown>;
    return new Proxy({}, {
      get: (_unused, prop) => {
        if (typeof prop !== "string") return undefined;
        const value = target[prop];
        if (typeof value !== "function") return value;
        const operation = `${name}.${prop}`;
        if (isLikelyWrite(prop)) return this.offlineGuard(operation, value.bind(target));
        return value.bind(target);
      },
    }) as T;
  }

  private offlineGuard<T extends AnyFn>(operation: string, fn: T): T {
    return ((...args: unknown[]) => {
      if (!this.isOnline()) throw new DooverOfflineError(operation);
      return fn(...args);
    }) as T;
  }

  private async readCached<T>(
    fetcher: () => Promise<T>,
    descriptor: CacheDescriptor,
  ): Promise<T> {
    const effective = this.effectivePolicy(descriptor);
    const key = this.cacheKey(descriptor);
    const fallbackKey = descriptor.fallbackKeyParts
      ? this.cacheKey({ ...descriptor, kind: "messages.latest", keyParts: descriptor.fallbackKeyParts })
      : undefined;
    const read = () => this.readRecord<T>(key, descriptor.operation, effective.allowExpired, fallbackKey);

    if (effective.mode === "cache-only" || !this.isOnline()) {
      return read();
    }

    if (effective.mode === "cache-first") {
      const cached = await this.tryReadRecord<T>(key, effective.allowExpired);
      if (cached.hit) return cached.value as T;
    }

    try {
      const value = await fetcher();
      if (effective.enabled) {
        await this.writeRecord(key, descriptor, effective, value);
        await this.writePolicyDerivedRecords(descriptor, effective, value);
      }
      this.setOfflineStatus({
        state: "online",
        operation: descriptor.operation,
        cacheKey: key,
        isOfflineFallback: false,
        isExpired: false,
      });
      return value;
    } catch (error) {
      if (!effective.enabled) throw error;
      const cached = await this.tryReadRecord<T>(key, effective.allowExpired);
      if (cached.hit) return cached.value as T;
      throw error;
    }
  }

  private async readBlobCached(
    fetcher: () => Promise<unknown>,
    descriptor: CacheDescriptor,
  ): Promise<Blob> {
    const effective = this.effectivePolicy(descriptor);
    const key = this.cacheKey(descriptor);
    if (effective.mode === "cache-only" || !this.isOnline()) {
      const cached = await this.storage.getBlob?.(key);
      if (cached) {
        this.setOfflineStatus({
          state: this.isOnline() ? "cache-hit" : "cache-fallback",
          operation: descriptor.operation,
          cacheKey: key,
          isOfflineFallback: !this.isOnline(),
          isExpired: false,
        });
        return cached;
      }
      this.setOfflineStatus({
        state: "cache-miss",
        operation: descriptor.operation,
        cacheKey: key,
        isOfflineFallback: !this.isOnline(),
        isExpired: false,
      });
      throw new DooverOfflineError(
        descriptor.operation,
        `No cached attachment is available for "${descriptor.operation}" while offline.`,
        key,
      );
    }

    if (effective.mode === "cache-first") {
      const cached = await this.storage.getBlob?.(key);
      if (cached) return cached;
    }

    const value = await fetcher();
    if (!(value instanceof Blob)) return value as Blob;
    if (effective.enabled && this.shouldCacheAttachmentBlob(descriptor)) {
      const now = Date.now();
      await this.storage.setBlob?.(key, value, {
        key,
        scope: this.scope,
        kind: descriptor.kind,
        value: {
          content_type: value.type || null,
          size: value.size,
        },
        cachedAt: now,
        lastAccessedAt: now,
        expiresAt: effective.retentionMs > 0 ? now + effective.retentionMs : null,
        schemaVersion: SCHEMA_VERSION,
        ...(effective.policyId ? { policyId: effective.policyId } : {}),
      });
    }
    this.setOfflineStatus({
      state: "online",
      operation: descriptor.operation,
      cacheKey: key,
      isOfflineFallback: false,
      isExpired: false,
    });
    return value;
  }

  private async readRecord<T>(
    key: string,
    operation: string,
    allowExpired: boolean,
    fallbackKey?: string,
  ): Promise<T> {
    const result = await this.tryReadRecord<T>(key, allowExpired);
    if (result.hit) return result.value as T;
    if (fallbackKey) {
      const fallback = await this.tryReadRecord<T>(fallbackKey, allowExpired);
      if (fallback.hit) return fallback.value as T;
    }
    this.setOfflineStatus({
      state: "cache-miss",
      operation,
      cacheKey: key,
      isOfflineFallback: !this.isOnline(),
      isExpired: false,
    });
    throw new DooverOfflineError(
      operation,
      `No cached data is available for "${operation}" while offline.`,
      key,
    );
  }

  private async tryReadRecord<T>(key: string, allowExpired: boolean): Promise<{ hit: boolean; value?: T }> {
    const record = await this.storage.getJson<T>(key);
    if (!record) return { hit: false };
    const expired = record.expiresAt !== null && record.expiresAt <= Date.now();
    if (expired && !allowExpired) {
      this.setOfflineStatus({
        state: "expired",
        operation: record.kind,
        cacheKey: key,
        cachedAt: record.cachedAt,
        expiresAt: record.expiresAt,
        serverUpdatedAt: record.serverUpdatedAt ?? null,
        isOfflineFallback: !this.isOnline(),
        isExpired: true,
      });
      return { hit: false };
    }
    record.lastAccessedAt = Date.now();
    await this.storage.setJson(key, record);
    this.setOfflineStatus({
      state: this.isOnline() ? "cache-hit" : "cache-fallback",
      operation: record.kind,
      cacheKey: key,
      cachedAt: record.cachedAt,
      expiresAt: record.expiresAt,
      serverUpdatedAt: record.serverUpdatedAt ?? null,
      isOfflineFallback: !this.isOnline(),
      isExpired: expired,
    });
    return { hit: true, value: record.value };
  }

  private async writeRecord<T>(
    key: string,
    descriptor: CacheDescriptor,
    effective: EffectivePolicy,
    value: T,
  ): Promise<void> {
    const now = Date.now();
    const record: OfflineCacheRecord<T> = {
      key,
      scope: this.scope,
      kind: descriptor.kind,
      value,
      cachedAt: now,
      lastAccessedAt: now,
      expiresAt: effective.retentionMs > 0 ? now + effective.retentionMs : null,
      serverUpdatedAt: descriptor.serverUpdatedAt?.(value) ?? null,
      schemaVersion: SCHEMA_VERSION,
      ...(effective.policyId ? { policyId: effective.policyId } : {}),
    };
    await this.storage.setJson(key, record);
  }

  private async writePolicyDerivedRecords<T>(
    descriptor: CacheDescriptor,
    effective: EffectivePolicy,
    value: T,
  ): Promise<void> {
    if (descriptor.kind !== "messages.list" || !descriptor.agentId || !descriptor.channelName) {
      return;
    }
    if (!Array.isArray(value)) return;
    await this.writeLatestMessagesRecord(
      descriptor.agentId,
      descriptor.channelName,
      value as MessageStructure[],
      effective,
    );
  }

  private async writeLatestMessagesRecord(
    agentId: string,
    channelName: string,
    messages: MessageStructure[],
    effective?: EffectivePolicy,
  ): Promise<void> {
    const policy = this.matchPolicy(agentId, channelName);
    if (!policy && !effective) return;
    if (policy?.cache === false) return;
    const retentionMs = effective?.retentionMs ?? policy?.retentionMs ?? this.defaultRetentionMs;
    const count = policy?.messages?.count ?? messages.length;
    const pruned = pruneLatestMessages(messages, count);
    const descriptor: CacheDescriptor = {
      operation: "messages.latest",
      kind: "messages.latest",
      keyParts: this.latestMessagesKeyParts(agentId, channelName),
      agentId,
      channelName,
      serverUpdatedAt: newestMessageTimestamp,
    };
    await this.writeRecord(
      this.cacheKey(descriptor),
      descriptor,
      {
        enabled: true,
        mode: "network-first",
        retentionMs,
        allowExpired: false,
        ...(effective?.policyId || policy?.id ? { policyId: effective?.policyId ?? policy?.id } : {}),
      },
      pruned,
    );
  }

  private async mergeLatestMessage(
    agentId: string,
    channelName: string,
    message: MessageStructure,
  ): Promise<void> {
    const policy = this.matchPolicy(agentId, channelName);
    if (!policy || policy.cache === false) return;
    const descriptor: CacheDescriptor = {
      operation: "messages.latest",
      kind: "messages.latest",
      keyParts: this.latestMessagesKeyParts(agentId, channelName),
      agentId,
      channelName,
      serverUpdatedAt: newestMessageTimestamp,
    };
    const key = this.cacheKey(descriptor);
    const existing = await this.storage.getJson<MessageStructure[]>(key);
    const current = existing?.value ?? [];
    const withoutDuplicate = current.filter((item) => item.id !== message.id);
    await this.writeLatestMessagesRecord(agentId, channelName, [...withoutDuplicate, message], {
      enabled: true,
      mode: "network-first",
      retentionMs: policy.retentionMs ?? this.defaultRetentionMs,
      allowExpired: false,
      ...(policy.id ? { policyId: policy.id } : {}),
    });
  }

  private async persistGatewayMessage(message: MessageStructure): Promise<void> {
    await this.mergeLatestMessage(message.channel.agent_id, message.channel.name, message);
    const descriptor: CacheDescriptor = {
      operation: "messages.getMessage",
      kind: "messages.get",
      keyParts: ["messages", "get", [{ agentId: message.channel.agent_id, channelName: message.channel.name }, message.id], message.id],
      agentId: message.channel.agent_id,
      channelName: message.channel.name,
      serverUpdatedAt: (value) =>
        typeof (value as { timestamp?: unknown } | undefined)?.timestamp === "number"
          ? (value as { timestamp: number }).timestamp
          : undefined,
    };
    const policy = this.matchPolicy(message.channel.agent_id, message.channel.name);
    if (!policy || policy.cache === false) return;
    await this.writeRecord(
      this.cacheKey(descriptor),
      descriptor,
      {
        enabled: true,
        mode: "network-first",
        retentionMs: policy.retentionMs ?? this.defaultRetentionMs,
        allowExpired: false,
        ...(policy.id ? { policyId: policy.id } : {}),
      },
      message,
    );
  }

  private async persistGatewayAggregate(
    channel: { agent_id: string; name: string },
    aggregate: Aggregate,
  ): Promise<void> {
    const policy = this.matchPolicy(channel.agent_id, channel.name);
    if (!policy || policy.cache === false) return;
    const descriptor: CacheDescriptor = {
      operation: "aggregates.getAggregate",
      kind: "aggregates.get",
      keyParts: ["aggregates", "get", [{ agentId: channel.agent_id, channelName: channel.name }]],
      agentId: channel.agent_id,
      channelName: channel.name,
      serverUpdatedAt: (value) =>
        typeof (value as { last_updated?: unknown } | undefined)?.last_updated === "number"
          ? (value as { last_updated: number }).last_updated
          : undefined,
    };
    await this.writeRecord(
      this.cacheKey(descriptor),
      descriptor,
      {
        enabled: true,
        mode: "network-first",
        retentionMs: policy.retentionMs ?? this.defaultRetentionMs,
        allowExpired: false,
        ...(policy.id ? { policyId: policy.id } : {}),
      },
      aggregate,
    );
  }

  private effectivePolicy(descriptor: CacheDescriptor): EffectivePolicy {
    const cache = descriptor.request?.cache;
    const cacheOptions = cache === false ? undefined : cache;
    const matching = this.matchPolicy(descriptor.agentId, descriptor.channelName);
    const enabled =
      cache === false ? false :
      cacheOptions?.enabled !== undefined ? cacheOptions.enabled :
      matching ? matching.cache !== false :
      cache !== undefined;
    return {
      enabled,
      mode: cacheOptions?.mode ?? "network-first",
      retentionMs:
        cacheOptions?.retentionMs !== undefined
          ? cacheOptions.retentionMs
          : matching?.retentionMs ?? this.defaultRetentionMs,
      allowExpired: !!cacheOptions?.allowExpired,
      ...(cacheOptions?.policy ? { policyId: cacheOptions.policy } : matching?.id ? { policyId: matching.id } : {}),
    };
  }

  private matchPolicy(agentId?: string, channelName?: string): OfflineChannelPolicy | undefined {
    if (!channelName) return undefined;
    return this.policies.find((policy) =>
      policy.channel.channelName === channelName &&
      (policy.channel.agentId === undefined || policy.channel.agentId === agentId),
    );
  }

  private shouldCacheAttachmentBlob(descriptor: CacheDescriptor): boolean {
    const policy = this.matchPolicy(descriptor.agentId, descriptor.channelName);
    if (!policy) return descriptor.request?.cache !== undefined && descriptor.request.cache !== false;
    if (descriptor.kind === "messages.attachment") {
      return policy.messageAttachments?.include === "metadata-and-selected-blobs";
    }
    if (descriptor.kind === "aggregates.attachment") {
      return policy.aggregateAttachments?.include === "metadata-and-selected-blobs";
    }
    return false;
  }

  private withDelegateOptions(args: unknown[], request?: DooverRequestOptions): unknown[] {
    const delegate = delegateRequestOptions(request);
    return delegate ? [...args, delegate] : args;
  }

  private cacheKey(descriptor: CacheDescriptor): string {
    return `${this.scopePrefix(this.scope)}:${stableStringify({
      kind: descriptor.kind,
      keyParts: descriptor.keyParts,
      sources: descriptor.request?.sources ? [...descriptor.request.sources].sort() : undefined,
    })}`;
  }

  private latestMessagesKeyParts(agentId: string, channelName: string): unknown[] {
    return ["messages", "latest", { agentId, channelName }];
  }

  private scopePrefix(scope: OfflineCacheScope): string {
    return `doover-offline:v${SCHEMA_VERSION}:${stableStringify({
      userId: scope.userId,
      organisationId: scope.organisationId ?? null,
      sourceId: scope.sourceId ?? "default",
      sharing: scope.sharing ?? null,
      assumeUserId: scope.assumeUserId ?? null,
    })}`;
  }

  private isOnline(): boolean {
    if (this.isOnlineFn) return this.isOnlineFn();
    const nav = globalThis.navigator as { onLine?: boolean } | undefined;
    return nav?.onLine ?? true;
  }

  private setOfflineStatus(status: Omit<OfflineStatusSnapshot, "online" | "at">): void {
    this.offlineStatus = {
      ...status,
      online: this.isOnline(),
      at: Date.now(),
    };
    this.offlineStatusListeners.forEach((listener) => listener(this.offlineStatus));
  }

  private enqueuePersist(task: () => Promise<void>): void {
    this.persistQueue = this.persistQueue
      .then(task)
      .catch(() => undefined);
  }
}

function extractAgentId(args: unknown[]): string | undefined {
  return typeof args[0] === "string"
    ? args[0]
    : (args[0] as { agentId?: string } | undefined)?.agentId;
}

function extractChannelId(args: unknown[]): { agentId?: string; channelName?: string } {
  if (typeof args[0] === "string") {
    return { agentId: args[0], channelName: args[1] as string | undefined };
  }
  const id = args[0] as { agentId?: string; channelName?: string } | undefined;
  return { agentId: id?.agentId, channelName: id?.channelName };
}

function newestMessageTimestamp(value: unknown): number | null | undefined {
  if (!Array.isArray(value)) return undefined;
  let newest: number | null = null;
  for (const message of value) {
    const timestamp = (message as { timestamp?: unknown }).timestamp;
    if (typeof timestamp === "number" && (newest === null || timestamp > newest)) {
      newest = timestamp;
    }
  }
  return newest;
}

function pruneLatestMessages(messages: MessageStructure[], count: number): MessageStructure[] {
  if (count <= 0) return [];
  const byId = new Map<string, MessageStructure>();
  for (const message of messages) byId.set(message.id, message);
  return [...byId.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-count);
}

function isLikelyWrite(method: string): boolean {
  return /^(create|put|patch|post|delete|update|sync|archive|unarchive|test|regenerate|invoke)/.test(method);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStringify(value));
}

function sortForStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStringify);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().reduce<Record<string, unknown>>((acc, key) => {
    const inner = record[key];
    if (inner !== undefined) acc[key] = sortForStringify(inner);
    return acc;
  }, {});
}

function scopeMatches(candidate: OfflineCacheScope, wanted: OfflineCacheScope): boolean {
  return (
    candidate.userId === wanted.userId &&
    (wanted.organisationId === undefined || candidate.organisationId === wanted.organisationId) &&
    (wanted.sourceId === undefined || candidate.sourceId === wanted.sourceId) &&
    (wanted.sharing === undefined || candidate.sharing === wanted.sharing) &&
    (wanted.assumeUserId === undefined || candidate.assumeUserId === wanted.assumeUserId)
  );
}
