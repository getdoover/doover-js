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
import {
  DooverStatsCollector,
  type DooverStatsSnapshot,
} from "./stats";

export class DooverClient {
  readonly auth: DooverAuth;
  readonly rest: RestClient;
  readonly viewer: DooverDataProvider;
  readonly users: UsersApi;
  readonly channels: ChannelsApi;
  readonly messages: MessagesApi;
  readonly aggregates: AggregatesApi;
  readonly alarms: AlarmsApi;
  readonly connections: ConnectionsApi;
  readonly notifications: NotificationsApi;
  readonly permissions: PermissionsApi;
  readonly processors: ProcessorsApi;
  readonly turn: TurnApi;
  readonly agents: AgentsApi;
  readonly gateway: GatewayClient;
  readonly rpc: RpcDispatcher;
  readonly stats: DooverStatsCollector;

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

    this.rest = new RestClient(config, this.auth);
    this.gateway = new GatewayClient(config, this.auth);
    this.viewer = new DooverDataProvider({
      rest: this.rest,
      gateway: this.gateway,
      controlApiUrl: config.controlApiUrl,
    });

    this.users = new UsersApi(this.rest, config.controlApiUrl);
    this.channels = new ChannelsApi(this.rest);
    this.messages = new MessagesApi(this.rest);
    this.aggregates = new AggregatesApi(this.rest);
    this.alarms = new AlarmsApi(this.rest);
    this.connections = new ConnectionsApi(this.rest);
    this.notifications = new NotificationsApi(this.rest);
    this.permissions = new PermissionsApi(this.rest);
    this.processors = new ProcessorsApi(this.rest);
    this.turn = new TurnApi(this.rest);
    this.agents = new AgentsApi(this.rest, config.controlApiUrl);

    this.rpc = new RpcDispatcher(this.gateway, this.messages);

    this.stats = new DooverStatsCollector();
    this.rest.setStats(this.stats);
    this.gateway.setStats(this.stats);
    this.rpc.setStats(this.stats);
  }

  enableStats(): void { this.stats.setEnabled(true); }
  disableStats(): void { this.stats.setEnabled(false); }
  getStats(): DooverStatsSnapshot { return this.stats.snapshot(); }
}
