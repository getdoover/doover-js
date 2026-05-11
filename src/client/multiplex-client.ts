import type { Capability } from "./capabilities";
import type {
  AgentScope, AgentsApiLike, AggregatesApiLike, AlarmsApiLike, ChannelsApiLike,
  ConnectionsApiLike, DataClient, DataClientStatus, GatewayClientLike,
  MessagesApiLike, NotificationsApiLike, PermissionsApiLike, ProcessorsApiLike,
  RpcDispatcherLike, TurnApiLike, UsersApiLike,
} from "./data-client";
import { dedupeBy, mergeMessages } from "./multiplex-merge";
import { UnsupportedCapabilityError, AmbiguousWriteError } from "./errors";
import { extractSnowflakeId } from "../utils/snowflake";
import { MultiplexGateway, type MultiplexGatewayHost } from "./multiplex-gateway";

export type { DataClient } from "./data-client";
export type { AgentScope } from "./data-client";
export type { DataClientStatus } from "./data-client";

export interface MultiplexConflict {
  method: string;
  agentId: string;
  channelName: string;
  /** All owning members that returned a value (in member order). */
  sourceIds: string[];
  /** The values, parallel to `sourceIds`. The chosen one is index 0. */
  values: unknown[];
  at: number;
}

type MethodKind = "read-fanout-first" | "write-route";
interface MethodSpec { cap: Capability; kind: MethodKind; agentScoped: boolean }

/** "<subclient>.<method>" → spec. Drives the generic non-core facades. */
const NONCORE_METHODS: Record<string, MethodSpec> = {
  // alarms
  "alarms.listAlarms": { cap: "alarms.read", kind: "read-fanout-first", agentScoped: true },
  "alarms.getAlarm": { cap: "alarms.read", kind: "read-fanout-first", agentScoped: true },
  "alarms.createAlarm": { cap: "alarms.write", kind: "write-route", agentScoped: true },
  "alarms.putAlarm": { cap: "alarms.write", kind: "write-route", agentScoped: true },
  "alarms.patchAlarm": { cap: "alarms.write", kind: "write-route", agentScoped: true },
  "alarms.deleteAlarm": { cap: "alarms.write", kind: "write-route", agentScoped: true },
  // connections
  "connections.getAgentConnections": { cap: "connections.read", kind: "read-fanout-first", agentScoped: true },
  "connections.getAgentConnectionHistory": { cap: "connections.read", kind: "read-fanout-first", agentScoped: true },
  "connections.getAgentSubscriptionHistory": { cap: "connections.read", kind: "read-fanout-first", agentScoped: true },
  "connections.getConnection": { cap: "connections.read", kind: "read-fanout-first", agentScoped: false },
  "connections.getChannelSubscriptions": { cap: "connections.read", kind: "read-fanout-first", agentScoped: true },
  "connections.syncConnection": { cap: "connections.write", kind: "write-route", agentScoped: true },
  // notifications (reads)
  "notifications.getAgentNotifications": { cap: "notifications.read", kind: "read-fanout-first", agentScoped: true },
  "notifications.getAgentNotificationEndpoints": { cap: "notifications.read", kind: "read-fanout-first", agentScoped: true },
  "notifications.getAgentNotificationSubscriptions": { cap: "notifications.read", kind: "read-fanout-first", agentScoped: true },
  "notifications.getAgentDefaultNotificationSubscriptions": { cap: "notifications.read", kind: "read-fanout-first", agentScoped: true },
  "notifications.getAgentNotificationSubscribers": { cap: "notifications.read", kind: "read-fanout-first", agentScoped: true },
  "notifications.getWebPushPublicKey": { cap: "notifications.read", kind: "read-fanout-first", agentScoped: false },
  // notifications (writes)
  "notifications.createNotificationEndpoint": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.updateNotificationEndpoint": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.deleteNotificationEndpoint": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.testNotificationEndpoint": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.createNotificationSubscription": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.deleteDefaultNotificationSubscription": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.updateNotificationSubscription": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.deleteNotificationSubscription": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.updateMeWebPushEndpoint": { cap: "notifications.write", kind: "write-route", agentScoped: false },
  // permissions
  "permissions.getAgentPermission": { cap: "permissions.read", kind: "read-fanout-first", agentScoped: true },
  "permissions.getAgentPermissionDebug": { cap: "permissions.read", kind: "read-fanout-first", agentScoped: true },
  "permissions.syncPermissions": { cap: "permissions.write", kind: "write-route", agentScoped: false },
  // processors
  "processors.getScheduleInfo": { cap: "processors.read", kind: "read-fanout-first", agentScoped: false },
  "processors.getScheduleInfoAlias": { cap: "processors.read", kind: "read-fanout-first", agentScoped: false },
  "processors.getProcessorSubscriptionInfo": { cap: "processors.read", kind: "read-fanout-first", agentScoped: false },
  "processors.getProcessorSubscriptionInfoAlias": { cap: "processors.read", kind: "read-fanout-first", agentScoped: false },
  "processors.createProcessorSchedule": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.deleteProcessorSchedule": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.regenerateScheduleToken": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.createProcessorSubscription": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.deleteProcessorSubscription": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.createIngestionEndpoint": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.deleteIngestionEndpoint": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.invokeIngestionEndpoint": { cap: "processors.write", kind: "write-route", agentScoped: true },
  // turn / users
  "turn.createTurnToken": { cap: "turn.credentials", kind: "read-fanout-first", agentScoped: false },
  "users.getMe": { cap: "users.me", kind: "read-fanout-first", agentScoped: false },
};

