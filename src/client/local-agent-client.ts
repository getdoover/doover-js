import { AgentsApi } from "../apis/agents-api";
import { AggregatesApi } from "../apis/aggregates-api";
import { ChannelsApi } from "../apis/channels-api";
import { MessagesApi } from "../apis/messages-api";
import { GatewayClient } from "../gateway/gateway-client";
import { RestClient, type DooverClientConfig } from "../http/rest-client";
import type { Capability } from "./capabilities";
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
import { UnsupportedCapabilityError } from "./errors";
import { ProvenanceStamper, wrapSubclient, type ClientIdentity } from "./provenance";
import { ClientStatusTracker } from "./status-tracker";

export interface LocalAgentClientConfig {
  /** Base URL of the local agent's REST API, e.g. "http://192.168.0.7:49100". */
  baseUrl: string;
  /** Base URL of the local agent's WebSocket gateway. Defaults to `baseUrl`
   *  with http(s)→ws(s). */
  wssUrl?: string;
  fetchImpl?: typeof fetch;
  webSocketImpl?: typeof WebSocket;
  webSocketFactory?: DooverClientConfig["webSocketFactory"];
  disableBrowserLifecycleHooks?: boolean;
  /** Stable source id. Defaults to `local:<host>:<port>` derived from baseUrl. */
  sourceId?: string;
  sourceLabel?: string;
  /** Reserved for a future LAN auth blob — ignored in v1. */
  auth?: unknown;
}

const LOCAL_CAPABILITIES: readonly Capability[] = [
  "agents.list",
  "channels.list",
  "channels.get",
  "aggregates.get",
  "aggregates.put",
  "aggregates.patch",
  "messages.list",
  "messages.post",
  "messages.put",
  "gateway.subscribe",
  "gateway.realtime",
  "gateway.oneShot",
] as const;

