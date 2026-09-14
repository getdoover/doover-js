export { DooverProvider, useDooverClient } from "./context.js";
export type { DooverProviderProps } from "./context.js";

export type { DataClientStatus, DataClientConnectionState, AgentScope } from "../client/data-client.js";

export { useClientStatus } from "./useClientStatus.js";
export { useOfflineStatus, hasOfflineStatus } from "./useOfflineStatus.js";
export type { OfflineStatusSnapshot, OfflineStatusClient } from "./useOfflineStatus.js";

export { useConnectionState } from "./useConnectionState.js";
export type { ConnectionState, ConnectionStatus } from "./useConnectionState.js";

export {
  useAgentConnections,
  agentConnectionsQueryKey,
} from "./useAgentConnections.js";

export {
  useChannelSubscription,
} from "./useChannelSubscription.js";
export type { ChannelSubscriptionHandlers } from "./useChannelSubscription.js";

export {
  useChannelAggregate,
  channelAggregateQueryKey,
} from "./useChannelAggregate.js";
export type {
  UseChannelAggregateOptions,
  UseChannelAggregateResult,
} from "./useChannelAggregate.js";
export { useAgentChannel } from "./useAgentChannel.js";

export { useSendMessage } from "./useSendMessage.js";
export type { UseSendMessageOptions } from "./useSendMessage.js";
export { useUpdateAggregate } from "./useUpdateAggregate.js";
export type { UseUpdateAggregateOptions } from "./useUpdateAggregate.js";
export { useUpdateMessage } from "./useUpdateMessage.js";
export type {
  UpdateMessageVariables,
  UseUpdateMessageOptions,
} from "./useUpdateMessage.js";

export {
  useChannelMessages,
  channelMessagesQueryKey,
} from "./useChannelMessages.js";
export type {
  UseChannelMessagesOptions,
  UseChannelMessagesResult,
} from "./useChannelMessages.js";

export {
  useChannelMessage,
  channelMessageQueryKey,
} from "./useChannelMessage.js";
export type {
  UseChannelMessageOptions,
  UseChannelMessageResult,
} from "./useChannelMessage.js";

export {
  useInvocationLogs,
  invocationLogsQueryKey,
} from "./useInvocationLogs.js";
export type { UseInvocationLogsOptions } from "./useInvocationLogs.js";

export { useSendRpc } from "./useSendRpc.js";
export type {
  RpcCommandId,
  RpcStatusEvent,
  SendRpcVariables,
  UseSendRpcOptions,
  UseSendRpcResult,
} from "./useSendRpc.js";

export {
  useMultiAgentAggregates,
  multiAgentAggregatesQueryKey,
} from "./useMultiAgentAggregates.js";
export type {
  UseMultiAgentAggregatesOptions,
  UseMultiAgentAggregatesResult,
} from "./useMultiAgentAggregates.js";

export {
  useMultiAgentChannelMessages,
  multiAgentChannelMessagesQueryKey,
} from "./useMultiAgentChannelMessages.js";
export type {
  UseMultiAgentChannelMessagesOptions,
  UseMultiAgentChannelMessagesResult,
} from "./useMultiAgentChannelMessages.js";

export { useDeviceMap } from "./useDeviceMap.js";
export type {
  DeviceMapEntry,
  UseDeviceMapOptions,
  UseDeviceMapResult,
} from "./useDeviceMap.js";

export { useTurnCredentials } from "./useTurnCredentials.js";

export {
  useAgentTokenState,
  useSetAgentTokenPolicy,
  useSetAgentAuthLock,
  useRevokeAgentTokens,
  useSetRevocationFloor,
  useCreateAdhocToken,
  useCreateDeviceToken,
  agentTokenStateQueryKey,
} from "./useAgentTokenState.js";
export type { UseAgentTokenStateOptions } from "./useAgentTokenState.js";

export {
  getSharedQueryClient,
  resetSharedQueryClient,
} from "./sharedQueryClient.js";

export { useServiceReachability } from "./useServiceReachability.js";
