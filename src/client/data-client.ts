import type { AgentsApi } from "../apis/agents-api";
import type { AggregatesApi } from "../apis/aggregates-api";
import type { AlarmsApi } from "../apis/alarms-api";
import type { ChannelsApi } from "../apis/channels-api";
import type { ConnectionsApi } from "../apis/connections-api";
import type { MessagesApi } from "../apis/messages-api";
import type { NotificationsApi } from "../apis/notifications-api";
import type { PermissionsApi } from "../apis/permissions-api";
import type { ProcessorsApi } from "../apis/processors-api";
import type { TurnApi } from "../apis/turn-api";
import type { UsersApi } from "../apis/users-api";
import type { GatewayClient } from "../gateway/gateway-client";
import type { RpcDispatcher } from "../rpc/rpc-dispatcher";
import type { Capability } from "./capabilities";

/**
 * Public structural shape of each concrete subclient — `Pick<Class, keyof Class>`
 * yields just the public members as a plain object type (no nominal/private-member
 * coupling), so a non-`DooverClient` implementation can satisfy it structurally.
 */
export type AgentsApiLike = Pick<AgentsApi, keyof AgentsApi>;
export type AggregatesApiLike = Pick<AggregatesApi, keyof AggregatesApi>;
export type AlarmsApiLike = Pick<AlarmsApi, keyof AlarmsApi>;
export type ChannelsApiLike = Pick<ChannelsApi, keyof ChannelsApi>;
export type ConnectionsApiLike = Pick<ConnectionsApi, keyof ConnectionsApi>;
export type MessagesApiLike = Pick<MessagesApi, keyof MessagesApi>;
export type NotificationsApiLike = Pick<NotificationsApi, keyof NotificationsApi>;
export type PermissionsApiLike = Pick<PermissionsApi, keyof PermissionsApi>;
export type ProcessorsApiLike = Pick<ProcessorsApi, keyof ProcessorsApi>;
export type TurnApiLike = Pick<TurnApi, keyof TurnApi>;
export type UsersApiLike = Pick<UsersApi, keyof UsersApi>;
export type GatewayClientLike = Pick<GatewayClient, keyof GatewayClient>;
export type RpcDispatcherLike = Pick<RpcDispatcher, keyof RpcDispatcher>;

/** Which agents a `DataClient` can serve. */
export type AgentScope =
  /** Serves every agent (the cloud). Routing treats this as a wildcard. */
  | { mode: "all" }
  /** Serves exactly these agent ids (a local device agent → typically one id). */
  | { mode: "list"; agentIds: string[] };

export type DataClientConnectionState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "degraded"
  | "error";

export interface DataClientStatus {
  /** This client's id ("cloud", "local:…", "multiplex", …). */
  clientId: string;
  /** True when the realtime link is up. Mirrors `isConnected()`. */
  connected: boolean;
  state: DataClientConnectionState;
  /** Gateway session, when applicable. */
  session?: { id: string } | null;
  /** Last lifecycle event seen ("init" | "open" | "ready" | "close" | "error" | …). */
  lastEvent?: string;
  /** Round-trip latency estimate in ms, if measured. */
  latencyMs?: number | null;
  /** Last error message, if the last event was an error. */
  lastError?: string;
  /** Best-effort agent scope at snapshot time ("unknown" before first resolution). */
  agentScope: AgentScope | "unknown";
  /** When this snapshot was taken (epoch ms). */
  at: number;
  /** Per-member statuses — present only for `MultiplexClient`. */
  members?: Array<{ sourceId: string; label?: string; status: DataClientStatus }>;
}

/**
 * The capability-aware data-access contract. `DooverClient`, `LocalAgentClient`
 * and `MultiplexClient` all implement it. Deliberately excludes `DooverClient`'s
 * `auth`/`rest`/`stats`/`viewer` (construction/internals/legacy). May be widened
 * later; the invariant is that `DooverClient` always satisfies it.
 */
export interface DataClient {
  readonly agents: AgentsApiLike;
  readonly channels: ChannelsApiLike;
  readonly messages: MessagesApiLike;
  readonly aggregates: AggregatesApiLike;
  readonly alarms: AlarmsApiLike;
  readonly connections: ConnectionsApiLike;
  readonly notifications: NotificationsApiLike;
  readonly permissions: PermissionsApiLike;
  readonly processors: ProcessorsApiLike;
  readonly turn: TurnApiLike;
  readonly users: UsersApiLike;
  readonly gateway: GatewayClientLike;
  readonly rpc: RpcDispatcherLike;

  getCapabilities(): ReadonlySet<Capability>;
  /** Convenience: `getCapabilities().has(cap)`. */
  supports(cap: Capability): boolean;

  /** True when the client's realtime link is up (multiplex: all members with `gateway.subscribe`). */
  isConnected(): boolean;
  getStatus(): DataClientStatus;
  /** Subscribe to status changes; returns an idempotent unsubscribe fn. */
  onStatusChange(listener: (status: DataClientStatus) => void): () => void;

  /** Which agents this client can serve. Cloud → `{ mode: "all" }` with no round-trip. */
  getAgentScope(): Promise<AgentScope>;
  /** Synchronous best-effort snapshot; `"unknown"` until the first resolution. */
  getKnownAgentScope(): AgentScope | "unknown";
}
