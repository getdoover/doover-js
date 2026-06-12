import type {
  AgentAggregate,
  BatchAggregatesResponse,
  BatchMessagesResponse,
  MessageStructure,
} from "../types/openapi";
import type { Agent, AgentsResponse, GetAgentsOptions } from "../types/viewer";
import { addTimestampToMessage } from "../utils/snowflake";
import type { RestClient } from "../http/rest-client";
import type { DooverRequestOptions } from "../client/request-options";

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildUserDisplayName(rawUser: unknown): string {
  const source: Record<string, unknown> = isPlainObject(rawUser)
    ? rawUser
    : {};
  const firstName = typeof source.first_name === "string" ? source.first_name.trim() : "";
  const lastName = typeof source.last_name === "string" ? source.last_name.trim() : "";
  const fullName = `${firstName} ${lastName}`.trim();
  if (fullName !== "") {
    return fullName;
  }
  if (typeof source.username === "string" && source.username !== "") {
    return source.username;
  }
  if (typeof source.email === "string" && source.email !== "") {
    return source.email;
  }
  if (typeof source.id === "string" && source.id !== "") {
    return source.id;
  }
  return String(source.id ?? "");
}

function coerceExtraConfig(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? (value as Record<string, unknown>) : {};
}

function normalizeAgentEntry(rawAgent: unknown): Agent {
  const source: Record<string, unknown> = isPlainObject(rawAgent)
    ? rawAgent
    : {};
  const fixedLocation = source.fixed_location;
  const normalizedFixedLocation =
    isPlainObject(fixedLocation) &&
    typeof fixedLocation.latitude === "number" &&
    typeof fixedLocation.longitude === "number"
      ? {
          latitude: fixedLocation.latitude,
          longitude: fixedLocation.longitude,
        }
      : { latitude: 0, longitude: 0 };

  const faIcon =
    typeof source.fa_icon === "string" && source.fa_icon.length > 0
      ? source.fa_icon
      : "fa-solid fa-robot";

  return {
    ...(source as Record<string, unknown>),
    id: typeof source.id === "string" ? source.id : String(source.id ?? ""),
    organisation:
      typeof source.organisation === "string" ? source.organisation : "",
    name: typeof source.name === "string" ? source.name : "",
    display_name:
      typeof source.display_name === "string" ? source.display_name : "",
    archived: typeof source.archived === "boolean" ? source.archived : false,
    group: typeof source.group === "string" ? source.group : "",
    fa_icon: faIcon,
    type:
      source.type === "device" ||
      source.type === "dashboard" ||
      source.type === "organisation" ||
      source.type === "user"
        ? source.type
        : "device",
    fixed_location: normalizedFixedLocation,
    extra_config: coerceExtraConfig(source.extra_config),
  } as Agent;
}

function normalizeOrganisationEntry(rawOrganisation: unknown): Agent {
  const source: Record<string, unknown> = isPlainObject(rawOrganisation)
    ? rawOrganisation
    : {};
  const name = typeof source.name === "string" ? source.name : "";
  const rootGroup = isPlainObject(source.root_group) ? source.root_group : null;
  const groupName =
    rootGroup && typeof rootGroup.name === "string" ? rootGroup.name : "";

  return {
    id: typeof source.id === "string" ? source.id : String(source.id ?? ""),
    organisation: name,
    name,
    display_name: name,
    archived: typeof source.archived === "boolean" ? source.archived : false,
    group: groupName,
    fa_icon: "fa-solid fa-building",
    type: "organisation",
    fixed_location: { latitude: 0, longitude: 0 },
    extra_config: coerceExtraConfig(source.extra_config),
  };
}

function normalizeUserEntry(rawUser: unknown): Agent {
  const source: Record<string, unknown> = isPlainObject(rawUser)
    ? rawUser
    : {};
  const id = typeof source.id === "string" ? source.id : String(source.id ?? "");
  const username = typeof source.username === "string" ? source.username : "";
  const email = typeof source.email === "string" ? source.email : "";

  const name = username !== "" ? username : email !== "" ? email : id;

  return {
    id,
    organisation: "",
    name,
    display_name: buildUserDisplayName(source),
    archived: false,
    group: "",
    fa_icon: "fa-solid fa-user",
    type: "user",
    fixed_location: { latitude: 0, longitude: 0 },
    extra_config: coerceExtraConfig(source.custom_data),
  };
}

export class AgentsApi {
  constructor(
    private readonly rest: RestClient,
    private readonly controlApiUrl?: string,
  ) {}

