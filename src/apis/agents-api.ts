import type {
  AgentAggregate,
  BatchAggregatesResponse,
  BatchMessagesResponse,
  MessageStructure,
} from "../types/openapi";
import type { Agent, AgentsResponse, GetAgentsOptions } from "../types/viewer";
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAgentEntry(rawAgent: unknown): Agent {
  const obj = isPlainObject(rawAgent) ? rawAgent : {};
  const id = String(obj.id ?? obj.name ?? "");
  return {
    id,
    name: String(obj.name ?? id),
    display_name: String(obj.display_name ?? obj.name ?? id),
    type: (obj.type as Agent["type"]) ?? "device",
    organisation: String(obj.organisation ?? "Organisation"),
    group: String(obj.group ?? "group"),
    fa_icon: String(obj.fa_icon ?? "fa-solid fa-robot"),
    archived: Boolean(obj.archived),
    fixed_location:
      isPlainObject(obj.fixed_location) &&
      typeof obj.fixed_location.latitude === "number" &&
      typeof obj.fixed_location.longitude === "number"
        ? {
            latitude: obj.fixed_location.latitude,
            longitude: obj.fixed_location.longitude,
          }
        : { latitude: 0, longitude: 0 },
    extra_config: isPlainObject(obj.extra_config) ? obj.extra_config : {},
    ...(typeof obj.connection_determination === "string"
      ? {
          connection_determination:
            obj.connection_determination as Agent["connection_determination"],
        }
      : {}),
  };
}

function normalizeOrganisationEntry(rawOrg: unknown): Agent {
  const obj = isPlainObject(rawOrg) ? rawOrg : {};
  const id = String(obj.id ?? obj.name ?? "");
  return {
    id,
    name: String(obj.name ?? id),
    display_name: String(obj.display_name ?? obj.name ?? id),
    type: "organisation",
    organisation: String(obj.organisation ?? id),
    group: String(obj.group ?? "organisation"),
    fa_icon: String(obj.fa_icon ?? "fa-solid fa-building"),
    archived: Boolean(obj.archived),
    fixed_location: { latitude: 0, longitude: 0 },
    extra_config: isPlainObject(obj.extra_config) ? obj.extra_config : {},
  };
}

function normalizeUserEntry(rawUser: unknown): Agent {
  const obj = isPlainObject(rawUser) ? rawUser : {};
  const id = String(obj.id ?? obj.email ?? obj.name ?? "");
  return {
    id,
    name: String(obj.name ?? obj.email ?? id),
    display_name: String(obj.display_name ?? obj.name ?? obj.email ?? id),
    type: "user",
    organisation: String(obj.organisation ?? "Users"),
    group: String(obj.group ?? "user"),
    fa_icon: String(obj.fa_icon ?? "fa-solid fa-user"),
    archived: Boolean(obj.archived),
    fixed_location: { latitude: 0, longitude: 0 },
    extra_config: isPlainObject(obj.extra_config) ? obj.extra_config : {},
  };
}

export class AgentsApi {
  constructor(
    private readonly rest: RestClient,
    private readonly controlApiUrl?: string,
  ) {}

  async listAgents(options?: GetAgentsOptions): Promise<AgentsResponse> {
    const query: Record<string, boolean> = {};
    if (options?.includeArchived) query["include-archived"] = true;
    if (options?.includeOrganisations) query["include-organisations"] = true;
    if (options?.includeUsers) query["include-users"] = true;

    const raw = (await this.rest.request<AgentsResponse>({
      path: "/agents/",
      baseUrl: this.controlApiUrl,
      omitSharingHeader: true,
      query: Object.keys(query).length > 0 ? query : undefined,
    })) ?? ({} as AgentsResponse);

    const rawAgents = Array.isArray(raw.agents) ? raw.agents : [];
    const normalizedAgents = rawAgents.map(normalizeAgentEntry);

    if (!options?.mergeIncludedAsAgents) {
      return { ...raw, agents: normalizedAgents };
    }

    const merged: Agent[] = [...normalizedAgents];
    if (options.includeOrganisations) {
      const rawOrgs = Array.isArray(raw.organisations)
        ? (raw.organisations as unknown[])
        : [];
      for (const org of rawOrgs) merged.push(normalizeOrganisationEntry(org));
    }
    if (options.includeUsers) {
      const rawUsers = Array.isArray(raw.users) ? (raw.users as unknown[]) : [];
      for (const user of rawUsers) merged.push(normalizeUserEntry(user));
    }
    return { ...raw, agents: merged, results: merged, count: merged.length };
  }

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
