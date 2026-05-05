export { DooverProvider, useDooverClient } from "./context";
export type { DooverProviderProps } from "./context";

export { useConnectionState } from "./useConnectionState";
export type { ConnectionState, ConnectionStatus } from "./useConnectionState";

export {
  useAgentConnections,
  agentConnectionsQueryKey,
} from "./useAgentConnections";

export {
  useChannelSubscription,
} from "./useChannelSubscription";
export type { ChannelSubscriptionHandlers } from "./useChannelSubscription";

export {
  useChannelAggregate,
  channelAggregateQueryKey,
} from "./useChannelAggregate";
export type {
  UseChannelAggregateOptions,
  UseChannelAggregateResult,
} from "./useChannelAggregate";
export { useAgentChannel } from "./useAgentChannel";

export { useSendMessage } from "./useSendMessage";
export { useUpdateAggregate } from "./useUpdateAggregate";
export type { UseUpdateAggregateOptions } from "./useUpdateAggregate";
export { useUpdateMessage } from "./useUpdateMessage";
export type {
  UpdateMessageVariables,
  UseUpdateMessageOptions,
} from "./useUpdateMessage";

export {
  useChannelMessages,
  channelMessagesQueryKey,
} from "./useChannelMessages";
export type {
  UseChannelMessagesOptions,
  UseChannelMessagesResult,
} from "./useChannelMessages";

export {
  useChannelMessage,
  channelMessageQueryKey,
} from "./useChannelMessage";
export type {
  UseChannelMessageOptions,
  UseChannelMessageResult,
} from "./useChannelMessage";

export {
  useInvocationLogs,
  invocationLogsQueryKey,
} from "./useInvocationLogs";
export type { UseInvocationLogsOptions } from "./useInvocationLogs";

export { useSendRpc } from "./useSendRpc";
export type {
  RpcCommandId,
  RpcStatusEvent,
  SendRpcVariables,
  UseSendRpcOptions,
  UseSendRpcResult,
} from "./useSendRpc";

export {
  useMultiAgentAggregates,
  multiAgentAggregatesQueryKey,
} from "./useMultiAgentAggregates";
export type {
  UseMultiAgentAggregatesOptions,
  UseMultiAgentAggregatesResult,
} from "./useMultiAgentAggregates";

export {
  useMultiAgentChannelMessages,
  multiAgentChannelMessagesQueryKey,
} from "./useMultiAgentChannelMessages";
export type {
  UseMultiAgentChannelMessagesOptions,
  UseMultiAgentChannelMessagesResult,
} from "./useMultiAgentChannelMessages";

export { useTurnCredentials } from "./useTurnCredentials";

export {
  getSharedQueryClient,
  resetSharedQueryClient,
} from "./sharedQueryClient";
