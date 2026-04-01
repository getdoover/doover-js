import type { RestClient } from "../http/rest-client";
import type {
  ConnectionDetails,
  ConnectionSubscription,
  ConnectionSubscriptionLog,
} from "../types/openapi";

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

  getAgentConnections(agentId: string) {
    return this.rest.get<ConnectionDetails[]>(`/agents/${agentId}/wss_connections`);
  }

  getAgentConnectionHistory(agentId: string, params: ConnectionHistoryParams) {
    return this.rest.get<ConnectionDetails[]>(
      `/agents/${agentId}/wss_connections/history`,
      params,
    );
  }

  getAgentSubscriptionHistory(agentId: string, params: SubscriptionHistoryParams) {
    return this.rest.get<ConnectionSubscriptionLog[]>(
      `/agents/${agentId}/wss_connections/subscriptions/history`,
      params,
    );
  }

  getConnection(connectionId: string) {
    return this.rest.get<ConnectionDetails>(`/connections/${connectionId}`);
  }

  getChannelSubscriptions(agentId: string, channelName: string) {
    return this.rest.get<ConnectionSubscription[]>(
      `/agents/${agentId}/channels/${channelName}/subscriptions`,
    );
  }
}