/** A serialisable description of a source. */
export interface SourceDescriptor {
  id: string;
  kind: string;
  params?: Record<string, unknown>;
  label?: string;
}

export interface RegisteredSource {
  descriptor: SourceDescriptor;
  client?: DataClient;
  enabled: boolean;
}

export interface MultiplexClientOptions {
  factory: (descriptor: SourceDescriptor) => DataClient | Promise<DataClient>;
  register?: SourceDescriptor[];
  enable?: string[];
  enableAll?: boolean;
  disconnectOnDisable?: boolean;
  clientId?: string;
}

type MuxEvent = "change" | "conflict";

export class MultiplexClient implements DataClient {
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

  private readonly registry = new Map<string, RegisteredSource>();
  private readonly factory: MultiplexClientOptions["factory"];
  private readonly disconnectOnDisable: boolean;
  private readonly clientId: string;
  private readonly eventListeners = new Map<MuxEvent, Set<(...args: unknown[]) => void>>();
  private capabilitiesCache: ReadonlySet<Capability> | null = null;
  private lastConflicts: MultiplexConflict[] = [];
  private readonly maxConflicts = 50;
  private readonly statusListeners = new Set<(status: DataClientStatus) => void>();
  /** sourceId → member unsubscribe fn for its onStatusChange. */
  private readonly memberStatusUnsubs = new Map<string, () => void>();

  constructor(options: MultiplexClientOptions) {
    this.factory = options.factory;
    this.disconnectOnDisable = options.disconnectOnDisable ?? true;
    this.clientId = options.clientId ?? "multiplex";

    for (const d of options.register ?? []) this.registerSource(d);
    const toEnable = options.enableAll
      ? (options.register ?? []).map((d) => d.id)
      : (options.enable ?? []);
    for (const id of toEnable) this.enableSource(id);

    this.agents = this.makeAgentsFacade();
    this.channels = this.makeChannelsFacade();
    this.messages = this.makeMessagesFacade();
    this.aggregates = this.makeAggregatesFacade();
    this.alarms = this.makeReadFacade<AlarmsApiLike>("alarms");
    this.connections = this.makeReadFacade<ConnectionsApiLike>("connections");
    this.notifications = this.makeReadFacade<NotificationsApiLike>("notifications");
    this.permissions = this.makeReadFacade<PermissionsApiLike>("permissions");
    this.processors = this.makeReadFacade<ProcessorsApiLike>("processors");
    this.turn = this.makeReadFacade<TurnApiLike>("turn");
    this.users = this.makeReadFacade<UsersApiLike>("users");
    this.rpc = this.makeRpcFacade();
    this.gateway = this.makeCompositeGateway();
  }

  // ===== registry / activation =====
  registerSource(descriptor: SourceDescriptor): void {
    const existing = this.registry.get(descriptor.id);
    if (existing) {
      existing.descriptor = { ...existing.descriptor, ...descriptor };
      return;
    }
    this.registry.set(descriptor.id, { descriptor, enabled: false });
  }

