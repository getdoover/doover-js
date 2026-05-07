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

  async listAgents(options?: GetAgentsOptions): Promise<AgentsResponse> {
    const query: Record<string, boolean> = {};
    if (options?.includeArchived) query["include-archived"] = true;
    if (options?.includeOrganisations) query["include-organisations"] = true;
    if (options?.includeUsers) query["include-users"] = true;

    const raw = await this.rest.request<AgentsResponse>({
      path: "/agents/",
      baseUrl: this.controlApiUrl,
      omitSharingHeader: true,
      query: Object.keys(query).length > 0 ? query : undefined,
    });

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
