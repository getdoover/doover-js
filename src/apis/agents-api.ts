import type {
  AgentAggregate,
  BatchAggregatesResponse,
  BatchMessagesResponse,
  MessageStructure,
} from "../types/openapi";
import { addTimestampToMessage } from "../utils/snowflake";
import type { RestClient } from "../http/rest-client";

export interface MultiAgentMessagesParams {
  agent_id: string[];
  before?: string;
  after?: string;
  limit?: number;
  agent_message_limit?: number;
  field_name?: string[];
}

export interface MultiAgentAggregatesParams {
  agent_id: string[];
}

export class AgentsApi {
  constructor(private readonly rest: RestClient) {}

  async getMultiAgentMessages(
    channelName: string,
    params: MultiAgentMessagesParams,
  ): Promise<BatchMessagesResponse> {
    const response = await this.rest.get<BatchMessagesResponse>(
      `/agents/channels/${channelName}/messages`,
      params,
    );
    return {
      ...response,
      results: response.results.map((message) =>
        "timestamp" in message ? message : addTimestampToMessage(message),
      ) as MessageStructure[],
    };
  }

  getMultiAgentAggregates(
    channelName: string,
    params: MultiAgentAggregatesParams,
  ): Promise<{ results: AgentAggregate[]; count: number }> {
    return this.rest.get<BatchAggregatesResponse>(
      `/agents/channels/${channelName}/aggregates`,
      params,
    );
  }
}
