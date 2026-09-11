export { DooverClient } from "./client/doover-client.js";
export { LocalAgentClient } from "./client/local-agent-client.js";
export type { LocalAgentClientConfig } from "./client/local-agent-client.js";
export { MultiplexClient } from "./client/multiplex-client.js";
export type {
  MultiplexClientOptions,
  SourceDescriptor,
  RegisteredSource,
  MultiplexConflict,
} from "./client/multiplex-client.js";
export {
  getDooverClient,
  peekDooverClient,
  resetDooverClient,
} from "./client/singleton.js";
export { DooverStatsCollector } from "./client/stats.js";
export type {
  DooverStatsSnapshot,
  RestStatsSnapshot,
  GatewayStatsSnapshot,
} from "./client/stats.js";

export { AgentsApi } from "./apis/agents-api.js";
export type {
  AgentTokenState,
  AgentTokenPolicy,
  TokenPolicyField,
  AdhocTokenResponse,
  DeviceTokenResponse,
  ResourcePermission,
} from "./apis/agents-api.js";
export { AggregatesApi } from "./apis/aggregates-api.js";
export { AlarmsApi } from "./apis/alarms-api.js";
export { ChannelsApi } from "./apis/channels-api.js";
export { ConnectionsApi } from "./apis/connections-api.js";
export { MessagesApi } from "./apis/messages-api.js";
export { NotificationsApi } from "./apis/notifications-api.js";
export { OrganisationsApi } from "./apis/organisations-api.js";
export type { ListOrganisationsOptions } from "./apis/organisations-api.js";
export { PermissionsApi } from "./apis/permissions-api.js";
export { ProcessorsApi } from "./apis/processors-api.js";
export { TurnApi } from "./apis/turn-api.js";
export { UsersApi } from "./apis/users-api.js";

export { RpcDispatcher } from "./rpc/rpc-dispatcher.js";
export type { SendRpcOptions } from "./rpc/rpc-dispatcher.js";
export { DooverRpcError } from "./rpc/errors.js";

export type { ChannelHandlers } from "./gateway/gateway-client.js";
export type { RpcStatsSnapshot } from "./client/stats.js";

export { ALL_CAPABILITIES } from "./client/capabilities.js";
export type { Capability } from "./client/capabilities.js";
export { UnsupportedCapabilityError, AmbiguousWriteError, DooverOfflineError } from "./client/errors.js";
export {
  OfflineDataClient,
  MemoryOfflineStorageAdapter,
  DEFAULT_OFFLINE_RETENTION_MS,
} from "./client/offline-cache.js";
export type {
  OfflineCacheMode,
  OfflineReadCacheOptions,
  OfflineChannelPolicy,
  OfflineCacheScope,
  OfflineCacheRecord,
  OfflineStorageAdapter,
  OfflineDataClientOptions,
} from "./client/offline-cache.js";
export {
  requestOptions,
  isDooverRequestOptions,
  splitRequestOptions,
} from "./client/request-options.js";
export type { DooverRequestOptions } from "./client/request-options.js";
export { MAX_BATCH_ITEMS, chunkBatchItems, mergeBatchResponses } from "./types/batch.js";
export type {
  BatchAggregateUpdateItem,
  BatchAggregateResponse,
  BatchCreateMessageItem,
  BatchUpdateMessageItem,
  BatchDeleteMessageItem,
  BatchMessageResponse,
  BatchMessageResultItem,
  BatchResultItem,
  BatchResponse,
} from "./types/batch.js";
export type {
  DataClient,
  AgentScope,
  DataClientStatus,
  DataClientConnectionState,
  AgentsApiLike,
  AggregatesApiLike,
  AlarmsApiLike,
  ChannelsApiLike,
  ConnectionsApiLike,
  MessagesApiLike,
  NotificationsApiLike,
  PermissionsApiLike,
  ProcessorsApiLike,
  TurnApiLike,
  UsersApiLike,
  GatewayClientLike,
  RpcDispatcherLike,
} from "./client/data-client.js";
export type {
  SourceProvenance,
  SourceProvenanceViaRest,
  SourceProvenanceViaGateway,
} from "./types/provenance.js";

export { DooverAuth } from "./auth/doover-auth.js";
export { CookieAuth } from "./auth/cookie-auth.js";
export type { CookieAuthOptions } from "./auth/cookie-auth.js";
export { DooverTokenAuth } from "./auth/doover-token-auth.js";
export { AuthProfile } from "./auth/auth-profile.js";
export type { AuthProfileData } from "./auth/auth-profile.js";
export type { AuthProfileStore } from "./auth/auth-store.js";
export { DooverAuthError } from "./auth/errors.js";
export { buildAuth } from "./auth/build-auth.js";
export type { AuthConfig } from "./auth/build-auth.js";

export { GatewayClient } from "./gateway/gateway-client.js";
export type * from "./gateway/types.js";

export { RestClient } from "./http/rest-client.js";
export type { DooverClientConfig } from "./http/rest-client.js";
export {
  DooverApiError,
  DooverGatewayError,
  DooverValidationError,
} from "./http/errors.js";

export { DooverDataProvider } from "./viewer/doover-data-provider.js";
export { getIdentifierFromPath } from "./viewer/path-parsing.js";

export type * from "./types/common.js";
export type * from "./types/connection.js";
export type * from "./types/openapi.js";
export type * from "./types/viewer.js";
export type * from "./types/audit.js";
export { DV_AUDIT_CHANNEL } from "./types/audit.js";

export {
  addTimestampToMessage,
  extractSnowflakeId,
  generateSnowflakeIdAtTime,
} from "./utils/snowflake.js";