  setActiveSources(idsOrDescriptors: Array<string | SourceDescriptor>): void {
    const wanted = new Set<string>();
    for (const item of idsOrDescriptors) {
      if (typeof item === "string") {
        if (!this.registry.has(item)) {
          throw new Error(`MultiplexClient.setActiveSources: unknown source id "${item}" — pass a descriptor to auto-register.`);
        }
        wanted.add(item);
      } else {
        this.registerSource(item);
        wanted.add(item.id);
      }
    }
    const currentlyEnabled = new Set(
      [...this.registry.values()].filter((s) => s.enabled).map((s) => s.descriptor.id),
    );
    const same = wanted.size === currentlyEnabled.size && [...wanted].every((id) => currentlyEnabled.has(id));
    if (same) return;
    for (const id of currentlyEnabled) if (!wanted.has(id)) this.disableSource(id, { silent: true });
    for (const id of wanted) if (!currentlyEnabled.has(id)) this.enableSource(id, { silent: true });
    this.invalidateCapabilities();
    this.emit("change");
  }

  enableSource(id: string, opts?: { silent?: boolean }): void {
    const src = this.registry.get(id);
    if (!src) throw new Error(`MultiplexClient.enableSource: unknown source id "${id}".`);
    if (src.enabled) return;
    if (!src.client) {
      const built = this.factory(src.descriptor);
      if (built instanceof Promise) {
        src.enabled = true;
        void built.then((client) => {
          src.client = client;
          this.attachMemberListeners(src);
          this.invalidateCapabilities();
          this.emit("change");
        });
        if (!opts?.silent) { this.invalidateCapabilities(); this.emit("change"); }
        return;
      }
      src.client = built;
    }
    src.enabled = true;
    this.attachMemberListeners(src);
    if (!opts?.silent) { this.invalidateCapabilities(); this.emit("change"); }
  }

  disableSource(id: string, opts?: { silent?: boolean }): void {
    const src = this.registry.get(id);
    if (!src || !src.enabled) return;
    src.enabled = false;
    this.detachMemberListeners(src);
    if (this.disconnectOnDisable && src.client) {
      try { src.client.gateway.disconnect(); } catch { /* ignore */ }
    }
    if (!opts?.silent) { this.invalidateCapabilities(); this.emit("change"); }
  }

  removeSource(id: string): void {
    const src = this.registry.get(id);
    if (!src) return;
    if (src.enabled) this.disableSource(id, { silent: true });
    else if (src.client) { try { src.client.gateway.disconnect(); } catch { /* ignore */ } }
    this.registry.delete(id);
    this.invalidateCapabilities();
    this.emit("change");
  }

  getActiveSources(): readonly RegisteredSource[] {
    return [...this.registry.values()].filter((s) => s.enabled);
  }
  getRegisteredSources(): readonly RegisteredSource[] {
    return [...this.registry.values()];
  }

  /** Enabled members that have a built `client`. */
  protected enabledClients(): Array<{ id: string; src: RegisteredSource; client: DataClient }> {
    return this.getActiveSources()
      .filter((s): s is RegisteredSource & { client: DataClient } => !!s.client)
      .map((s) => ({ id: s.descriptor.id, src: s, client: s.client }));
  }

  // ===== events =====
  on(event: MuxEvent, handler: (...args: unknown[]) => void): void {
    (this.eventListeners.get(event) ?? this.eventListeners.set(event, new Set()).get(event)!).add(handler);
  }
  off(event: MuxEvent, handler: (...args: unknown[]) => void): void {
    this.eventListeners.get(event)?.delete(handler);
  }
  protected emit(event: MuxEvent, ...args: unknown[]): void {
    this.eventListeners.get(event)?.forEach((h) => h(...args));
    // keep status observers in sync whenever the member set changes
    if (event === "change") this.emitStatus();
  }

  private invalidateCapabilities(): void { this.capabilitiesCache = null; }

  private attachMemberListeners(src: RegisteredSource): void {
    if (!src.client) return;
    if (this.memberStatusUnsubs.has(src.descriptor.id)) return;
    const unsub = src.client.onStatusChange(() => this.emitStatus());
    this.memberStatusUnsubs.set(src.descriptor.id, unsub);
  }

  private detachMemberListeners(src: RegisteredSource): void {
    const unsub = this.memberStatusUnsubs.get(src.descriptor.id);
    if (unsub) { unsub(); this.memberStatusUnsubs.delete(src.descriptor.id); }
  }

  private makeCompositeGateway(): GatewayClientLike {
    const host: MultiplexGatewayHost = {
      gatewayMembers: () =>
        this.enabledClients()
          .filter(({ client }) => client.supports("gateway.subscribe"))
          .map(({ id, client }) => ({ id, gateway: client.gateway })),
      gatewayMembersForAgent: (agentId) =>
        this.membersForAgentWithCapability(agentId, "gateway.subscribe")
          .map(({ id, client }) => ({ id, gateway: client.gateway })),
    };
    return new MultiplexGateway(host);
  }

