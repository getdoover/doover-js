import type {
  AgentAggregate,
  AgentMessageCounts,
  BatchAggregatesResponse,
  BatchMessagesResponse,
  DayCount,
  MessageCountsResponse,
  MessageStructure,
} from "../types/openapi.js";
import type {
  AgentConnectionHistory,
  ConnectionEvent,
  ConnectionHistoryResponse,
  ConnectionSegment,
} from "../types/connection.js";
import type {
  Agent,
  AgentsResponse,
  GetAgentsOptions,
} from "../types/viewer.js";
import { addTimestampToMessage, generateSnowflakeIdAtTime } from "../utils/snowflake.js";
import type { RestClient } from "../http/rest-client.js";
import type { DooverRequestOptions } from "../client/request-options.js";

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

/**
 * One token-posture knob across all three layers, so a UI can show
 * "inherited from organisation" vs "overridden on this device" and offer a reset
 * without duplicating the precedence rule client-side.
 */
export interface TokenPolicyField<T> {
  /** What is actually enforced: `agent_override` if set, else `org_default`. */
  effective: T | null;
  /** This device's override. `null` means it inherits. */
  agent_override: T | null;
  /** The organisation-wide default inherited when not overridden. */
  org_default: T | null;
}

export interface AgentTokenState {
  /**
   * Unix-ms revocation floor: every long-lived credential issued before this is
   * rejected. `null` means nothing has ever been revoked for this agent.
   */
  tokens_valid_from: number | null;
  /** Auth kill-switch — while true, every auth attempt is rejected. */
  auth_locked: boolean;
  self_rotation: TokenPolicyField<boolean>;
  max_age_ms: TokenPolicyField<number>;
  reuse_grace_ms: TokenPolicyField<number>;
  /** Whether v1 mini-tokens and OAuth client secrets are refused. */
  require_key_auth: TokenPolicyField<boolean>;
}

/**
 * A token-posture override. `null` on any field means "inherit the organisation
 * default"; there is no way to express "explicitly off, ignoring the default",
 * because every knob here is off when absent.
 */
export interface AgentTokenPolicy {
  /** Allow the device to trade its own credential for a fresh one. */
  self_rotation?: boolean | null;
  /**
   * Hard maximum credential age. Only valid alongside `self_rotation` — without
   * it the device cannot rotate before the deadline and will be locked out.
   */
  max_age_ms?: number | null;
  /**
   * Grace window after a rotation before a stale credential counts as reuse.
   * Setting this opts the device into *automatic* lockout on reuse detection.
   */
  reuse_grace_ms?: number | null;
  /**
   * Refuse v1 mini-tokens and OAuth client secrets, so only key pairs and API
   * keys work for this device.
   */
  require_key_auth?: boolean | null;
}

export interface ResourcePermission {
  permission_id: string;
  permission: string;
}

export interface AdhocTokenResponse {
  /** Shown once. Not retrievable afterwards. */
  token: string;
  token_id: string | null;
}

export type CredentialKind = "api_key" | "device_key" | "enrolment_code";

/**
 * Narrows an API key below its agent's own access; the key can do what both
 * allow. A restricted key never gets control-plane or superuser powers.
 */
export interface KeyRestriction {
  /** Only reading and subscribing. */
  read_only?: boolean;
  /** Only these agents and their channels. Omit for everything. */
  agents?: string[];
  /**
   * A custom policy instead of `read_only` and `agents`: named-action
   * statements, `data:` actions only. Still intersected with the agent's
   * own access.
   */
  policy?: KeyPolicy;
}

export interface KeyPolicy {
  statements: {
    effect: "allow" | "deny";
    actions: string[];
    resources: string[];
    /** Missing request values never widen access. */
    conditions?: {
      source_ip?: { in: string[] } | { not_in: string[] };
      transport?: { in: string[] } | { not_in: string[] };
    };
  }[];
}

/** An agent's API key or device key. Never includes the secret. */
export interface AgentCredential {
  id: string;
  /** The agent it belongs to. */
  agent_id: string;
  kind: CredentialKind;
  name: string;
  /** The agent (user or device) that created it. */
  created_by: string;
  created_ms: number;
  /** Updated at most hourly. */
  last_used_ms?: number | null;
  /** Set once revoked. A revoked credential stays listed. */
  revoked_ms?: number | null;
  restriction?: KeyRestriction | null;
  /** Unix ms after which it stops working. Null: never. */
  expires_ms?: number | null;
  /** For an enrolment code: the device key it enrolled, once used. */
  enrolled_key?: string | null;
}

