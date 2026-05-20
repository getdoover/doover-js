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
  /**
   * Per-agent `before` cursors, parallel to `agent_id`. When set, must
   * be the same length as `agent_id`; each agent then uses its own
   * cursor as the upper bound instead of the global `before`. This is
   * how paginating clients should resume from a previous response's
   * `next_cursors` map — each agent paginates independently with no
   * inter-agent "watermark retain".
   */
  agent_before?: string[];
  before?: string;
  after?: string;
  limit?: number;
  agent_message_limit?: number;
  field_name?: string[];
}

export interface MultiAgentAggregatesParams {
  agent_id: string[];
  /**
   * Project the response to only the named top-level keys of each aggregate's
   * `data`. Useful for large aggregates (e.g. `tag_values`) when the caller
   * only needs a subset of the tag tree.
   */
  field_name?: string[];
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

  /**
   * Batch-fetch aggregates for many agents. Auto-chunks `agent_id` so each
   * request's URL stays under CloudFront's hard 8,192-byte URL quota — each
   * agent contributes ~30 chars (`agent_id=<snowflake>&`), so the chunk size
   * below caps the query string at ~7.5KB even before the base URL. Chunks
   * are fetched in parallel and merged into one `{ results, count }` so
   * callers never have to think about the limit.
   */
  async getMultiAgentAggregates(
    channelName: string,
    params: MultiAgentAggregatesParams,
  ): Promise<{ results: AgentAggregate[]; count: number }> {
    const path = `/agents/channels/${channelName}/aggregates`;
    const { agent_id, ...rest } = params;
    if (agent_id.length <= MULTI_AGENT_CHUNK_SIZE) {
      return this.rest.get<BatchAggregatesResponse>(path, params);
    }
    const chunks: string[][] = [];
    for (let i = 0; i < agent_id.length; i += MULTI_AGENT_CHUNK_SIZE) {
      chunks.push(agent_id.slice(i, i + MULTI_AGENT_CHUNK_SIZE));
    }
    const responses = await Promise.all(
      chunks.map((chunk) =>
        this.rest.get<BatchAggregatesResponse>(path, {
          ...rest,
          agent_id: chunk,
        }),
      ),
    );
    return {
      results: responses.flatMap((r) => r.results),
      count: responses.reduce((acc, r) => acc + r.count, 0),
    };
  }
}

// CloudFront fronts the channels-rest API with a hard 8,192-byte URL quota.
// Each agent adds ~30 chars (`agent_id=<19-digit snowflake>&`), so 250 IDs
// is ~7.5KB of query string — comfortably under the cap with room for the
// base URL and any `field_name` params.
const MULTI_AGENT_CHUNK_SIZE = 250;