  listAgents(options?: GetAgentsOptions): Promise<AgentsResponse>;
  listAgents(requestOptions?: DooverRequestOptions): Promise<AgentsResponse>;
  listAgents(
    options?: GetAgentsOptions,
    requestOptions?: DooverRequestOptions,
  ): Promise<AgentsResponse>;
  async listAgents(
    options?: GetAgentsOptions | DooverRequestOptions,
    _requestOptions?: DooverRequestOptions,
  ): Promise<AgentsResponse> {
    const agentOptions = options as GetAgentsOptions | undefined;
    const query: Record<string, boolean> = {};
    if (agentOptions?.includeArchived) query["include-archived"] = true;
    if (agentOptions?.includeOrganisations) query["include-organisations"] = true;
    if (agentOptions?.includeUsers) query["include-users"] = true;

    const raw = await this.rest.request<AgentsResponse>({
      path: "/agents/",
      baseUrl: this.controlApiUrl,
      omitSharingHeader: true,
      query: Object.keys(query).length > 0 ? query : undefined,
    });

    const rawAgents = Array.isArray(raw.agents) ? raw.agents : [];
    const normalizedAgents = rawAgents.map(normalizeAgentEntry);

    if (!agentOptions?.mergeIncludedAsAgents) {
      return { ...raw, agents: normalizedAgents };
    }

    const merged: Agent[] = [...normalizedAgents];
    if (agentOptions.includeOrganisations) {
      const rawOrgs = Array.isArray(raw.organisations)
        ? (raw.organisations as unknown[])
        : [];
      for (const org of rawOrgs) merged.push(normalizeOrganisationEntry(org));
    }
    if (agentOptions.includeUsers) {
      const rawUsers = Array.isArray(raw.users) ? (raw.users as unknown[]) : [];
      for (const user of rawUsers) merged.push(normalizeUserEntry(user));
    }
    return { ...raw, agents: merged, results: merged, count: merged.length };
  }

  /**
   * Batch-fetch recent messages for many agents. Auto-chunks `agent_id`
   * (and the parallel `agent_before` cursors, if given) at MULTI_AGENT_CHUNK_SIZE
   * so each request's URL stays under CloudFront's 8,192-byte quota. Chunks
   * are fetched in parallel and merged: `results`/`count` concat-and-sum,
   * `next_cursors`/`at_limit_agent_ids` union, legacy `next` becomes the
   * lexically-highest cursor across at-limit agents.
   */
  async getMultiAgentMessages(
    channelName: string,
    params: MultiAgentMessagesParams,
  ): Promise<BatchMessagesResponse> {
    const path = `/agents/channels/${channelName}/messages`;
    const { agent_id, agent_before, ...rest } = params;
    const stampTimestamps = (response: BatchMessagesResponse): BatchMessagesResponse => ({
      ...response,
      results: response.results.map((message) =>
        "timestamp" in message ? message : addTimestampToMessage(message),
      ) as MessageStructure[],
    });
    if (agent_id.length <= MULTI_AGENT_CHUNK_SIZE) {
      const response = await this.rest.get<BatchMessagesResponse>(path, params);
      return stampTimestamps(response);
    }
    if (agent_before && agent_before.length !== agent_id.length) {
      throw new Error(
        "agent_before must be the same length as agent_id when set",
      );
    }
    const chunks: { agent_id: string[]; agent_before?: string[] }[] = [];
    for (let i = 0; i < agent_id.length; i += MULTI_AGENT_CHUNK_SIZE) {
      chunks.push({
        agent_id: agent_id.slice(i, i + MULTI_AGENT_CHUNK_SIZE),
        ...(agent_before
          ? { agent_before: agent_before.slice(i, i + MULTI_AGENT_CHUNK_SIZE) }
          : {}),
      });
    }
    const responses = await Promise.all(
      chunks.map((chunk) =>
        this.rest
          .get<BatchMessagesResponse>(path, { ...rest, ...chunk })
          .then(stampTimestamps),
      ),
    );
    // Merge: results/count concat-and-sum; next_cursors merge; at_limit_agent_ids
    // concat (both keyed by agent id, unique across chunks). Legacy `next` is the
    // lexically-highest oldest-cursor across at-limit agents — snowflakes sort
    // lexically since they're equal-width digit strings.
    const merged: BatchMessagesResponse = {
      results: responses.flatMap((r) => r.results),
      count: responses.reduce((acc, r) => acc + r.count, 0),
    };
    const nexts = responses
      .map((r) => r.next)
      .filter((n): n is string => typeof n === "string" && n.length > 0);
    if (nexts.length > 0) {
      merged.next = nexts.reduce((a, b) => (a > b ? a : b));
    }
    const cursors: Record<string, string> = {};
    for (const r of responses) {
      if (r.next_cursors) Object.assign(cursors, r.next_cursors);
    }
    if (Object.keys(cursors).length > 0) merged.next_cursors = cursors;
    const atLimit = responses.flatMap((r) => r.at_limit_agent_ids ?? []);
    if (atLimit.length > 0) merged.at_limit_agent_ids = atLimit;
    return merged;
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