export interface CreatedCredential extends AgentCredential {
  /** The API key itself (`dv_key_…`). Shown once; absent for a device key. */
  key?: string;
}

export interface DeviceTokenResponse {
  /** Shown once. Not stored anywhere and not retrievable afterwards. */
  token: string;
  /** Unix-ms issuance time, which is what the revocation floor compares against. */
  issued_at_ms: number | null;
}

export interface ConnectionHistoryParams {
  agent_id: string[];
  /** Snowflake id bounds. Defaults to the last 7 days; at most 31 days apart. */
  before?: string;
  after?: string;
  /** Events per page, 1 to 5000; default 1000. */
  limit?: number;
  /** A state held shorter than this is folded into the one before it. Default one minute; 0 for every change. */
  min_gap_ms?: number;
  /**
   * The previous page's `next`: only events older than it are listed. Keep
   * `before` and `after` as they were; the window does not move while
   * paging, and the server wants at least one of them alongside a cursor.
   */
  cursor?: string;
}

export interface MultiAgentMessageCountsParams {
  agent_id: string[];
  /** Snowflake id bounds. Defaults to the last 7 days; at most 92 days apart. */
  before?: string;
  after?: string;
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
  const source: Record<string, unknown> = isPlainObject(rawUser) ? rawUser : {};
  const firstName =
    typeof source.first_name === "string" ? source.first_name.trim() : "";
  const lastName =
    typeof source.last_name === "string" ? source.last_name.trim() : "";
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
  const source: Record<string, unknown> = isPlainObject(rawUser) ? rawUser : {};
  const id =
    typeof source.id === "string" ? source.id : String(source.id ?? "");
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
    if (agentOptions?.includeOrganisations)
      query["include-organisations"] = true;
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
    const stampTimestamps = (
      response: BatchMessagesResponse,
    ): BatchMessagesResponse => ({
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
   * One page of connection state over time for many agents: each agent's
   * state at the window's start and end, and the changes of state inside
   * it, newest first. Page back by repeating the request with the same
   * `before` and `after` and `cursor` set to the response's `next`, until
   * `next` is null. The server refuses a `cursor` with neither bound
   * given, since such a window starts later on every request.
   * One request, so at most 250 agents: a cursor cannot stand for several
   * chunks. `getAllConnectionHistory` reads any number of agents and every
   * page.
   */
  async getMultiAgentConnectionHistory(
    params: ConnectionHistoryParams,
  ): Promise<ConnectionHistoryResponse> {
    if (params.agent_id.length > MULTI_AGENT_CHUNK_SIZE) {
      throw new RangeError(
        `getMultiAgentConnectionHistory reads one page for at most ${MULTI_AGENT_CHUNK_SIZE} agents ` +
          `(got ${params.agent_id.length}); use getAllConnectionHistory for a wider fleet.`,
      );
    }
    return this.rest.get<ConnectionHistoryResponse>("/agents/connection_history", params);
  }

  /**
   * The whole window's connection timeline for many agents: every page of
   * every chunk, merged, newest first, with `next` null. Chunks are read in
   * parallel, pages within a chunk in sequence. `limit` is the page size
   * read with (the server's largest unless given) and `cursor` is ignored:
   * the read always starts at the newest event. Throws rather than return
   * part of a timeline if a chunk runs past 50 pages.
   */
  async getAllConnectionHistory(
    params: ConnectionHistoryParams,
  ): Promise<ConnectionHistoryResponse> {
    const path = "/agents/connection_history";
    const { agent_id, cursor: _ignored, ...rest } = params;
    // A window with neither bound moves with "now", and the server refuses
    // to page one. Fix its end here and the same start follows each time.
    if (rest.before === undefined && rest.after === undefined) {
      rest.before = generateSnowflakeIdAtTime(Date.now());
    }
    const chunks = agent_id.length === 0 ? [[] as string[]] : chunkAgentIds(agent_id);
    const responses = await Promise.all(
      chunks.map(async (chunk) => {
        const pages: ConnectionHistoryResponse[] = [];
        let cursor: string | undefined;
        for (;;) {
          // The largest page the server allows: every page refolds the
          // whole window server-side, so fewer pages is cheaper.
          const page = await this.rest.get<ConnectionHistoryResponse>(path, {
            agent_id: chunk,
            limit: MAX_CONNECTION_HISTORY_PAGE,
            ...rest,
            ...(cursor !== undefined ? { cursor } : {}),
          });
          pages.push(page);
          if (!page.next) break;
          if (pages.length >= MAX_CONNECTION_HISTORY_PAGES) {
            throw new Error(
              `connection history ran past ${MAX_CONNECTION_HISTORY_PAGES} pages for one chunk of agents; ` +
                "narrow the window or raise min_gap_ms.",
            );
          }
          cursor = page.next;
        }
        return mergeConnectionHistory(pages);
      }),
    );
    return mergeConnectionHistory(responses);
  }

  /**
   * Messages stored per UTC day on a channel for many agents, with fleet
   * totals. Cheap enough to ask for a quarter at a time. Auto-chunks
   * `agent_id`; totals are summed across chunks.
   */
  async getMultiAgentMessageCounts(
    channelName: string,
    params: MultiAgentMessageCountsParams,
  ): Promise<MessageCountsResponse> {
    const path = `/agents/channels/${channelName}/messages/counts`;
    const { agent_id, ...rest } = params;
    if (agent_id.length <= MULTI_AGENT_CHUNK_SIZE) {
      return this.rest.get<MessageCountsResponse>(path, params);
    }
    const responses = await Promise.all(
      chunkAgentIds(agent_id).map((chunk) =>
        this.rest.get<MessageCountsResponse>(path, { ...rest, agent_id: chunk }),
      ),
    );
    return mergeMessageCounts(responses);
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
    const responses = await Promise.all(
      chunkAgentIds(agent_id).map((chunk) =>
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

  /**
   * Read an agent's credential state: the revocation floor, the auth
   * kill-switch, and the token posture resolved across the per-agent override
   * and the organisation default.
   *
   * Requires `AgentTokenRead`, which is read-only — a caller can display
   * credential state (including an auth-lock banner, often the only explanation
   * for why a device is offline) without being able to change any of it.
   */
  getTokenState(agentId: string): Promise<AgentTokenState> {
    return this.rest.get<AgentTokenState>(`/agents/${agentId}/token_state`);
  }

  /**
   * Replace an agent's token-posture override. Omitted or null fields mean
   * "inherit the organisation default" — a full replacement rather than a
   * merge, so clearing an override back to inherited is expressible.
   *
   * Rejected server-side if the resolved posture sets `max_age_ms` without
   * `self_rotation`: a device that can't self-rotate has no way to trade its
   * token in before the max age elapses, making that combination a scheduled
   * outage.
   */
  setTokenPolicy(
    agentId: string,
    policy: AgentTokenPolicy,
  ): Promise<{ effective: AgentTokenPolicy }> {
    return this.rest.put<{ effective: AgentTokenPolicy }>(
      `/agents/${agentId}/token_policy`,
      policy,
    );
  }

  /**
   * Set or clear the auth kill-switch. While locked, every auth attempt for the
   * agent is rejected regardless of token validity.
   *
   * doover-data sets this automatically on suspected token reuse, so clearing it
   * is a routine incident-response action rather than an exotic one.
   */
  setAuthLock(agentId: string, locked: boolean): Promise<void> {
    return this.rest.post<void>(`/agents/${agentId}/auth_lock`, { locked });
  }

  /**
   * Revoke every outstanding long-lived credential for an agent by advancing the
   * revocation floor. Mints nothing.
   *
   * This takes the device offline until it is re-provisioned. Break-glass:
   * confirm before calling.
   */
  revokeAllTokens(agentId: string): Promise<{ tokens_valid_from: number }> {
    return this.rest.post<{ tokens_valid_from: number }>(
      `/agents/${agentId}/token/revoke_all`,
      {},
    );
  }

  /**
   * Set the revocation floor to an explicit point, in either direction. `0` or
   * `null` clears it.
   *
   * `revokeAllTokens` is the normal way to revoke. Lowering the floor reverses a
   * revocation, so it is for undoing one made by mistake — not for recovering
   * from a leak, where you should issue fresh credentials instead.
   */
  setRevocationFloor(
    agentId: string,
    tokensValidFrom: number | null,
  ): Promise<{ tokens_valid_from: number | null }> {
    return this.rest.post<{ tokens_valid_from: number | null }>(
      `/agents/${agentId}/token/floor`,
      { tokens_valid_from: tokensValidFrom },
    );
  }

  /**
   * Mint a short-lived scoped JWT for ad-hoc access to an agent — debugging, a
   * one-off script, an integration.
   *
   * This is the way to give a *person* access to a device. The device's own
   * long-lived credential is deliberately not obtainable through the API: it is
   * minted into an installer bundle and never shown. Expiry stands in for
   * revocation here, so keep `timeout` as short as the task allows.
   */
  createAdhocToken(
    agentId: string,
    options: { permissions?: ResourcePermission[]; timeout?: number } = {},
  ): Promise<AdhocTokenResponse> {
    return this.rest.post<AdhocTokenResponse>(`/agents/${agentId}/token`, {
      format: "jwt",
      permissions: options.permissions ?? [],
      timeout: options.timeout,
    });
  }

  /**
   * Mint the device's long-lived credential and return it once, for manual
   * provisioning — pasting into a device's config by hand. The installer download
   * mints one into the bundle for you; this is the equivalent for a device you're
   * configuring yourself.
   *
   * Always additive: the revocation floor is left alone, so minting can never
   * knock a running device offline. `revoke_existing` is intentionally not
   * exposed here — revoking is `revokeAllTokens`, a separate deliberate act.
   *
   * Returned once and stored nowhere. If it's lost, mint another.
   */
  createDeviceToken(agentId: string): Promise<DeviceTokenResponse> {
    return this.rest.post<DeviceTokenResponse>(`/agents/${agentId}/token`, {
      format: "mini_v1",
      revoke_existing: false,
    });
  }

  /**
   * An agent's API keys and device keys, newest first, revoked ones included.
   * Requires `AgentTokenRead`.
   */
  listCredentials(agentId: string): Promise<AgentCredential[]> {
    return this.rest.get<AgentCredential[]>(`/agents/${agentId}/credentials`);
  }

  /**
   * Every credential on an organisation's agents (devices and service
   * accounts) that you may list, each with its `agent_id`, newest first.
   */
  listOrganisationCredentials(
    organisationId: string,
  ): Promise<AgentCredential[]> {
    return this.rest.get<AgentCredential[]>(
      `/organisations/${organisationId}/credentials`,
    );
  }

  /**
   * Mint an API key for an agent. It acts as the agent, with the agent's
   * grants, as `Authorization: Bearer dv_key_…`, and works against doover-data
   * only for now. The key is in the response once and never again.
   *
   * `restriction` narrows it (read-only, chosen agents) and `expiresMs` ends
   * it; both only ever take access away from what the agent has.
   */
  createApiKey(
    agentId: string,
    name: string,
    options: { restriction?: KeyRestriction; expiresMs?: number } = {},
  ): Promise<CreatedCredential> {
    return this.rest.post<CreatedCredential>(`/agents/${agentId}/credentials`, {
      kind: "api_key",
      name,
      restriction: options.restriction,
      expires_ms: options.expiresMs,
    });
  }

  /**
   * Register a device's P-256 public key (PEM or JWK). The device then
   * authenticates to `/oauth2/token` with assertions signed by its private key
   * and gets 24 hour tokens.
   */
  addDeviceKey(
    agentId: string,
    name: string,
    publicKey: string,
  ): Promise<CreatedCredential> {
    return this.rest.post<CreatedCredential>(`/agents/${agentId}/credentials`, {
      kind: "device_key",
      name,
      public_key: publicKey,
    });
  }

  /**
   * Mint an enrolment code for a device: the device redeems it once at
   * `POST /enrol` with its public key, which adds a device public key to it.
   * The code is in the response once. Expires after 4 hours unless
   * `expiresMs` says otherwise (at most 7 days).
   */
  createEnrolmentCode(
    agentId: string,
    name: string,
    expiresMs?: number,
  ): Promise<CreatedCredential> {
    return this.rest.post<CreatedCredential>(`/agents/${agentId}/credentials`, {
      kind: "enrolment_code",
      name,
      expires_ms: expiresMs,
    });
  }

  /**
   * Revoke an API key or device key. Takes effect at once, including for
   * tokens already issued from a device key.
   */
  revokeCredential(agentId: string, credentialId: string): Promise<void> {
    return this.rest.delete<void>(
      `/agents/${agentId}/credentials/${credentialId}`,
    );
  }
}

// CloudFront fronts the channels-rest API with a hard 8,192-byte URL quota.
// Each agent adds ~30 chars (`agent_id=<19-digit snowflake>&`), so 250 IDs
// is ~7.5KB of query string — comfortably under the cap with room for the
// base URL and any `field_name` params.
const MULTI_AGENT_CHUNK_SIZE = 250;
/** The server's largest page of connection events. */
const MAX_CONNECTION_HISTORY_PAGE = 5000;
/** Pages read for one chunk before `getAllConnectionHistory` throws: a quarter of a million events. */
const MAX_CONNECTION_HISTORY_PAGES = 50;

function chunkAgentIds(agentIds: string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < agentIds.length; i += MULTI_AGENT_CHUNK_SIZE) {
    chunks.push(agentIds.slice(i, i + MULTI_AGENT_CHUNK_SIZE));
  }
  return chunks;
}

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Combine connection-history responses into one: the pages of one request,
 * the chunks of a wide one, the members of a multiplexed client, or any
 * mix. Agents are kept from the first response they appear in (every page
 * of one request carries the same ones) and events are concatenated newest
 * first. `next` survives only when there is a single response, since one
 * cursor cannot stand for several.
 */
export function mergeConnectionHistory(
  responses: ConnectionHistoryResponse[],
): ConnectionHistoryResponse {
  const first = responses[0];
  if (!first) return { start: 0, end: 0, agents: [], events: [], count: 0, next: null };
  if (responses.length === 1) return first;
  const seen = new Set<string>();
  const agents: AgentConnectionHistory[] = [];
  for (const r of responses) {
    for (const a of r.agents) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      agents.push(a);
    }
  }
  agents.sort(byId);
  const events = responses
    .flatMap((r) => r.events ?? [])
    .sort((a, b) => b.t - a.t || (a.agent_id < b.agent_id ? -1 : a.agent_id > b.agent_id ? 1 : 0));
  return {
    start: Math.min(...responses.map((r) => r.start)),
    end: Math.max(...responses.map((r) => r.end)),
    agents,
    events,
    count: events.length,
    next: null,
  };
}

/**
 * One agent's timeline as segments across the window, from its carried-in
 * state and its events in `history`. For an uptime strip of one device; for
 * every device at once, `segmentsByAgent` reads the events only once.
 * Needs the whole timeline (`getAllConnectionHistory`, or the hook): throws
 * on a page with `next` set, whose older events are not there to build on.
 */
export function segmentsFor(history: ConnectionHistoryResponse, agentId: string): ConnectionSegment[] {
  assertWholeTimeline(history);
  const agent = history.agents.find((a) => a.id === agentId);
  if (!agent) return [];
  return buildSegments(
    history,
    agent,
    (history.events ?? []).filter((e) => e.agent_id === agentId),
  );
}

/**
 * Every agent's timeline as segments across the window, keyed by agent id,
 * in one pass over the events. Same rule as `segmentsFor`: the whole
 * timeline, not one page of it.
 */
export function segmentsByAgent(history: ConnectionHistoryResponse): Record<string, ConnectionSegment[]> {
  assertWholeTimeline(history);
  const eventsByAgent = new Map<string, ConnectionEvent[]>();
  for (const e of history.events ?? []) {
    const list = eventsByAgent.get(e.agent_id);
    if (list) list.push(e);
    else eventsByAgent.set(e.agent_id, [e]);
  }
  const out: Record<string, ConnectionSegment[]> = {};
  for (const agent of history.agents) {
    out[agent.id] = buildSegments(history, agent, eventsByAgent.get(agent.id) ?? []);
  }
  return out;
}

function assertWholeTimeline(history: ConnectionHistoryResponse): void {
  if (history.next) {
    throw new Error(
      "segments need the whole timeline, and this is one page of it (`next` is set); " +
        "read it with getAllConnectionHistory.",
    );
  }
}

function buildSegments(
  history: ConnectionHistoryResponse,
  agent: AgentConnectionHistory,
  events: ConnectionEvent[],
): ConnectionSegment[] {
  if (history.end <= history.start) return [];
  const changes = [...events].sort((a, b) => a.t - b.t);
  const segments: ConnectionSegment[] = [];
  let start = history.start;
  let state = agent.state_at_start;
  for (const e of changes) {
    if (e.t > start) segments.push({ start, end: e.t, state });
    start = Math.max(start, e.t);
    state = e.state;
  }
  if (history.end > start) segments.push({ start, end: history.end, state });
  return segments;
}

/**
 * Combine several message-count responses for the same window into one:
 * agents concatenated and totals summed by day.
 */
export function mergeMessageCounts(responses: MessageCountsResponse[]): MessageCountsResponse {
  const first = responses[0];
  if (!first) return { start: 0, end: 0, agents: [], totals: [] };
  const agents: AgentMessageCounts[] = responses.flatMap((r) => r.agents).sort(byId);
  const byDay = new Map<number, number>();
  for (const r of responses) {
    for (const day of r.totals) byDay.set(day.start, (byDay.get(day.start) ?? 0) + day.count);
  }
  const totals: DayCount[] = [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, count]) => ({ start, count }));
  return { start: first.start, end: first.end, agents, totals };
}