function deriveSourceId(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return `local:${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return `local:${baseUrl}`;
  }
}

function httpToWs(url: string): string {
  return url.replace(/^http/i, "ws");
}

export class LocalAgentClient implements DataClient {
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

  private readonly identity: ClientIdentity;
  private readonly capSet: ReadonlySet<Capability>;
  private readonly rest: RestClient;
  private readonly gatewayImpl: GatewayClient;
  private readonly statusTracker: ClientStatusTracker;
  /** Resolved device-agent id list; null until first resolution. */
  private resolvedScope: string[] | null = null;
  private scopeResolving: Promise<AgentScope> | null = null;

  constructor(config: LocalAgentClientConfig) {
    const sourceId = config.sourceId ?? deriveSourceId(config.baseUrl);
    this.identity = {
      id: sourceId,
      kind: "local",
      ...(config.sourceLabel ? { label: config.sourceLabel } : {}),
      meta: { baseUrl: config.baseUrl },
    };
    this.capSet = new Set(LOCAL_CAPABILITIES);
    const stamper = new ProvenanceStamper(this.identity);

    // RestClient / GatewayClient expect a DooverClientConfig — give them one
    // with the local URLs, no auth, no org/sharing headers.
    const restConfig = {
      dataRestUrl: config.baseUrl,
      controlApiUrl: config.baseUrl,
      dataWssUrl: config.wssUrl ?? httpToWs(config.baseUrl),
      organisationId: null,
      sharing: "none",
      fetchImpl: config.fetchImpl,
      webSocketImpl: config.webSocketImpl,
      webSocketFactory: config.webSocketFactory,
      disableBrowserLifecycleHooks: config.disableBrowserLifecycleHooks,
    } as unknown as DooverClientConfig;

    this.rest = new RestClient(restConfig); // no auth arg
    this.gatewayImpl = new GatewayClient(restConfig); // no auth arg
    this.gatewayImpl.setProvenanceHook((value, ctx) => stamper.stampGatewayEvent(value, ctx));
    this.gateway = this.gatewayImpl;

    // Real subclients for advertised methods, gated so only allowed methods pass;
    // all others throw UnsupportedCapabilityError.
    const realAgents = wrapSubclient(new AgentsApi(this.rest, config.baseUrl), "agents", stamper);
    const realChannels = wrapSubclient(new ChannelsApi(this.rest), "channels", stamper);
    const realMessages = wrapSubclient(new MessagesApi(this.rest), "messages", stamper);
    const realAggregates = wrapSubclient(new AggregatesApi(this.rest), "aggregates", stamper);

    this.agents = this.gatedSubclient<AgentsApiLike>("agents", realAgents, ["listAgents"]);
    this.channels = this.gatedSubclient<ChannelsApiLike>("channels", realChannels, ["listChannels", "getChannel"]);
    this.aggregates = this.gatedSubclient<AggregatesApiLike>("aggregates", realAggregates,
      ["getAggregate", "putAggregate", "patchAggregate"]);
    this.messages = this.gatedSubclient<MessagesApiLike>("messages", realMessages,
      ["listMessages", "postMessage", "putMessage", "patchMessage", "createMultipartPayload"]);

    // Never-advertised subclients: always throw.
    this.alarms = this.unsupportedSubclient<AlarmsApiLike>("alarms");
    this.connections = this.unsupportedSubclient<ConnectionsApiLike>("connections");
    this.notifications = this.unsupportedSubclient<NotificationsApiLike>("notifications");
    this.permissions = this.unsupportedSubclient<PermissionsApiLike>("permissions");
    this.processors = this.unsupportedSubclient<ProcessorsApiLike>("processors");
    this.turn = this.unsupportedSubclient<TurnApiLike>("turn");
    this.users = this.unsupportedSubclient<UsersApiLike>("users");
    this.rpc = this.unsupportedSubclient<RpcDispatcherLike>("rpc");

    this.statusTracker = new ClientStatusTracker(this.identity.id, this.gateway, () => this.getKnownAgentScope());

    // Resolve the device id on (re)connect so routing is precise before the
    // first agent-scoped request; invalidate the cache on each new session.
    this.gatewayImpl.on("ready", () => {
      this.resolvedScope = null;
      void this.getAgentScope();
    });
  }

  // --- capabilities ---
  getCapabilities(): ReadonlySet<Capability> { return this.capSet; }
  supports(cap: Capability): boolean { return this.capSet.has(cap); }

  // --- agent scope ---
  getAgentScope(): Promise<AgentScope> {
    if (this.resolvedScope) return Promise.resolve({ mode: "list", agentIds: this.resolvedScope });
    if (this.scopeResolving) return this.scopeResolving;
    this.scopeResolving = (async () => {
      try {
        const res = await this.agents.listAgents();
        const rawAgents = res?.agents ?? [];
        const first = rawAgents[0];
        const id = first?.id;
        this.resolvedScope = id ? [String(id)] : [];
      } catch {
        this.resolvedScope = [];
      } finally {
        this.scopeResolving = null;
        this.statusTracker.notifyScopeChanged();
      }
      return { mode: "list", agentIds: this.resolvedScope! };
    })();
    return this.scopeResolving;
  }

  getKnownAgentScope(): AgentScope | "unknown" {
    return this.resolvedScope ? { mode: "list", agentIds: this.resolvedScope } : "unknown";
  }

  // --- status ---
  isConnected(): boolean { return this.gateway.isConnected(); }
  getStatus(): DataClientStatus { return this.statusTracker.getStatus(); }
  onStatusChange(listener: (status: DataClientStatus) => void): () => void {
    return this.statusTracker.onChange(listener);
  }

  /**
   * Wraps a real (provenance-wrapped) subclient so only `allowed` method names
   * pass through; any other method call throws `UnsupportedCapabilityError`.
   */
  private gatedSubclient<T extends object>(name: string, real: object, allowed: string[]): T {
    const allowSet = new Set(allowed);
    const clientId = this.identity.id;
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
        if (allowSet.has(prop)) return Reflect.get(target, prop, receiver);
        return () => {
          const cap = METHOD_TO_CAPABILITY[`${name}.${prop}`] ?? guessCapability(name);
          return Promise.reject(new UnsupportedCapabilityError(cap, clientId));
        };
      },
    }) as T;
  }

  /**
   * Builds a Proxy that throws `UnsupportedCapabilityError` (mapped via
   * METHOD_TO_CAPABILITY) for every method call. Used for subclients with no
   * advertised methods.
   */
  private unsupportedSubclient<T extends object>(name: string): T {
    const clientId = this.identity.id;
    return new Proxy({}, {
      get(_t, prop) {
        if (typeof prop !== "string") return undefined;
        return () => {
          const cap = METHOD_TO_CAPABILITY[`${name}.${prop}`] ?? guessCapability(name);
          return Promise.reject(new UnsupportedCapabilityError(cap, clientId));
        };
      },
    }) as T;
  }
}

const METHOD_TO_CAPABILITY: Record<string, Capability> = {
  "agents.listAgents": "agents.list",
  "agents.getMultiAgentMessages": "agents.multiAgentMessages",
  "agents.getMultiAgentAggregates": "agents.multiAgentAggregates",
  "channels.listChannels": "channels.list",
  "channels.getChannel": "channels.get",
  "channels.createChannel": "channels.create",
  "channels.putChannel": "channels.create",
  "channels.archiveChannel": "channels.archive",
  "channels.unarchiveChannel": "channels.archive",
  "channels.listDataSeries": "channels.dataSeries",
  "aggregates.getAggregate": "aggregates.get",
  "aggregates.putAggregate": "aggregates.put",
  "aggregates.patchAggregate": "aggregates.patch",
  "aggregates.getAggregateAttachment": "aggregates.attachment",
  "messages.listMessages": "messages.list",
  "messages.postMessage": "messages.post",
  "messages.getMessage": "messages.get",
  "messages.putMessage": "messages.put",
  "messages.patchMessage": "messages.put",
  "messages.deleteMessage": "messages.delete",
  "messages.getMessageAttachment": "messages.attachment",
  "messages.getTimeseries": "messages.timeseries",
  "messages.getInvocationLogs": "messages.invocationLogs",
  "rpc.send": "rpc.send",
  "users.getMe": "users.me",
  "turn.createTurnToken": "turn.credentials",
};

function guessCapability(subclient: string): Capability {
  switch (subclient) {
    case "alarms": return "alarms.read";
    case "connections": return "connections.read";
    case "notifications": return "notifications.read";
    case "permissions": return "permissions.read";
    case "processors": return "processors.read";
    case "turn": return "turn.credentials";
    case "users": return "users.me";
    case "rpc": return "rpc.send";
    default: return "channels.get";
  }
}