  // ===== helpers =====

  /** Resolve the optional `{ sources?: string[] }` bag from a method's trailing
   *  arg: returns the candidate members, narrowed to `sources` if given (each
   *  must be enabled), still capability-filtered by the caller. The bag is the
   *  LAST argument if it is a plain object with a `sources` array. */
  private splitSourcesOption(args: unknown[]): { args: unknown[]; sources?: string[] } {
    const last = args[args.length - 1];
    if (last && typeof last === "object" && !Array.isArray(last) && Array.isArray((last as { sources?: unknown }).sources)) {
      return { args: args.slice(0, -1), sources: (last as { sources: string[] }).sources };
    }
    return { args };
  }

  private candidates(agentId: string | undefined, cap: Capability, sources?: string[]) {
    let members = this.membersForAgentWithCapability(agentId, cap);
    if (sources) {
      const allow = new Set(sources);
      members = members.filter((m) => allow.has(m.id));
    }
    return members;
  }

  /** Throw if no enabled member supports `cap` at all (regardless of agent). */
  private assertSomeMemberSupports(cap: Capability): void {
    if (!this.enabledClients().some(({ client }) => client.supports(cap))) {
      throw new UnsupportedCapabilityError(cap, this.clientId);
    }
  }

  private isNotFound(err: unknown): boolean {
    return !!err && typeof err === "object" && (err as { status?: number }).status === 404;
  }

  private requiredMessagesCapability(params?: { before?: string; after?: string }): Capability {
    if (params?.after) return "messages.listHistorical";
    if (params?.before) {
      try {
        const { timestamp: ts } = extractSnowflakeId(params.before);
        if (typeof ts === "number" && ts < Date.now() - 24 * 60 * 60 * 1000) return "messages.listHistorical";
      } catch { /* not a valid snowflake, treat as latest */ }
    }
    return "messages.list";
  }

  private unsupportedMethod(_method: string, cap: Capability) {
    return () => Promise.reject(new UnsupportedCapabilityError(cap, this.clientId));
  }

  private guessNonCoreCap(subclient: string): Capability {
    switch (subclient) {
      case "alarms": return "alarms.read";
      case "connections": return "connections.read";
      case "notifications": return "notifications.read";
      case "permissions": return "permissions.read";
      case "processors": return "processors.read";
      case "turn": return "turn.credentials";
      case "users": return "users.me";
      default: return "channels.get";
    }
  }

  protected recordConflict(method: string, agentId: string, channelName: string, values: Array<{ value: unknown; id: string }>): void {
    // Only a conflict if the values differ (cheap structural compare).
    const json = values.map((v) => JSON.stringify(v.value, (k, val) => (k === "__source" ? undefined : val)));
    const allEqual = json.every((j) => j === json[0]);
    if (allEqual) return;
    const conflict: MultiplexConflict = { method, agentId, channelName, sourceIds: values.map((v) => v.id), values: values.map((v) => v.value), at: Date.now() };
    this.lastConflicts.push(conflict);
    if (this.lastConflicts.length > this.maxConflicts) this.lastConflicts.shift();
    this.emit("conflict", conflict);
  }

  getLastConflicts(): readonly MultiplexConflict[] { return this.lastConflicts; }

