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
import { buildAuth } from "../auth/build-auth";
import type { DooverAuth } from "../auth/doover-auth";
import { GatewayClient } from "../gateway/gateway-client";
import { RestClient, type DooverClientConfig } from "../http/rest-client";
import { DooverDataProvider } from "../viewer/doover-data-provider";
import {
  DooverStatsCollector,
  type DooverStatsSnapshot,
} from "./stats";

export class DooverClient {
  readonly auth: DooverAuth;
  readonly rest: RestClient;
  readonly viewer: DooverDataProvider;
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
  /** Opt-in instrumentation. Disabled by default — see {@link enableStats}. */
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
    this.viewer = new DooverDataProvider(config, this.auth);
    this.channels = new ChannelsApi(this.rest);
    this.messages = new MessagesApi(this.rest);
    this.aggregates = new AggregatesApi(this.rest);
    this.alarms = new AlarmsApi(this.rest);
    this.connections = new ConnectionsApi(this.rest);
    this.notifications = new NotificationsApi(this.rest);
    this.permissions = new PermissionsApi(this.rest);
    this.processors = new ProcessorsApi(this.rest);
    this.turn = new TurnApi(this.rest);
    this.agents = new AgentsApi(this.rest);
    // Reuse the viewer's gateway so `client.gateway` and
    // `client.viewer.gateway` are the same instance → one WebSocket per
    // client. Without this, `client.gateway.connect()` and
    // `client.viewer.subscribeToChannel(...)` each opened their own socket.
    this.gateway = this.viewer.gateway;

    // Stats collector, disabled by default. Attached to both REST clients
    // (facade + viewer's internal) and the shared gateway so every recorded
    // call flows through the same counters. Pay-to-play: record methods
    // short-circuit when disabled.
    this.stats = new DooverStatsCollector();
    this.rest.setStats(this.stats);
    this.viewer.rest.setStats(this.stats);
    this.gateway.setStats(this.stats);
  }

  /** Start capturing request/message stats. Off by default. */
  enableStats(): void {
    this.stats.setEnabled(true);
  }

  /** Stop capturing stats. Existing counters are retained; call `stats.reset()` to clear. */
  disableStats(): void {
    this.stats.setEnabled(false);
  }

  /**
   * Snapshot the current stats. Returns zeroed counters if stats were
   * never enabled. Combine with {@link GatewayClient.getSubscriptionCount}
   * and {@link GatewayClient.getSession} for a full debug view.
   */
  getStats(): DooverStatsSnapshot {
    return this.stats.snapshot();
  }
}
