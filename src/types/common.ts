import type { SourceProvenance } from "./provenance";

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
  __source?: SourceProvenance;
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
  __source?: SourceProvenance;
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
  __source?: SourceProvenance;
}

export interface Alarm {
  id: string;
  name: string;
  description: string;
  /** Channel the alarm lives on — set on every alarm the REST API returns. */
  channel_name?: string;
  topic_name?: string;
  notification_policy?: "default" | "opt-in";
  enabled: boolean;
  key: string;
  operator: AlarmOperator;
  value: JSONValue;
  state: AlarmState;
  expiry_mins: number | null;
  entered_state_ts: number;
  alarm_pending_ms: number | null;
  rate_threshold?: number | null;
  rate_window_ms?: number | null;
  rate_baseline_value?: number | null;
  rate_baseline_ts?: number | null;
  messages?: AlarmMessages | null;
  __source?: SourceProvenance;
}

/**
 * Per-transition notification override. `notify` and `text` are independent:
 * turning notifications off keeps whatever wording was set, and `text: null`
 * means "use the auto-generated message".
 */
export interface AlarmStateMessage {
  notify?: boolean;
  text?: string | null;
}

/** Notification overrides keyed by the state being entered. */
export interface AlarmMessages {
  alarm?: AlarmStateMessage;
  ok?: AlarmStateMessage;
  pending?: AlarmStateMessage;
  no_data?: AlarmStateMessage;
}

export type AlarmOperator = "eq" | "ge" | "gt" | "le" | "lt";
export type AlarmState = "NoData" | "OK" | "Alarm" | "AlarmPending";

export interface ConnectionSubscription {
  channel: ChannelRef;
  subscribed_at: number;
  connection_id: string;
  __source?: SourceProvenance;
}

export interface ConnectionSubscriptionLog {
  channel: ChannelRef;
  subscribed_at?: number | null;
  unsubscribed_at?: number | null;
  connection_id: string;
  __source?: SourceProvenance;
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
  __source?: SourceProvenance;
}

/**
 * How a subscription's `topic_filter` entries are matched. `exact` is literal
 * (and the server's default when the field is absent); `regex` matches each
 * expression against the whole canonical topic. Entries are ORed either way.
 */
export type NotificationTopicFilterMode = "exact" | "regex";

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
  topic_filter_mode: NotificationTopicFilterMode;
  endpoints: NotificationSubscriptionEndpoint[];
  __source?: SourceProvenance;
}

export interface NotificationEndpoint {
  id: string;
  agent_id: string;
  type: number;
  priority: number | null;
  extra_data: Record<string, JSONValue>;
  name: string;
  default: boolean;
  __source?: SourceProvenance;
}

/**
 * Delivery readiness for an endpoint, without its destination address or
 * `extra_data` — the one endpoint listing a delegated subscription manager is
 * allowed to see.
 */
export interface NotificationEndpointSummary {
  id: string;
  type: number;
  priority: number | null;
  name: string;
  display_name: string | null;
  default: boolean;
  ready: boolean;
  __source?: SourceProvenance;
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
  __source?: SourceProvenance;
}

export interface TurnCredential {
  username: string;
  credential: string;
  ttl: number;
  expires_at: number;
  uris: string[];
  __source?: SourceProvenance;
}

export interface AgentAggregate<TData = Record<string, JSONValue>> {
  agent_id: string;
  data: TData;
  attachments: Attachment[];
  last_updated?: number | null;
  __source?: SourceProvenance;
}

export interface DataSeriesResult {
  value: JSONValue;
  message_id: string;
  __source?: SourceProvenance;
}

export interface DataSeries {
  count: number;
  results: DataSeriesResult[];
  next?: string | null;
  __source?: SourceProvenance;
}

/**
 * Lifecycle status for an RPC.
 *
 * `sent` is written by the sender; the other non-terminal codes come from the
 * device handling the request. `acknowledged` means it has picked the request
 * up, and `pending` carries arbitrary intermediate payloads (progress updates)
 * it emits while still working — by convention a `{ text }` summary, plus
 * whatever structured fields the handler wants alongside it. Both prove the
 * device is alive, so consumers should treat either as a reason to extend how
 * long they are willing to wait (see `SendRpcOptions.pendingTimeoutMs`), never
 * as a completion.
 *
 * `success` and `error` are the only terminal codes.
 */
export type RpcStatus<TPending = undefined> =
  | { code: "awaiting_confirmation" }
  | { code: "sent" }
  | { code: "acknowledged"; message: { timestamp: number } }
  | { code: "error"; message: string | object }
  | { code: "deferred"; message: { until: number; at: number } }
  | { code: "pending"; message: TPending }
  | { code: "success" };

export interface RpcActor {
  id: string;
  name: string;
  email: string;
}

/** Shape a consumer posts to initiate an RPC. */
export interface RpcRequest<TRequest = object> {
  app_key?: string;
  method: string;
  request: TRequest;
  actor?: RpcActor;
}

/** Shape of the message the server maintains as the RPC progresses. */
export interface RpcMessageData<
  TRequest = object,
  TResponse = object,
  TPending = undefined,
> extends RpcRequest<TRequest> {
  status: RpcStatus<TPending>;
  response: TResponse;
  __source?: SourceProvenance;
}