  /**
   * Returns a method that routes a write to exactly one member:
   *  (a) `{ sources: [oneId] }` scoping → that member;
   *  (b) else the single enabled member that owns the targeted agent and has `cap`;
   *  (c) else `UnsupportedCapabilityError` (none) or `AmbiguousWriteError` (>1).
   * The targeted agent id is `args[0]` (string form) or `args[0].agentId` (identifier form).
   * Writes are never fanned out.
   */
  private routedWrite(method: string, cap: Capability) {
    const self = this;
    return async function (...rawArgs: unknown[]) {
      const { args, sources } = self.splitSourcesOption(rawArgs);
      const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId?: string } | undefined)?.agentId;
      let members = self.candidates(agentId, cap, sources);
      if (sources && sources.length === 1) {
        const only = members.find((m) => m.id === sources[0]);
        if (!only) throw new UnsupportedCapabilityError(cap, sources[0]);
        members = [only];
      }
      if (members.length === 0) throw new UnsupportedCapabilityError(cap, self.clientId);
      if (members.length > 1) throw new AmbiguousWriteError(cap, members.map((m) => m.id));
      const target = members[0];
      const subclient = method.split(".")[0] as keyof DataClient;
      const fnName = method.split(".")[1];
      const fn = (target.client[subclient] as Record<string, (...a: unknown[]) => unknown>)[fnName];
      return fn.apply(target.client[subclient], args);
    };
  }

  /** Agent-scoped "first success" — used by messages.getTimeseries / getInvocationLogs. */
  private makeFanoutFirst(method: string, cap: Capability) {
    const self = this;
    return async function (...rawArgs: unknown[]) {
      const { args, sources } = self.splitSourcesOption(rawArgs);
      self.assertSomeMemberSupports(cap);
      const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId?: string } | undefined)?.agentId;
      const members = self.candidates(agentId, cap, sources);
      if (members.length === 0) throw new UnsupportedCapabilityError(cap, self.clientId);
      const subclient = method.split(".")[0] as keyof DataClient;
      const fnName = method.split(".")[1];
      let lastErr: unknown;
      for (const m of members) {
        try {
          return await (m.client[subclient] as Record<string, (...a: unknown[]) => unknown>)[fnName](...args);
        } catch (e) { lastErr = e; if (!self.isNotFound(e)) throw e; }
      }
      throw lastErr ?? new Error(`${method}: no member returned a result`);
    };
  }

  /** Used by messages.getMessageAttachment — returns the first member that yields a Blob. */
  private makeBlobFanout(method: string, cap: Capability) {
    const self = this;
    return async function (...rawArgs: unknown[]) {
      const { args, sources } = self.splitSourcesOption(rawArgs);
      self.assertSomeMemberSupports(cap);
      const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId?: string } | undefined)?.agentId;
      const members = self.candidates(agentId, cap, sources);
      if (members.length === 0) throw new UnsupportedCapabilityError(cap, self.clientId);
      const subclient = method.split(".")[0] as keyof DataClient;
      const fnName = method.split(".")[1];
      let lastErr: unknown;
      for (const m of members) {
        try {
          return await (m.client[subclient] as unknown as Record<string, (...a: unknown[]) => Promise<Blob>>)[fnName](...args);
        } catch (e) { lastErr = e; if (!self.isNotFound(e)) throw e; }
      }
      throw lastErr ?? new Error(`${method}: no member returned a result`);
    };
  }

  // ===== core facades =====

  private makeChannelsFacade(): ChannelsApiLike {
    const self = this;
    return {
      async listChannels(agentIdOrId: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([agentIdOrId, ...rest]);
        const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId: string }).agentId;
        self.assertSomeMemberSupports("channels.list");
        const members = self.candidates(agentId, "channels.list", sources);
        const perMember = await Promise.all(members.map((m) => (m.client.channels.listChannels as (...a: unknown[]) => Promise<unknown[]>)(...args)));
        return dedupeBy(([] as unknown[]).concat(...perMember) as { name: string }[], (c) => c.name) as never;
      },
      async getChannel(agentIdOrId: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([agentIdOrId, ...rest]);
        const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId: string }).agentId;
        const name = typeof args[0] === "string" ? (args[1] as string) : (args[0] as { channelName: string }).channelName;
        self.assertSomeMemberSupports("channels.get");
        const members = self.candidates(agentId, "channels.get", sources);
        const settled = await Promise.allSettled(members.map((m) => (m.client.channels.getChannel as (...a: unknown[]) => Promise<unknown>)(...args)));
        const ok = settled.flatMap((r, i) => r.status === "fulfilled" ? [{ value: r.value, id: members[i].id }] : (r.status === "rejected" && !self.isNotFound(r.reason) ? (() => { throw r.reason; })() : []));
        if (ok.length === 0) { const e = new Error(`channel ${agentId}/${name} not found`) as Error & { status: number }; e.status = 404; throw e; }
        if (ok.length > 1) self.recordConflict("channels.getChannel", agentId, name, ok);
        return ok[0].value as never;
      },
      createChannel: self.routedWrite("channels.createChannel", "channels.create") as never,
      putChannel: self.routedWrite("channels.putChannel", "channels.create") as never,
      archiveChannel: self.routedWrite("channels.archiveChannel", "channels.archive") as never,
      unarchiveChannel: self.routedWrite("channels.unarchiveChannel", "channels.archive") as never,
      listDataSeries: self.unsupportedMethod("channels.listDataSeries", "channels.dataSeries") as never,
    } as ChannelsApiLike;
  }

  private makeAggregatesFacade(): AggregatesApiLike {
    const self = this;
    return {
      async getAggregate(agentIdOrId: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([agentIdOrId, ...rest]);
        const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId: string }).agentId;
        const name = typeof args[0] === "string" ? (args[1] as string) : (args[0] as { channelName: string }).channelName;
        self.assertSomeMemberSupports("aggregates.get");
        const members = self.candidates(agentId, "aggregates.get", sources);
        const settled = await Promise.allSettled(members.map((m) => (m.client.aggregates.getAggregate as (...a: unknown[]) => Promise<unknown>)(...args)));
        const ok = settled.flatMap((r, i) => r.status === "fulfilled" ? [{ value: r.value, id: members[i].id }] : (r.status === "rejected" && !self.isNotFound(r.reason) ? (() => { throw r.reason; })() : []));
        if (ok.length === 0) { const e = new Error(`aggregate ${agentId}/${name} not found`) as Error & { status: number }; e.status = 404; throw e; }
        if (ok.length > 1) self.recordConflict("aggregates.getAggregate", agentId, name, ok);
        return ok[0].value as never;
      },
      putAggregate: self.routedWrite("aggregates.putAggregate", "aggregates.put") as never,
      patchAggregate: self.routedWrite("aggregates.patchAggregate", "aggregates.patch") as never,
      async getAggregateAttachment(agentIdOrId: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([agentIdOrId, ...rest]);
        const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId: string }).agentId;
        self.assertSomeMemberSupports("aggregates.attachment");
        const members = self.candidates(agentId, "aggregates.attachment", sources);
        for (const m of members) {
          try { return await (m.client.aggregates.getAggregateAttachment as (...a: unknown[]) => Promise<Blob>)(...args); }
          catch (e) { if (!self.isNotFound(e)) throw e; }
        }
        const e = new Error("attachment not found") as Error & { status: number }; e.status = 404; throw e;
      },
    } as AggregatesApiLike;
  }

  private makeMessagesFacade(): MessagesApiLike {
    const self = this;
    return {
      async listMessages(agentIdOrId: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([agentIdOrId, ...rest]);
        const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId: string }).agentId;
        const params = (typeof args[0] === "string" ? args[2] : args[1]) as { order?: "asc" | "desc"; limit?: number; before?: string; after?: string } | undefined;
        const implied = self.requiredMessagesCapability(params);
        // a member is eligible if it has the implied cap; for "latest N" that IS messages.list.
        self.assertSomeMemberSupports(implied);
        const members = self.candidates(agentId, implied, sources);
        const perMember = await Promise.all(members.map((m) => (m.client.messages.listMessages as (...a: unknown[]) => Promise<unknown[]>)(...args)));
        return mergeMessages(perMember as never, { order: params?.order ?? "desc", limit: params?.limit }) as never;
      },
      async getMessage(agentIdOrId: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([agentIdOrId, ...rest]);
        const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId: string }).agentId;
        self.assertSomeMemberSupports("messages.get");
        const members = self.candidates(agentId, "messages.get", sources);
        for (const m of members) {
          try { return await (m.client.messages.getMessage as (...a: unknown[]) => Promise<unknown>)(...args) as never; }
          catch (e) { if (!self.isNotFound(e)) throw e; }
        }
        const e = new Error("message not found") as Error & { status: number }; e.status = 404; throw e;
      },
      postMessage: self.routedWrite("messages.postMessage", "messages.post") as never,
      putMessage: self.routedWrite("messages.putMessage", "messages.put") as never,
      patchMessage: self.routedWrite("messages.patchMessage", "messages.put") as never,
      deleteMessage: self.routedWrite("messages.deleteMessage", "messages.delete") as never,
      getTimeseries: self.makeFanoutFirst("messages.getTimeseries", "messages.timeseries") as never,
      getMessageAttachment: self.makeBlobFanout("messages.getMessageAttachment", "messages.attachment") as never,
      getInvocationLogs: self.makeFanoutFirst("messages.getInvocationLogs", "messages.invocationLogs") as never,
      createMultipartPayload(jsonPayload: Record<string, unknown>, attachments: Array<Blob | File>) {
        // pure helper — no member needed; mirror MessagesApi.createMultipartPayload
        const formData = new FormData();
        formData.set("json_payload", JSON.stringify(jsonPayload));
        attachments.forEach((attachment, index) => {
          formData.set(`attachment-${index}`, attachment);
        });
        return formData;
      },
    } as MessagesApiLike;
  }

  private makeAgentsFacade(): AgentsApiLike {
    const self = this;
    return {
      async listAgents(...rawArgs: unknown[]) {
        const { args, sources } = self.splitSourcesOption(rawArgs);
        self.assertSomeMemberSupports("agents.list");
        let members = self.enabledClients().filter(({ client }) => client.supports("agents.list"));
        if (sources) { const allow = new Set(sources); members = members.filter((m) => allow.has(m.id)); }
        const responses = await Promise.all(members.map((m) => (m.client.agents.listAgents as (...a: unknown[]) => Promise<{ agents?: unknown[]; results?: unknown[] }>)(...args)));
        const merged = dedupeBy(([] as { id: string }[]).concat(...responses.map((r) => (r.agents ?? r.results ?? []) as { id: string }[])), (a) => a.id);
        return { agents: merged, results: merged, count: merged.length } as never;
      },
      async getMultiAgentMessages(channelName: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([channelName, ...rest]);
        self.assertSomeMemberSupports("agents.multiAgentMessages");
        let members = self.enabledClients().filter(({ client }) => client.supports("agents.multiAgentMessages"));
        if (sources) { const allow = new Set(sources); members = members.filter((m) => allow.has(m.id)); }
        const responses = await Promise.all(members.map((m) => (m.client.agents.getMultiAgentMessages as (...a: unknown[]) => Promise<{ results: { id: string }[] }>)(...args)));
        const merged = mergeMessages(responses.map((r) => r.results) as never, { order: "desc" });
        return { results: merged, count: merged.length } as never;
      },
      async getMultiAgentAggregates(channelName: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([channelName, ...rest]);
        self.assertSomeMemberSupports("agents.multiAgentAggregates");
        let members = self.enabledClients().filter(({ client }) => client.supports("agents.multiAgentAggregates"));
        if (sources) { const allow = new Set(sources); members = members.filter((m) => allow.has(m.id)); }
        const responses = await Promise.all(members.map((m) => (m.client.agents.getMultiAgentAggregates as (...a: unknown[]) => Promise<{ results: { agent_id: string }[] }>)(...args)));
        const merged = dedupeBy(([] as { agent_id: string }[]).concat(...responses.map((r) => r.results)), (a) => a.agent_id);
        return { results: merged, count: merged.length } as never;
      },
    } as AgentsApiLike;
  }

  // ===== non-core generic facade =====

  private makeReadFacade<T extends object>(subclientName: string): T {
    const self = this;
    return new Proxy({}, {
      get(_t, prop) {
        if (typeof prop !== "string") return undefined;
        const key = `${subclientName}.${prop}`;
        const spec = NONCORE_METHODS[key];
        if (!spec) {
          // Unknown method on a non-core subclient — treat as unsupported (read).
          return () => Promise.reject(new UnsupportedCapabilityError(self.guessNonCoreCap(subclientName), self.clientId));
        }
        if (spec.kind === "write-route") {
          return self.routedWrite(key, spec.cap);
        }
        return async (...rawArgs: unknown[]) => {
          const { args, sources } = self.splitSourcesOption(rawArgs);
          self.assertSomeMemberSupports(spec.cap);
          const agentId = !spec.agentScoped ? undefined
            : (typeof args[0] === "string" ? args[0] : (args[0] as { agentId?: string } | undefined)?.agentId);
          let members = self.candidates(agentId, spec.cap, sources);
          if (members.length === 0) throw new UnsupportedCapabilityError(spec.cap, self.clientId);
          let lastErr: unknown;
          for (const m of members) {
            try {
              return await (m.client[subclientName as keyof DataClient] as Record<string, (...a: unknown[]) => unknown>)[prop](...args);
            } catch (e) { lastErr = e; if (!self.isNotFound(e)) throw e; }
          }
          throw lastErr ?? new Error(`${key}: no member returned a result`);
        };
      },
    }) as T;
  }

  private makeRpcFacade(): RpcDispatcherLike {
    const self = this;
    return {
      setStats() { /* no-op for the multiplex; members keep their own stats */ },
      send(channel: { agentId: string; channelName: string }, request: unknown, options?: unknown) {
        // route like a write keyed on channel.agentId
        const router = self.routedWrite("rpc.send", "rpc.send");
        return router(channel, request, options) as never;
      },
    } as RpcDispatcherLike;
  }

  // --- DataClient: capabilities ---
  getCapabilities(): ReadonlySet<Capability> {
    if (!this.capabilitiesCache) {
      const u = new Set<Capability>();
      for (const { client } of this.enabledClients()) for (const c of client.getCapabilities()) u.add(c);
      this.capabilitiesCache = u;
    }
    return this.capabilitiesCache;
  }
  supports(cap: Capability): boolean { return this.getCapabilities().has(cap); }

  // --- agent-scope routing ---
  /**
   * Enabled members eligible for a request targeting `agentId`: those whose
   * scope is `{ mode: "all" }` (the cloud — no enumeration), those whose list
   * contains `agentId`, and those whose scope is still `"unknown"` (included
   * optimistically; their scope settles for the next call). If `agentId` is
   * undefined, all enabled members are eligible.
   */
  protected membersForAgent(agentId?: string): Array<{ id: string; src: RegisteredSource; client: DataClient }> {
    const all = this.enabledClients();
    if (agentId === undefined) return all;
    return all.filter(({ client }) => {
      const scope = client.getKnownAgentScope();
      if (scope === "unknown") return true;
      if (scope.mode === "all") return true;
      return scope.agentIds.includes(agentId);
    });
  }

  /** Members (enabled) that both own `agentId` and advertise `cap`. */
  protected membersForAgentWithCapability(agentId: string | undefined, cap: Capability) {
    return this.membersForAgent(agentId).filter(({ client }) => client.supports(cap));
  }

  getAgentScope(): Promise<AgentScope> {
    return Promise.all(this.enabledClients().map(({ client }) => client.getAgentScope())).then((scopes) => {
      if (scopes.some((s) => s.mode === "all")) return { mode: "all" };
      const ids = new Set<string>();
      for (const s of scopes) if (s.mode === "list") for (const id of s.agentIds) ids.add(id);
      return { mode: "list", agentIds: [...ids] };
    });
  }

  getKnownAgentScope(): AgentScope | "unknown" {
    const known = this.enabledClients().map(({ client }) => client.getKnownAgentScope());
    if (known.some((s) => s !== "unknown" && s.mode === "all")) return { mode: "all" };
    if (known.some((s) => s === "unknown")) return "unknown";
    const ids = new Set<string>();
    for (const s of known) if (s !== "unknown" && s.mode === "list") for (const id of s.agentIds) ids.add(id);
    return { mode: "list", agentIds: [...ids] };
  }

  isConnected(): boolean {
    const gwMembers = this.enabledClients().filter(({ client }) => client.supports("gateway.subscribe"));
    if (gwMembers.length === 0) return false;
    return gwMembers.every(({ client }) => client.isConnected());
  }

  getStatus(): DataClientStatus {
    const allSources = this.getRegisteredSources();
    const members = allSources.map((s) => ({
      sourceId: s.descriptor.id,
      ...(s.descriptor.label ? { label: s.descriptor.label } : {}),
      status: s.enabled && s.client
        ? s.client.getStatus()
        : ({ clientId: s.descriptor.id, connected: false, state: "disconnected" as const, agentScope: "unknown" as const, at: Date.now() }),
    }));
    const enabledMembers = members.filter((m) => this.registry.get(m.sourceId)?.enabled);
    const gwStatuses = enabledMembers
      .filter((m) => this.registry.get(m.sourceId)!.client?.supports("gateway.subscribe"))
      .map((m) => m.status);
    const connected = this.isConnected();
    let state: DataClientStatus["state"];
    if (enabledMembers.some((m) => m.status.state === "error")) state = "error";
    else if (gwStatuses.length === 0) state = "disconnected";
    else if (gwStatuses.every((s) => s.connected)) state = "connected";
    else if (gwStatuses.some((s) => s.connected)) state = "degraded";
    else if (gwStatuses.some((s) => s.state === "connecting")) state = "connecting";
    else state = "disconnected";
    // most-recent member values for scalar summary fields (locked decision #8)
    const newest = [...enabledMembers.map((m) => m.status)].sort((x, y) => y.at - x.at)[0];
    const gatewaySession = this.gateway.getSession();
    return {
      clientId: this.clientId,
      connected,
      state,
      session: gatewaySession ? { id: (gatewaySession as { session_id?: string }).session_id ?? "" } : null,
      ...(newest?.lastEvent ? { lastEvent: newest.lastEvent } : {}),
      latencyMs: newest?.latencyMs ?? null,
      ...(newest?.lastError ? { lastError: newest.lastError } : {}),
      agentScope: this.getKnownAgentScope(),
      at: Date.now(),
      members,
    };
  }

  onStatusChange(listener: (status: DataClientStatus) => void): () => void {
    this.statusListeners.add(listener);
    let active = true;
    return () => { if (!active) return; active = false; this.statusListeners.delete(listener); };
  }

  private emitStatus(): void {
    // Guard: during construction `this.gateway` may not be assigned yet.
    if (!this.gateway) return;
    const snap = this.getStatus();
    this.statusListeners.forEach((l) => l(snap));
  }
}
