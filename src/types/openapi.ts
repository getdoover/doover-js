import type {
  AgentAggregate,
  AgentPermission,
  Alarm,
  Aggregate,
  Channel,
  ConnectionDetails,
  ConnectionSubscription,
  ConnectionSubscriptionLog,
  DataSeries,
  MessageStructure,
  NotificationEndpoint,
  NotificationSubscription,
  ResourcePermission,
  TurnCredential,
} from "./common";

export type {
  AgentAggregate,
  AgentPermission,
  Alarm,
  Aggregate,
  Channel,
  ConnectionDetails,
  ConnectionSubscription,
  ConnectionSubscriptionLog,
  DataSeries,
  MessageStructure,
  NotificationEndpoint,
  NotificationSubscription,
  ResourcePermission,
  TurnCredential,
};

export interface BatchMessagesResponse {
  results: MessageStructure[];
  count: number;
  next?: string;
}

export interface BatchAggregatesResponse {
  results: AgentAggregate[];
  count: number;
}

export interface NotificationDataResponse {
  subscriptions: NotificationSubscription[];
  subscribers: NotificationSubscription[];
  endpoints: NotificationEndpoint[];
}

export interface NotificationEndpointsResponse {
  endpoints: NotificationEndpoint[];
}

export interface NotificationSubscriptionsResponse {
  subscriptions: NotificationSubscription[];
}

export interface NotificationSubscribersResponse {
  subscribers: NotificationSubscription[];
}

export interface NotificationSubscriptionCreateResponse {
  subscriptions: Array<{
    id: string;
    endpoint_id: string;
  }>;
}

export interface PermissionDebugResponse {
  cache?: AgentPermission | null;
  db: AgentPermission;
}

export interface ScheduleInfo {
  [key: string]: unknown;
}

export interface ProcessorSubscriptionInfo {
  [key: string]: unknown;
}

export interface IngestionEndpointInfo {
  [key: string]: unknown;
}

export interface SubscriptionInfo {
  agent_id: string;
  organisation_id: string;
  app_key: string;
  deployment_config: Record<string, unknown>;
  ui_state: Record<string, unknown>;
  ui_cmds: Record<string, unknown>;
  tag_values: Record<string, unknown>;
  connection_data: Record<string, unknown>;
  token: string;
}

export interface SuccessListResponse<T = string> {
  success: T[];
}

export interface CreateChannelRequest {
  is_private?: boolean;
  message_schema?: Record<string, unknown> | null;
  aggregate_schema?: Record<string, unknown> | null;
}

export interface PutChannelRequest extends CreateChannelRequest {
  is_private: boolean;
}

export interface CreateMessageRequest {
  data: Record<string, unknown>;
  ts?: number;
}

export interface UpdateMessageRequest {
  data: Record<string, unknown>;
}

export interface CreateAlarmRequest {
  name: string;
  description?: string;
  enabled?: boolean;
  key: string;
  operator: Alarm["operator"];
  value: unknown;
  expiry_mins?: number | null;
}

export interface PatchAlarmRequest extends Partial<CreateAlarmRequest> {}

export interface CreateEndpointRequest {
  name: string;
  priority?: number | null;
  type: number;
  extra_data: Record<string, unknown>;
  default: boolean;
}

export interface UpdateEndpointRequest {
  extra_data?: Record<string, unknown> | null;
  priority?: number | null;
  name?: string;
}

export interface CreateNotificationSubscriptionRequest {
  subscribe_to: string;
  endpoint_id?: string | null;
  severity: number;
  topic_filter: string[];
}

export interface UpdateNotificationSubscriptionRequest {
  severity?: number;
  topic_filter?: string[];
}

export interface UpdateMeWebPushEndpointRequest {
  old_endpoint: string;
  endpoint: string;
  key_p256dh: string;
  key_auth: string;
  expires_at: number;
}

export interface SyncPermissionRequest {
  agent_permissions: AgentPermission[];
}

export interface PutScheduleRequest {
  app_key: string;
  is_org?: boolean | null;
  permissions: ResourcePermission[];
}

export interface PutSubscriptionRequest {
  subscription_arn: string;
  app_key: string;
  is_org?: boolean | null;
  permissions: ResourcePermission[];
}

export interface CreateIngestionRequest {
  lambda_arn: string;
  cidr_ranges: string[];
  signing_key?: string | null;
  signing_key_hash_header?: string | null;
  throttle_limit: number;
  never_replace_token?: boolean;
  mini_token?: boolean;
  is_org?: boolean | null;
  app_key: string;
  permissions: ResourcePermission[];
}

export interface TurnTokenRequest {
  role: "client" | "device";
  device_id?: string;
  camera_name: string;
}
