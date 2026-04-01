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
import { GatewayClient } from "../gateway/gateway-client";
import { RestClient, type DooverClientConfig } from "../http/rest-client";
import { DooverDataProvider } from "../viewer/doover-data-provider";

export class DooverClient {
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

  constructor(config: DooverClientConfig) {
    this.rest = new RestClient(config);
    this.viewer = new DooverDataProvider(config);
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
    this.gateway = new GatewayClient(config);
  }
}
