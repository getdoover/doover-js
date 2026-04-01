export { DooverClient } from "./client/doover-client";

export { AgentsApi } from "./apis/agents-api";
export { AggregatesApi } from "./apis/aggregates-api";
export { AlarmsApi } from "./apis/alarms-api";
export { ChannelsApi } from "./apis/channels-api";
export { ConnectionsApi } from "./apis/connections-api";
export { MessagesApi } from "./apis/messages-api";
export { NotificationsApi } from "./apis/notifications-api";
export { PermissionsApi } from "./apis/permissions-api";
export { ProcessorsApi } from "./apis/processors-api";
export { TurnApi } from "./apis/turn-api";

export { GatewayClient } from "./gateway/gateway-client";
export type * from "./gateway/types";

export { RestClient } from "./http/rest-client";
export type { DooverClientConfig } from "./http/rest-client";
export {
  DooverApiError,
  DooverGatewayError,
  DooverValidationError,
} from "./http/errors";

export { DooverDataProvider } from "./viewer/doover-data-provider";
export { getIdentifierFromPath } from "./viewer/path-parsing";

export type * from "./types/common";
export type * from "./types/openapi";
export type * from "./types/viewer";

export {
  addTimestampToMessage,
  extractSnowflakeId,
  generateSnowflakeIdAtTime,
} from "./utils/snowflake";
