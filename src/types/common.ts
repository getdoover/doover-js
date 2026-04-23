export type JSONPrimitive = null | boolean | number | string;

export type JSONValue =
  | JSONPrimitive
  | JSONValue[]
  | { [key: string]: JSONValue };

export interface Attachment {
  url: string;
  content_type: string | null;
  filename: string;
  size: number;
}

export interface ChannelRef {
  agent_id: string;
  name: string;
}

export interface Aggregate<TData = Record<string, JSONValue>> {
  data: TData;
  attachments: Attachment[];
  last_updated?: number | null;
}

export interface MessageAttachment extends Attachment {}

export interface MessageStructure<TData = JSONValue> {
  data: TData;
  attachments: MessageAttachment[];
  id: string;
  author_id: string;
  channel: ChannelRef;
  timestamp: number;
  record_log?: boolean;
}

export interface Channel<TAgg = Record<string, JSONValue>> {
  aggregate?: Aggregate<TAgg>;
  is_private: boolean;
  id?: string;
  name: string;
  owner_id: string;
  alarms_enabled?: boolean;
  aggregate_schema?: Record<string, JSONValue> | null;
  message_schema?: Record<string, JSONValue> | null;
  daily_message_summaries?: unknown[];
  alarms?: Alarm[];
}

export interface Alarm {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  key: string;
  operator: AlarmOperator;
  value: JSONValue;
  state: AlarmState;
  expiry_mins: number | null;
  entered_state_ts: number;
}

export type AlarmOperator = "eq" | "ge" | "gt" | "le" | "lt";
export type AlarmState = "NoData" | "OK" | "Alarm";

export interface ConnectionSubscription {
  channel: ChannelRef;
  subscribed_at: number;
  connection_id: string;
}

export interface ConnectionSubscriptionLog {
  channel: ChannelRef;
  subscribed_at?: number | null;
  unsubscribed_at?: number | null;
  connection_id: string;
}

export interface ConnectionDetails {
  address: string;
  agent_id: string;
  default_session: boolean;
  session_id: string;
  last_ping?: number | null;
  latency?: number | null;
  status: number;
  subscriptions: ConnectionSubscription[];
}

export interface NotificationSubscriptionEndpoint {
  id: string;
  name: string;
  default: boolean;
}

export interface NotificationSubscription {
  id: string;
  subscriber: string;
  subscribed_to: string;
  severity: number;
  topic_filter: string[];
  endpoints: NotificationSubscriptionEndpoint[];
}

export interface NotificationEndpoint {
  id: string;
  agent_id: string;
  type: number;
  priority: number | null;
  extra_data: Record<string, JSONValue>;
  name: string;
  default: boolean;
}

export interface ResourcePermission {
  permission_id: string;
  permission: string;
}

export interface AgentPermission {
  agent_id: string;
  is_superuser: boolean;
  resources: ResourcePermission[];
  last_updated?: number | null;
}

export interface TurnCredential {
  username: string;
  credential: string;
  ttl: number;
  expires_at: number;
  uris: string[];
}

export interface AgentAggregate<TData = Record<string, JSONValue>> {
  agent_id: string;
  data: TData;
  attachments: Attachment[];
  last_updated?: number | null;
}

export interface DataSeriesResult {
  value: JSONValue;
  message_id: string;
}

export interface DataSeries {
  count: number;
  results: DataSeriesResult[];
}

/**
 * Lifecycle status for an RPC. `pending` carries arbitrary intermediate
 * payloads (progress updates) emitted by the server while the request is
 * in flight.
 */
export type RpcStatus<TPending = undefined> =
  | { code: "awaiting_confirmation" }
  | { code: "sent" }
  | { code: "acknowledged"; message: { timestamp: number } }
  | { code: "error"; message: string | object }
  | { code: "deferred"; message: { until: number; at: number } }
  | { code: "pending"; message: TPending }
  | { code: "success" };

/** Shape a consumer posts to initiate an RPC. */
export interface RpcRequest<TRequest = object> {
  app_key?: string;
  method: string;
  request: TRequest;
}

/** Shape of the message the server maintains as the RPC progresses. */
export interface RpcMessageData<
  TRequest = object,
  TResponse = object,
  TPending = undefined,
> extends RpcRequest<TRequest> {
  status: RpcStatus<TPending>;
  response: TResponse;
}
