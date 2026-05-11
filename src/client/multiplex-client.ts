import type { Capability } from "./capabilities";
import type {
  AgentScope, AgentsApiLike, AggregatesApiLike, AlarmsApiLike, ChannelsApiLike,
  ConnectionsApiLike, DataClient, DataClientStatus, GatewayClientLike,
  MessagesApiLike, NotificationsApiLike, PermissionsApiLike, ProcessorsApiLike,
  RpcDispatcherLike, TurnApiLike, UsersApiLike,
} from "./data-client";

export type { DataClient } from "./data-client";
export type { AgentScope } from "./data-client";

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

  constructor(options: MultiplexClientOptions) {
    this.factory = options.factory;
    this.disconnectOnDisable = options.disconnectOnDisable ?? true;
    this.clientId = options.clientId ?? "multiplex";

    for (const d of options.register ?? []) this.registerSource(d);
    const toEnable = options.enableAll
      ? (options.register ?? []).map((d) => d.id)
      : (options.enable ?? []);
    for (const id of toEnable) this.enableSource(id);

    this.agents = this.makeReadFacade<AgentsApiLike>("agents");
    this.channels = this.makeReadFacade<ChannelsApiLike>("channels");
    this.messages = this.makeReadFacade<MessagesApiLike>("messages");
    this.aggregates = this.makeReadFacade<AggregatesApiLike>("aggregates");
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
  }

  private invalidateCapabilities(): void { this.capabilitiesCache = null; }

  // --- placeholders filled in later sub-phases (4b / 4c) ---
  private attachMemberListeners(_src: RegisteredSource): void { /* Task 27 */ }
  private detachMemberListeners(_src: RegisteredSource): void { /* Task 27 */ }
  private makeReadFacade<T extends object>(name: string): T {
    return new Proxy({}, { get: (_t, prop) => () => Promise.reject(new Error(`MultiplexClient: ${name}.${String(prop)} not yet implemented (4b)`)) }) as T;
  }
  private makeRpcFacade(): RpcDispatcherLike { return this.makeReadFacade<RpcDispatcherLike>("rpc"); }
  private makeCompositeGateway(): GatewayClientLike { return this.makeReadFacade<GatewayClientLike>("gateway"); }

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

  // --- placeholder DataClient methods — filled in Task 27 (status) ---
  isConnected(): boolean { return false; }
  getStatus(): DataClientStatus { return { clientId: this.clientId, connected: false, state: "disconnected", agentScope: "unknown", at: Date.now() }; }
  onStatusChange(_l: (s: DataClientStatus) => void): () => void { return () => {}; }
}
