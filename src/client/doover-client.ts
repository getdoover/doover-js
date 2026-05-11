import { AgentsApi } from "../apis/agents-api";
import { AggregatesApi } from "../apis/aggregates-api";
import { AlarmsApi } from "../apis/alarms-api";
import { ChannelsApi } from "../apis/channels-api";
import { ConnectionsApi } from "../apis/connections-api";
import { MessagesApi } from "../apis/messages-api";
import { NotificationsApi } from "../apis/notifications-api";
import { PermissionsApi } from "../apis/permissions-api";
import { ProcessorsApi } from "../apis/processors-api";
import { TurnApi } from "../apis/turn-api";
import { UsersApi } from "../apis/users-api";
import { buildAuth } from "../auth/build-auth";
import type { DooverAuth } from "../auth/doover-auth";
import { GatewayClient } from "../gateway/gateway-client";
import { RestClient, type DooverClientConfig } from "../http/rest-client";
import { RpcDispatcher } from "../rpc/rpc-dispatcher";
import { DooverDataProvider } from "../viewer/doover-data-provider";
import { ALL_CAPABILITIES, type Capability } from "./capabilities";
import type {
  AgentsApiLike,
  AggregatesApiLike,
  AlarmsApiLike,
  ChannelsApiLike,
  ConnectionsApiLike,
  DataClient,
  DataClientStatus,
  AgentScope,
  GatewayClientLike,
  MessagesApiLike,
  NotificationsApiLike,
  PermissionsApiLike,
  ProcessorsApiLike,
  RpcDispatcherLike,
  TurnApiLike,
  UsersApiLike,
} from "./data-client";
import { ProvenanceStamper, wrapSubclient, type ClientIdentity } from "./provenance";
import { ClientStatusTracker } from "./status-tracker";
import { DooverStatsCollector, type DooverStatsSnapshot } from "./stats";

const ALL_CAPS_SET: ReadonlySet<Capability> = new Set(ALL_CAPABILITIES);

export class DooverClient implements DataClient {
  readonly auth: DooverAuth;
  readonly rest: RestClient;
  readonly viewer: DooverDataProvider;
  readonly users: UsersApiLike;
  readonly channels: ChannelsApiLike;
  readonly messages: MessagesApiLike;
  readonly aggregates: AggregatesApiLike;
  readonly alarms: AlarmsApiLike;
  readonly connections: ConnectionsApiLike;
  readonly notifications: NotificationsApiLike;
  readonly permissions: PermissionsApiLike;
  readonly processors: ProcessorsApiLike;
  readonly turn: TurnApiLike;
  readonly agents: AgentsApiLike;
  readonly gateway: GatewayClientLike;
  readonly rpc: RpcDispatcherLike;
  readonly stats: DooverStatsCollector;

  private readonly identity: ClientIdentity;
  private readonly statusTracker: ClientStatusTracker;
  /** Underlying concrete gateway (the public `gateway` is the same object,
   *  typed as the structural `GatewayClientLike`). */
  private readonly gatewayImpl: GatewayClient;

  constructor(config: DooverClientConfig) {
    this.auth = buildAuth({
      auth: config.auth,
      profile: config.profile,
      configManager: config.configManager,
      token: config.token,
      tokenExpires: config.tokenExpires,
      refreshToken: config.refreshToken,
      refreshTokenId: config.refreshTokenId,
      authServerUrl: config.authServerUrl,
      authServerClientId: config.authServerClientId,
      fetchImpl: config.fetchImpl,
    });

    this.identity = {
      id: config.sourceId ?? "cloud",
      kind: "cloud",
      ...(config.sourceLabel ? { label: config.sourceLabel } : {}),
      meta: {
        dataRestUrl: config.dataRestUrl,
        controlApiUrl: config.controlApiUrl,
        ...(config.organisationId ? { organisationId: config.organisationId } : {}),
      },
    };
    const stamper = new ProvenanceStamper(this.identity);

    this.rest = new RestClient(config, this.auth);
    this.gatewayImpl = new GatewayClient(config, this.auth);
    this.gatewayImpl.setProvenanceHook((value, ctx) => stamper.stampGatewayEvent(value, ctx));
    this.gateway = this.gatewayImpl;
    this.viewer = new DooverDataProvider({
      rest: this.rest,
      gateway: this.gatewayImpl,
      controlApiUrl: config.controlApiUrl,
    });

    this.users = wrapSubclient(new UsersApi(this.rest, config.controlApiUrl), "users", stamper) as unknown as UsersApiLike;
    this.channels = wrapSubclient(new ChannelsApi(this.rest), "channels", stamper) as unknown as ChannelsApiLike;
    this.messages = wrapSubclient(new MessagesApi(this.rest), "messages", stamper) as unknown as MessagesApiLike;
    this.aggregates = wrapSubclient(new AggregatesApi(this.rest), "aggregates", stamper) as unknown as AggregatesApiLike;
    this.alarms = wrapSubclient(new AlarmsApi(this.rest), "alarms", stamper) as unknown as AlarmsApiLike;
    this.connections = wrapSubclient(new ConnectionsApi(this.rest), "connections", stamper) as unknown as ConnectionsApiLike;
    this.notifications = wrapSubclient(new NotificationsApi(this.rest), "notifications", stamper) as unknown as NotificationsApiLike;
    this.permissions = wrapSubclient(new PermissionsApi(this.rest), "permissions", stamper) as unknown as PermissionsApiLike;
    this.processors = wrapSubclient(new ProcessorsApi(this.rest), "processors", stamper) as unknown as ProcessorsApiLike;
    this.turn = wrapSubclient(new TurnApi(this.rest), "turn", stamper) as unknown as TurnApiLike;
    this.agents = wrapSubclient(new AgentsApi(this.rest, config.controlApiUrl), "agents", stamper) as unknown as AgentsApiLike;

    // RpcDispatcher needs the concrete MessagesApi (it calls postMessage internally);
    // give it an *unwrapped* one so stamping happens once at the public boundary.
    this.rpc = new RpcDispatcher(this.gatewayImpl, new MessagesApi(this.rest));

    this.stats = new DooverStatsCollector();
    this.rest.setStats(this.stats);
    this.gatewayImpl.setStats(this.stats);
    (this.rpc as RpcDispatcher).setStats(this.stats);

    this.statusTracker = new ClientStatusTracker(
      this.identity.id,
      this.gateway,
      () => this.getKnownAgentScope(),
    );
  }

  enableStats(): void { this.stats.setEnabled(true); }
  disableStats(): void { this.stats.setEnabled(false); }
  getStats(): DooverStatsSnapshot { return this.stats.snapshot(); }

  // --- DataClient: capabilities ---
  getCapabilities(): ReadonlySet<Capability> { return ALL_CAPS_SET; }
  supports(cap: Capability): boolean { return ALL_CAPS_SET.has(cap); }

  // --- DataClient: agent scope (cloud serves every agent) ---
  getAgentScope(): Promise<AgentScope> { return Promise.resolve({ mode: "all" }); }
  getKnownAgentScope(): AgentScope | "unknown" { return { mode: "all" }; }

  // --- DataClient: status ---
  isConnected(): boolean { return this.gateway.isConnected(); }
  getStatus(): DataClientStatus { return this.statusTracker.getStatus(); }
  onStatusChange(listener: (status: DataClientStatus) => void): () => void {
    return this.statusTracker.onChange(listener);
  }
}
