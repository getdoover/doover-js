import type { RestClient } from "../http/rest-client";
import type {
  ConnectionDetails,
  ConnectionSubscription,
  ConnectionSubscriptionLog,
} from "../types/openapi";
import { resolveAgentArgs, resolveChannelArgs } from "./_args";

export interface ConnectionHistoryParams {
  before?: string;
  after?: string;
  limit?: number;
  default_connection?: boolean;
}

export interface SubscriptionHistoryParams {
  before?: string;
  after?: string;
  limit?: number;
  channel: string;
}

export class ConnectionsApi {
  constructor(private readonly rest: RestClient) {}

  getAgentConnections(agentId: string): Promise<ConnectionDetails[]>;
  getAgentConnections(identifier: { agentId: string }): Promise<ConnectionDetails[]>;
  getAgentConnections(...args: unknown[]): Promise<ConnectionDetails[]> {
    const { agentId } = resolveAgentArgs<undefined>(args);
    return this._getAgentConnections(agentId);
  }
  private _getAgentConnections(agentId: string) {
    return this.rest.get<ConnectionDetails[]>(`/agents/${agentId}/wss_connections`);
  }

  getAgentConnectionHistory(
    agentId: string,
    params: ConnectionHistoryParams,
  ): Promise<ConnectionDetails[]>;
  getAgentConnectionHistory(
    identifier: { agentId: string },
    params: ConnectionHistoryParams,
  ): Promise<ConnectionDetails[]>;
  getAgentConnectionHistory(...args: unknown[]): Promise<ConnectionDetails[]> {
    const { agentId, options } = resolveAgentArgs<ConnectionHistoryParams>(args);
    return this._getAgentConnectionHistory(agentId, options as ConnectionHistoryParams);
  }
  private _getAgentConnectionHistory(agentId: string, params: ConnectionHistoryParams) {
    return this.rest.get<ConnectionDetails[]>(
      `/agents/${agentId}/wss_connections/history`,
      params,
    );
  }

  getAgentSubscriptionHistory(
    agentId: string,
    params: SubscriptionHistoryParams,
  ): Promise<ConnectionSubscriptionLog[]>;
  getAgentSubscriptionHistory(
    identifier: { agentId: string },
    params: SubscriptionHistoryParams,
  ): Promise<ConnectionSubscriptionLog[]>;
  getAgentSubscriptionHistory(...args: unknown[]): Promise<ConnectionSubscriptionLog[]> {
    const { agentId, options } = resolveAgentArgs<SubscriptionHistoryParams>(args);
    return this._getAgentSubscriptionHistory(agentId, options as SubscriptionHistoryParams);
  }
  private _getAgentSubscriptionHistory(agentId: string, params: SubscriptionHistoryParams) {
    return this.rest.get<ConnectionSubscriptionLog[]>(
      `/agents/${agentId}/wss_connections/subscriptions/history`,
      params,
    );
  }

  getConnection(connectionId: string) {
    return this.rest.get<ConnectionDetails>(`/connections/${connectionId}`);
  }

  getChannelSubscriptions(
    agentId: string,
    channelName: string,
  ): Promise<ConnectionSubscription[]>;
  getChannelSubscriptions(
    identifier: { agentId: string; channelName: string },
  ): Promise<ConnectionSubscription[]>;
  getChannelSubscriptions(...args: unknown[]): Promise<ConnectionSubscription[]> {
    const { agentId, channelName } = resolveChannelArgs<undefined>(args);
    return this._getChannelSubscriptions(agentId, channelName);
  }
  private _getChannelSubscriptions(agentId: string, channelName: string) {
    return this.rest.get<ConnectionSubscription[]>(
      `/agents/${agentId}/channels/${channelName}/subscriptions`,
    );
  }

  syncConnection(agentId: string): Promise<unknown>;
  syncConnection(identifier: { agentId: string }): Promise<unknown>;
  syncConnection(...args: unknown[]): Promise<unknown> {
    const { agentId } = resolveAgentArgs<undefined>(args);
    return this._syncConnection(agentId);
  }
  private _syncConnection(agentId: string) {
    return this.rest.post<unknown>(`/agents/${agentId}/connection_sync`, {});
  }
}
