# Spec A — doover-js: `DataClient` contract, capabilities, local agent, and multiplex client

**Date:** 2026-05-11
**Repo:** `doover-js` (separate codebase; published as `doover-js` npm package)
**Status:** Design — pending implementation
**Companion spec:** Spec B (`2026-05-11-query-viewer-data-source-decoupling-design.md`) in `channel-viewer`, which consumes everything defined here.

## Background

The Doover channel-viewer query page currently talks to a single cloud backend through one `DooverClient` singleton. We want to decouple it so that:

1. A single query-viewer page can pull data from multiple sources concurrently — the Doover data cloud **and** a local device agent (which relays messages between on-device apps without forwarding everything to the cloud).
2. A future local-only build of the channel-viewer can ship on devices, talk only to the local device agent, and never touch the cloud.

doover-js `0.5.0-alpha.0` already restructured `DooverClient` into composed subclients (`client.agents`, `client.channels`, `client.messages`, `client.aggregates`, `client.gateway`, …) and deprecated `DooverDataProvider` (`client.viewer`, removed in `0.6.0`). It also shipped a `doover-js/react` entrypoint (`DooverProvider`, `useDooverClient`, `useChannelAggregate`, `useChannelMessages`, `useChannelSubscription`, `useSendMessage`, `useUpdateAggregate`, `useUpdateMessage`, `useChannelMessage`, `useMultiAgentAggregates`, `useMultiAgentChannelMessages`, `getSharedQueryClient`).

This spec adds the abstraction layer that makes "which backend(s) am I talking to" a first-class, capability-aware concept in doover-js. The channel-viewer-specific query syntax (the `{...}` settings block carrying `source:`) and UI live in Spec B.

## Goals

- Define a **`DataClient` interface**: the structural contract covering the **full public surface `DooverClient` exposes today** (every subclient — `agents`, `channels`, `messages`, `aggregates`, `alarms`, `connections`, `notifications`, `permissions`, `processors`, `turn`, `users`, `gateway`, `rpc`), so other backends (local agent, a multiplexer) can be substituted by shape. This interface is the common contract shared by the channel-viewer and any other doover-js consumer, so it must not be a channel-viewer-specific subset.
- Define a **capability model**: a `Capability` value set with one entry per ability/endpoint **across that full surface**, plus `getCapabilities(): Set<Capability>` on every `DataClient`. Callers gate calls on capabilities; unsupported calls throw a typed error.
- Ship a **`LocalAgentClient`**: a `DataClient` that talks to a local device agent over its REST + realtime transport, declaring a narrower capability set.
- Ship a **`MultiplexClient`**: a `DataClient` backed by a **persistent registry** of member `DataClient`s keyed by source id. Sources are enabled/disabled by id (clients are built once via a factory and reused thereafter, never rebuilt on toggle). Read methods fan out across the _enabled_ members and merge; write methods route; the gateway is a composite. `getCapabilities()` is the union of enabled members'. Members lacking a required capability are silently skipped. Individual read methods/hooks accept an optional source-scoping argument.
- Keep the existing `doover-js/react` hooks working unchanged when handed a `MultiplexClient` via `DooverProvider`.

## Non-goals

- The `{...}` query settings-block syntax (carrying `source:`), its parsing, and any channel-viewer UI — Spec B.
- Authentication design beyond "each `DataClient` carries whatever auth its transport needs": cloud uses the existing `DooverAuth`; `LocalAgentClient` uses no auth in this iteration (LAN-trust assumption). The interface stays auth-agnostic.
- A device-side build/packaging of the channel-viewer.
- Removing `DooverDataProvider` / `client.viewer` (already scheduled for `0.6.0` independently).
- Reworking the cloud REST or gateway wire protocols.

## The `DataClient` interface

A new exported interface (suggested location `src/client/data-client.ts`, re-exported from `src/index.ts`):

```ts
export interface DataClient {
  // Full public subclient surface — mirrors DooverClient 1:1 (minus deprecated `viewer`).
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

  /** Quick boolean health check — true when the client's realtime link is up
   *  (for a multiplex: all members with `gateway.subscribe`). */
  isConnected(): boolean;
  /** Richer status snapshot — connection state, session, last event, latency,
   *  last error, agent scope (best-effort), and (for a multiplex) per-member breakdown. */
  getStatus(): DataClientStatus;
  /** Subscribe to status changes; returns an idempotent unsubscribe fn.
   *  Fires whenever `getStatus()` would return something different (connect,
   *  ready, close, error, latency tick, scope resolved, member set change). */
  onStatusChange(listener: (status: DataClientStatus) => void): () => void;

  /** Which agents this client can serve — consulted by the multiplex (and any
   *  caller) to decide whether to send an agent-scoped request here.
   *   - Cloud returns `{ mode: "all" }` synchronously-fast (no round-trip).
   *   - A local-agent client returns `{ mode: "list", agentIds: [deviceId] }`,
   *     fetching the device id from the local agent the first time and caching it.
   *  Cached; the cache is invalidated on (re)connect. */
  getAgentScope(): Promise<AgentScope>;
  /** Best-effort synchronous snapshot of `getAgentScope()`. `"unknown"` until the
   *  first async resolution lands (cloud is never "unknown" — it's always "all"). */
  getKnownAgentScope(): AgentScope | "unknown";
}
```

`AgentScope`:

```ts
export type AgentScope =
  /** Serves every agent (the cloud). No enumeration — routing treats this as a wildcard. */
  | { mode: "all" }
  /** Serves exactly these agent ids (a local device agent → typically one id). */
  | { mode: "list"; agentIds: string[] };
```

`DataClientStatus`:

```ts
export interface DataClientStatus {
  /** This client's id (own id for a stand-alone client; "multiplex" or similar for the aggregator). */
  clientId: string;
  /** True when the realtime link is up. Mirrors `isConnected()`. */
  connected: boolean;
  /** Overall health: "connected" | "connecting" | "disconnected" | "degraded" | "error".
   *  A multiplex is "degraded" when some-but-not-all members are connected. */
  state: DataClientConnectionState;
  /** Gateway session, when applicable. */
  session?: { id: string } | null;
  /** Last lifecycle event seen ("init" | "open" | "ready" | "close" | "error" | …). */
  lastEvent?: string;
  /** Round-trip latency estimate in ms, if measured. */
  latencyMs?: number | null;
  /** Last error message, if the last event was an error. */
  lastError?: string;
  /** Best-effort agent scope — `getKnownAgentScope()` at snapshot time
   *  ("all" for cloud; the resolved id list for a local agent; "unknown" before
   *  the first resolution). Lets a UI show "cloud — all devices" / "local — device-7". */
  agentScope: AgentScope | "unknown";
  /** When this snapshot was taken (epoch ms). */
  at: number;
  /** Per-member statuses — present only for `MultiplexClient`. Each entry is the
   *  member's own `DataClientStatus` plus its source id. */
  members?: Array<{
    sourceId: string;
    label?: string;
    status: DataClientStatus;
  }>;
}
```

- `DooverClient` is made to `implements DataClient` — it already has every member; add `getCapabilities()` / `supports()`, `isConnected()` / `getStatus()` / `onStatusChange()`, and `getAgentScope()` / `getKnownAgentScope()`. `isConnected()` delegates to `this.gateway.isConnected()`; `getStatus()` is assembled from `this.gateway` (connection state, session, last lifecycle event) plus any latency/error tracking the gateway already exposes (it emits `open`/`ready`/`close`/`wssError`) and `getKnownAgentScope()`; `onStatusChange()` is implemented by subscribing to those gateway events internally and re-emitting a `DataClientStatus`; `getAgentScope()` resolves to `{ mode: "all" }` immediately (no network) and `getKnownAgentScope()` likewise — the cloud serves every agent, so routing never needs to enumerate it. No behaviour change for existing consumers — these are additive.
- The `*ApiLike` / `GatewayClientLike` / `RpcDispatcherLike` types are interfaces extracted from the existing concrete `AgentsApi`, `ChannelsApi`, `MessagesApi`, `AggregatesApi`, `AlarmsApi`, `ConnectionsApi`, `NotificationsApi`, `PermissionsApi`, `ProcessorsApi`, `TurnApi`, `UsersApi`, `GatewayClient`, `RpcDispatcher` classes — same method signatures, named as interfaces so non-`DooverClient` implementations can satisfy them structurally. TypeScript interfaces are structural, so `DooverClient` satisfies `DataClient` automatically once `getCapabilities()`/`supports()` exist; the explicit `implements` is documentation/enforcement.
- `DataClient` deliberately excludes `DooverClient`'s `auth`, `rest`, `stats`, and the deprecated `viewer` — those are construction/internals/legacy, not the data-access surface. (`DataClient` may still be widened later; the invariant is that `DooverClient` always satisfies it, i.e. `DataClient`'s surface is a subset of `DooverClient`'s.)

### Surface scope

`DataClient` covers the **whole** public surface above — not just what the channel-viewer query page happens to use. Rationale: this contract is shared between the channel-viewer, the device-local build, and any future doover-js consumer; a backend should be describable in full. Consequently `LocalAgentClient` and `MultiplexClient` must implement _every_ method on `DataClient` — methods whose capability a client doesn't advertise throw `UnsupportedCapabilityError` (see below) rather than being absent.

For reference, the methods the channel-viewer query page actually exercises today (the parts most load-bearing for Spec B) are: `agents.listAgents` / `getMultiAgentMessages` / `getMultiAgentAggregates`; `channels.listChannels` / `getChannel` / `createChannel` / `archiveChannel` / `unarchiveChannel`; `aggregates.getAggregate` / `putAggregate` / `patchAggregate` / `getAggregateAttachment`; `messages.listMessages` / `getMessage` / `postMessage` / `putMessage` / `patchMessage` / `getMessageAttachment`; `gateway.connect` / `disconnect` / `on` / `off` / `subscribe` / `unsubscribe` / `subscribeToChannel` / `syncChannel` / `getSession` / `isConnected` / `getSubscriptionCount` / `getSubscriptions` / `reconnect`. The merge/routing semantics below are specified in detail for those; the remaining methods (`alarms.*`, `connections.*`, `notifications.*`, `permissions.*`, `processors.*`, `turn.*`, `users.*`, `rpc.*`) follow the same patterns (read → fan-out/merge, write → route-to-one, capability-gated) and their per-method rules are an implementation detail to be filled in following those patterns.

## Capability model

A string-literal union (preferred over a TS `enum` so values serialise cleanly and can appear in error messages / debug UIs):

```ts
export type Capability =
  // agents
  | "agents.list"
  | "agents.multiAgentMessages"
  | "agents.multiAgentAggregates"
  // channels
  | "channels.list"
  | "channels.get"
  | "channels.create"
  | "channels.archive" // covers archive + unarchive
  | "channels.dataSeries"
  // aggregates
  | "aggregates.get"
  | "aggregates.put"
  | "aggregates.patch"
  | "aggregates.attachment"
  // messages
  | "messages.list" // list recent / windowed-by-cursor
  | "messages.listHistorical" // list arbitrarily-old messages (pagination beyond the live buffer)
  | "messages.get"
  | "messages.post"
  | "messages.put" // covers put + patch
  | "messages.delete"
  | "messages.attachment"
  | "messages.timeseries"
  | "messages.invocationLogs"
  // gateway / realtime
  | "gateway.subscribe" // can open a subscription channel at all
  | "gateway.realtime" // pushes live message/aggregate updates over that subscription
  | "gateway.oneShot" // sendOneShotMessage
  // rpc
  | "rpc.send"
  // alarms / connections / notifications / permissions / processors / turn / users
  | "alarms.read"
  | "alarms.write"
  | "connections.read"
  | "notifications.read"
  | "notifications.write"
  | "permissions.read"
  | "permissions.write"
  | "processors.read"
  | "processors.write"
  | "turn.credentials"
  | "users.me"
  | "users.read"
  | "users.write";

export const ALL_CAPABILITIES: readonly Capability[] = [
  /* every member of the union above */
];
```

The exact spelling/granularity of the non-core capabilities (`alarms.*` … `users.*`) is to be finalised against the actual subclient method lists during implementation — the rule is one capability per distinct endpoint-or-ability, mirroring `DataClient`'s full surface. The core set (`agents.*`, `channels.*`, `aggregates.*`, `messages.*`, `gateway.*`) above is normative for Spec B.

Notes:

- The list is deliberately one-capability-per-endpoint-or-ability so a backend can advertise exactly what it does. Add entries as new `DataClient` methods are added.
- `messages.list` vs `messages.listHistorical`: the local agent can return _recent / live-buffer_ messages but cannot serve arbitrarily-old history. Callers wanting a historical window check `messages.listHistorical`; callers wanting "latest N" check `messages.list`.
- `gateway.subscribe` vs `gateway.realtime`: a backend might accept a subscription but not actually push diffs (degenerate case); keeping them separate lets a caller decide whether realtime is worth wiring up. The cloud and local agent both have `gateway.realtime`.

### `getCapabilities()` behaviour

- **`DooverClient` (cloud):** returns the full set (every `Capability`).
- **`LocalAgentClient`:** returns the narrowed set (see below).
- **`MultiplexClient`:** returns the **union** of its current members' capabilities. (A query needing capability X will run against whichever members have X.)

### Unsupported-call behaviour

Calling a `DataClient` method whose capability the client does **not** advertise throws a typed error:

```ts
export class UnsupportedCapabilityError extends DooverApiError {
  constructor(public readonly capability: Capability, public readonly clientId?: string) { … }
}
```

- `LocalAgentClient` throws this from any method backing an unsupported capability.
- `MultiplexClient` does **not** throw for partial support — it silently drops members that lack the capability and proceeds with the rest. If **no** member supports it, the multiplex method throws `UnsupportedCapabilityError`.
- Convention for channel-viewer (Spec B): always `supports(cap)` before calling, so this error is a safety net, not a control-flow mechanism.

## `LocalAgentClient`

A new `DataClient` implementation (suggested `src/client/local-agent-client.ts`) for talking to a local device agent.

**Construction:** `new LocalAgentClient({ baseUrl: string, webSocketImpl?, fetchImpl?, ... })` — mirrors the relevant slice of `DooverClientConfig`, minus cloud-only auth. No `DooverAuth` in this iteration (assume LAN trust); the constructor signature should leave room for an optional auth blob later without a breaking change.

**Capabilities advertised (this iteration):**

| Capability                    | Supported?     | Notes                                                           |
| ----------------------------- | -------------- | --------------------------------------------------------------- |
| `agents.list`                 | ✓ (degenerate) | Returns the single device agent the local agent represents.     |
| `agents.multiAgentMessages`   | ✗              | No cross-agent fan-out on a local agent.                        |
| `agents.multiAgentAggregates` | ✗              | "                                                               |
| `channels.list`               | ✓              | Channels on the single device agent.                            |
| `channels.get`                | ✓              |                                                                 |
| `channels.create`             | ⚠ TBD          | Decide in implementation — likely ✗ for v1. Mark explicitly.    |
| `channels.archive`            | ✗              |                                                                 |
| `aggregates.get`              | ✓              | Current aggregate state for a channel.                          |
| `aggregates.put`              | ✓              | Writes.                                                         |
| `aggregates.patch`            | ✓              | Writes.                                                         |
| `aggregates.attachment`       | ⚠ TBD          | Decide in implementation; mark explicitly.                      |
| `messages.list`               | ✓              | Recent / live-buffer messages only.                             |
| `messages.listHistorical`     | ✗              | Local agent does not retain deep history.                       |
| `messages.get`                | ⚠ TBD          | Only if the message is still in the live buffer; decide + mark. |
| `messages.post`               | ✓              | Writes.                                                         |
| `messages.put`                | ✓              | Writes.                                                         |
| `messages.attachment`         | ⚠ TBD          | Decide + mark.                                                  |
| `gateway.subscribe`           | ✓              |                                                                 |
| `gateway.realtime`            | ✓              | Local agent pushes new messages and aggregate updates.          |

Any `Capability` not in the table above (the non-core `alarms.*` … `users.*`, `rpc.send`, `messages.timeseries`, `channels.dataSeries`, etc.) is **not** advertised by `LocalAgentClient` in this iteration; its backing method throws `UnsupportedCapabilityError`. `LocalAgentClient` still _implements_ every `DataClient` method (so it satisfies the interface) — unsupported ones are throw-stubs.

Items marked **⚠ TBD** must be resolved during implementation against the actual local-agent transport; the spec's requirement is that whatever the answer is, it is reflected truthfully in `getCapabilities()`.

**Transport:** the local agent's REST + realtime protocol. If it matches the cloud wire shapes closely enough, `LocalAgentClient` may reuse `RestClient` / `GatewayClient` with a different base URL and no auth; if it diverges, it implements the `*ApiLike` interfaces directly. Either way the _consumer-visible_ method signatures and return types are identical to the cloud client's (same `Channel`, `MessageStructure`, `Aggregate` types from `types/openapi` / `types/common`).

**Status:** implements `isConnected()` / `getStatus()` / `onStatusChange()` the same way as `DooverClient` — derived from its realtime link state, with `clientId` = its own source id and `getStatus().state` reflecting the local connection. If the local agent has no realtime link configured, `isConnected()` is `false` and `state` is `"disconnected"`.

**Agent scope:** a local agent serves one device. `getAgentScope()` resolves the device's agent id from the local agent — via a "whoami"/info endpoint if the transport has one, else by taking `agents.listAgents()[0].id` — caches it (invalidated on reconnect), and returns `{ mode: "list", agentIds: [deviceId] }`. `getKnownAgentScope()` is `"unknown"` until that first resolution completes, then the cached list. (The exact whoami endpoint is an implementation detail of the local-agent transport; the requirement is that `getAgentScope()` ends up reporting the device id(s) the local agent actually serves.) Resolution is kicked off on connect so the scope is usually known before the first agent-scoped request arrives.

## `MultiplexClient`

A new `DataClient` implementation (suggested `src/client/multiplex-client.ts`) — the "DooverClientLike aggregator". This is the piece a multi-source consumer actually hands to `DooverProvider`.

### Construction, registry, and activation

The `MultiplexClient` is created **once** and lives for the app's lifetime. It owns a **persistent registry of member clients keyed by source id**. Member clients are built lazily — the first time a source id is referenced, the multiplex constructs its `DataClient` via a `factory` supplied at construction and keeps it. After that, a source is just _enabled_ or _disabled_ — never rebuilt. A disabled source keeps its client object (and therefore its react-query cache entries, since query keys are stable) and can be re-enabled instantly.

```ts
/** A serialisable description of a source — what the consumer hands the multiplex. */
export interface SourceDescriptor {
  /** Stable id, e.g. "cloud", "local:192.168.0.1:49100". Also the key in the registry. */
  id: string;
  /** Source kind — selects which branch of the factory builds it. */
  kind: string; // "cloud" | "local" | …
  /** Kind-specific params (e.g. { host, port } for "local"). Ignored for "cloud". */
  params?: Record<string, unknown>;
  /** Optional human label for UI/debug. */
  label?: string;
}

export interface MultiplexClientOptions {
  /** Builds a DataClient for a descriptor the registry hasn't seen yet.
   *  Called at most once per id (result is cached). May be async. */
  factory: (descriptor: SourceDescriptor) => DataClient | Promise<DataClient>;
  /** Descriptors to pre-register (not necessarily enabled). Optional. */
  register?: SourceDescriptor[];
  /** Ids to enable initially. Optional — defaults to none, or to all `register` ids
   *  if the consumer passes `enableAll: true`. */
  enable?: string[];
  /** When a source is disabled, also disconnect its gateway? Default true
   *  (saves the socket; the client object + caches survive and reconnect on re-enable).
   *  Set false to keep disabled sources connected (e.g. a quick toggle). */
  disconnectOnDisable?: boolean;
}

interface RegisteredSource {
  descriptor: SourceDescriptor;
  /** Resolved lazily on first enable; undefined until then. */
  client?: DataClient;
  enabled: boolean;
}

export class MultiplexClient implements DataClient {
  constructor(options: MultiplexClientOptions);

  // --- registry / activation ---

  /** Add a descriptor to the registry without enabling it. Idempotent on id
   *  (a second register with the same id updates label/params metadata only —
   *  it does NOT rebuild an already-built client). */
  registerSource(descriptor: SourceDescriptor): void;

  /** Ensure these ids are registered (auto-registering any descriptors passed
   *  inline) and that EXACTLY this set is enabled — enabling any not currently
   *  enabled (building their client on first enable) and disabling the rest.
   *  Re-enabling a previously-disabled source reuses its existing client.
   *  No-op when the resulting enabled set already matches. */
  setActiveSources(idsOrDescriptors: Array<string | SourceDescriptor>): void;

  /** Enable a single source by id (auto-builds on first enable). */
  enableSource(id: string): void;
  /** Disable a single source by id (keeps the client; disconnects per
   *  `disconnectOnDisable`). */
  disableSource(id: string): void;
  /** Drop a source from the registry entirely — disconnects + discards the
   *  client + (optionally) evicts its cache entries. Rarely needed. */
  removeSource(id: string): void;

  /** Currently-enabled members, in registry order. */
  getActiveSources(): readonly RegisteredSource[];
  /** Everything in the registry (enabled or not). */
  getRegisteredSources(): readonly RegisteredSource[];

  // …rest of the DataClient surface…
}
```

How a consumer uses it (Spec B):

- Construct once: `new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }], enable: ["cloud"] })`. Hand it to `DooverProvider` once.
- When the query's `source:` setting changes, call `multiplex.setActiveSources([...])` with the descriptors derived from it. The multiplex enables the ones now wanted (building the `local(...)` client the first time it appears, reusing it forever after), disables the ones no longer wanted (keeping their clients warm), and is a no-op if nothing changed.
- A disabled source contributes nothing to fan-out reads, so its stale data doesn't leak into merged results; its react-query cache entries simply sit untouched until it's re-enabled, at which point the next hook run refetches and the source rejoins.

Notes:

- The multiplex never throws away a client just because the user toggled a source off — that's the whole point. `removeSource` is the explicit "I really mean drop it" escape hatch.
- `factory` is the single place a consumer wires "descriptor → DataClient" (cloud → the shared cloud `DooverClient`; `local` → a `LocalAgentClient` for that host:port; future kinds → whatever). In tests, `factory` returns stubs.
- First-enable of a source may be async (the factory can be async); `setActiveSources`/`enableSource` resolve the client in the background and emit a status change when it's ready. Reads issued before the client is ready either wait for it or skip that source for that call (decide in implementation — recommend "skip, then the source joins on the next refetch", consistent with the disabled→enabled flow).

### Source scoping on calls and hooks

Every `DataClient` read method on `MultiplexClient` accepts an **optional trailing options bag** with a `sources?: string[]` field (member ids). When omitted, the call fans out to all **enabled** members that have the required capability and own the targeted agent (if the call targets a specific agent). When present, the call is restricted to those member ids (must be enabled; still capability-filtered).

The `doover-js/react` hooks gain a parallel optional `sources?: string[]` option. Their query keys gain a **source dimension** derived from that option (or a sentinel like `"*"` / the sorted currently-enabled member-id list when unscoped), so a scoped query and an unscoped query for the same channel do not share a cache entry. **Open decision (resolve in implementation):** whether unscoped keys use a literal `"*"` token (cache survives enable/disable, but a stale union may briefly show until the next refetch) or the sorted enabled-member-id list (precise, but enabling/disabling a source changes the key and refetches). Recommended default: `"*"` for unscoped — the registry keeps disabled members' cache entries warm anyway, and a disabled member just stops contributing to fan-out, so the `"*"` entry naturally re-converges on the next refetch.

### Read fan-out & merge semantics

For each `DataClient` read method, define the merge rule. Summary:

| Method                                                                                                                                                                 | Routing / merge                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents.listAgents`                                                                                                                                                    | Fan out to all members with `agents.list`; concatenate; de-dupe by agent id keeping the first member's record; tag each agent with its owning `sourceId` (see Source tagging). If the same agent id appears in two members, it is listed once but its `sourceIds` is the set of owners.                                                                                                                        |
| `channels.listChannels(agentId)`                                                                                                                                       | Route to members that have `channels.list` **and** own `agentId`; concatenate channels; de-dupe by channel name; tag with `sourceId`.                                                                                                                                                                                                                                                                          |
| `channels.getChannel(agentId, name)`                                                                                                                                   | Route to owning members with `channels.get`. If exactly one → return it. If multiple → return the first (in member order), but record the conflict (see "Conflicts").                                                                                                                                                                                                                                          |
| `aggregates.getAggregate(agentId, name)`                                                                                                                               | Route to owning members with `aggregates.get`. Multiple → first wins; conflict recorded.                                                                                                                                                                                                                                                                                                                       |
| `messages.listMessages(agentId, name, params)`                                                                                                                         | Route to owning members. A member is eligible only if it has the capability the params imply: `messages.list` for "latest N" / live-cursor params; `messages.listHistorical` if `after`/deep `before` indicate a historical window. Merge by snowflake id, sorted to match the requested `order`, de-duped by id (first member wins on collision), then re-apply `limit`. Each message tagged with `sourceId`. |
| `messages.getMessage(agentId, name, id)`                                                                                                                               | Route to owning members with `messages.get`; first non-404 wins.                                                                                                                                                                                                                                                                                                                                               |
| `messages.postMessage` / `putMessage` / `patchMessage`, `aggregates.putAggregate` / `patchAggregate`, `channels.createChannel` / `archiveChannel` / `unarchiveChannel` | **Writes route to exactly one member.** Resolution order: (a) if the call is `sources`-scoped to exactly one id → that one; (b) else the single member that owns the targeted agent and has the write capability → that one; (c) else error (`UnsupportedCapabilityError` if none, or a new `AmbiguousWriteError` if more than one). Never fan a write out to multiple backends.                               |
| `agents.getMultiAgentMessages` / `getMultiAgentAggregates`                                                                                                             | Route to members with the corresponding capability; merge results by `(agentId, …)` similarly to `messages.listMessages`. Members without it are skipped.                                                                                                                                                                                                                                                      |
| `aggregates.getAggregateAttachment`, `messages.getMessageAttachment`                                                                                                   | Route to owning members with the attachment capability; first that returns a blob wins.                                                                                                                                                                                                                                                                                                                        |

**Routing by agent scope:** the multiplex decides which enabled members an agent-scoped request goes to by consulting each member's `getAgentScope()` — _at request time_, not eagerly. A member is included for a request targeting agent `X` iff its scope is `{ mode: "all" }` **or** its `{ mode: "list" }` contains `X`. Because the cloud's scope is `"all"` and resolves with no round-trip, this is cheap — the cloud is always a candidate for any agent without enumerating its agents. Local members resolve their (small, one-element) scope once on connect; if a local member's scope is still `"unknown"` when a request arrives, the multiplex includes it optimistically for that call (let the backend answer) and the scope settles for subsequent calls — keeps behaviour forgiving of not-yet-resolved scopes. `getAgentScope()` results are cached per member (invalidated on that member's reconnect), so a disabled-then-re-enabled member reuses its cached scope. The previously-described "build an `agentId → Set<sourceId>` ownership map" is just an _internal optimisation_ the multiplex may keep — derived from members' scopes — but the source of truth is `getAgentScope()`.

`MultiplexClient.getAgentScope()` → `{ mode: "all" }` if any enabled member's scope is `"all"`; otherwise `{ mode: "list" }` with the union of enabled members' lists. `getKnownAgentScope()` → the same rollup over `getKnownAgentScope()` of each enabled member, `"unknown"` if any list member is still unresolved and none is `"all"`.

### Conflicts

When a single-object read (`getChannel`, `getAggregate`, `getMessage`) resolves to differing values across members, the multiplex picks the first member's value (member order = source order) and exposes the conflict via a side channel so a UI can surface "cloud and local disagree": e.g. an event emitted on the multiplex (`multiplex.on("conflict", …)`) and/or a `getLastConflicts()` snapshot. Exact shape is a spec decision point for implementation; the requirement is that conflicts are _not_ silently swallowed.

### Composite gateway

`MultiplexClient.gateway` is a `GatewayClientLike` facade over the members' gateways:

- `connect()` / `disconnect()` / `reconnect()` → fan out to all members with `gateway.subscribe`.
- `subscribe(channel)` / `unsubscribe(channel)` / `subscribeToChannel(channel, handlers)` → route to the member(s) owning `channel.agent_id`; ref-count per (member, channel). `subscribeToChannel` returns a single unsubscribe fn that tears down all underlying subscriptions.
- `on/off(event, handler)` → register the handler against every member's gateway; events from any member are forwarded to the consumer. Event payloads carry `__source` (a `via.transport === "gateway"` provenance envelope stamped by the originating member) so consumers that care can disambiguate; consumers that don't (the existing `doover-js/react` hooks) keep working because the channel `agent_id`/`name` already routes the update to the right cache entry.
- `isConnected()` → **all** members with `gateway.subscribe` are connected. (Definitive — see `MultiplexClient.isConnected()` below; the composite gateway's `isConnected()` matches.)
- `getSession()` → a synthesised composite or the first member's; `getSubscriptions()` / `getSubscriptionCount()` → union across members.

### `getCapabilities()` / `supports()`

Union over the currently-enabled members (`getActiveSources()`). Recomputed when the enabled set changes.

### Status & agent scope (`isConnected()` / `getStatus()` / `onStatusChange()` / `getAgentScope()`)

- `isConnected()` → `true` iff every member that has `gateway.subscribe` reports `isConnected()`. (An empty member list → `false`.)
- `getStatus()` → a `DataClientStatus` with `clientId: "multiplex"` (or a caller-supplied id), `members` populated with each member's `{ sourceId, label, status: member.getStatus() }`, and the top-level fields rolled up: `connected` = the `isConnected()` rule above; `state` = `"connected"` if all connected, `"connecting"` if any connecting and none errored, `"degraded"` if some-but-not-all connected, `"error"` if any member is in `error`, `"disconnected"` otherwise; `agentScope` = the rollup of members' scopes (`"all"` if any member is `"all"`, else the union list, `"unknown"` if any list member is unresolved and none is `"all"`); `lastEvent`/`lastError`/`latencyMs` summarised from members (e.g. worst-of, or the most recent — implementation detail); `at = Date.now()`.
- `onStatusChange(listener)` → subscribes to every _enabled_ member's `onStatusChange` (and to enable/disable/register events); on any member change (including a member's agent scope resolving) or enabled-set change, re-derives the rolled-up status and calls `listener`. Returns an unsubscribe fn that detaches all member subscriptions. Disabled members appear in `members[]` with a `state` of `"disconnected"` (or are omitted — decide in implementation; recommend included-but-`disconnected` so the UI can show "local — off").
- `getAgentScope()` / `getKnownAgentScope()` → as described under "Routing by agent scope" above (rollup over enabled members).

## `doover-js/react` compatibility

One new hook (`useClientStatus`), plus the following requirements:

- `DooverProviderProps.client` is typed as `DataClient` (currently `DooverClient`) — a widening, non-breaking since `DooverClient` satisfies `DataClient`. `useDooverClient()` returns `DataClient`.
- Each existing hook (`useChannelAggregate`, `useChannelMessages`, `useChannelMessage`, `useChannelSubscription`, `useSendMessage`, `useUpdateAggregate`, `useUpdateMessage`, `useMultiAgentAggregates`, `useMultiAgentChannelMessages`) gains an optional `sources?: string[]` option that (a) is forwarded to the underlying `DataClient` call's options bag and (b) is folded into the hook's query key as the source dimension described above. When the client is a plain `DooverClient` (not a multiplex), `sources` is ignored and the key's source dimension is a constant — so single-source consumers are unaffected.
- **`useClientStatus(): DataClientStatus`** — new. Reads the client from context, seeds with `client.getStatus()`, subscribes via `client.onStatusChange(...)` for the component's lifetime, and returns the latest `DataClientStatus`. Works the same whether the client is a `DooverClient` (single-source status) or a `MultiplexClient` (rolled-up status with a `members` breakdown). This is the canonical way for a UI to render connection health, session, latency, last error, and per-source state. (Note: the existing `useConnectionState` hook in `doover-js/react` is gateway-flavoured and stays; `useClientStatus` is the client-level superset and is what new code should prefer. Consider documenting `useConnectionState` as soft-deprecated in favour of `useClientStatus`.)
- Hooks must tolerate `client.gateway` being a composite (the facade above implements the same `GatewayClientLike` surface, so this should be transparent).
- `getSharedQueryClient()` is unchanged.

## `__source` provenance envelope — stamped on every output by every `DataClient`

Every data object a `DataClient` returns — from **any** implementation, including the cloud `DooverClient`, not just the multiplex — carries a `__source` provenance envelope describing where the datum came from, when, and how. This is purely additive: it adds one new optional field, removes/renames/modifies nothing in the existing structures, so all current consumers keep working unchanged. (It's typed `?:` so it doesn't widen any base type's required shape, but in practice it's always populated.)

### Shape

```ts
export interface SourceProvenance {
  /** Which DataClient produced this datum. */
  client: {
    /** Stable id. For a stand-alone client this is its own id (e.g. "cloud", "local:192.168.0.1:49100");
     *  for an item that came through a MultiplexClient it is the originating member's id. */
    id: string;
    /** "cloud" | "local" | … — the source kind. */
    kind: string;
    /** Optional human label. */
    label?: string;
    /** Arbitrary client/source metadata (e.g. base URL, org id, device id, transport version). */
    meta?: Record<string, unknown>;
  };
  /** When the client obtained this datum (epoch ms). */
  retrievedAt: number;
  /** How it arrived. */
  via:
    | {
        transport: "rest";
        /** The DataClient method that produced it, e.g. "messages.listMessages", "aggregates.getAggregate". */
        method: string;
        /** The input the caller passed (agentId, channelName, query params, body summary, …). */
        request: Record<string, unknown>;
        /** Request timing. */
        startedAt: number; // epoch ms
        durationMs: number;
        /** HTTP status, when applicable. */
        status?: number;
      }
    | {
        transport: "gateway";
        /** The gateway event that carried it, e.g. "messageCreate", "aggregateUpdate", "channelSync". */
        event: string;
        /** Gateway session id, when known. */
        sessionId?: string;
        /** When the event was received (epoch ms). */
        receivedAt: number;
      };
}
```

`__source` is added (as `__source?: SourceProvenance`) to every returned data shape: `Channel`, `MessageStructure`, `Aggregate`, `Agent`, `User`, alarm/connection/notification/etc. records, `{ id }` results from `createChannel`, and to gateway event payloads delivered to `on(...)` handlers and `subscribeToChannel` handler callbacks. For arrays (`listMessages`, `listChannels`, `listAgents`, …) each element carries its own `__source`. **Exception:** binary returns (`getAggregateAttachment` / `getMessageAttachment` return `Blob`) cannot carry the field directly — these are either left untagged or returned wrapped in `{ blob: Blob; __source: SourceProvenance }` (decide in implementation; recommend wrapping only if a consumer needs it, otherwise leave `Blob` untagged).

### Who stamps it

- **Stand-alone clients (`DooverClient`, `LocalAgentClient`):** stamp `__source` themselves at the point a response is parsed (REST) or an event is emitted (gateway). For REST, `via` captures the method name, the caller's params, and the measured timing; for gateway, `via` captures the event name, session, and receipt time. `client.id`/`kind`/`meta` come from the client's own identity.
- **`MultiplexClient`:** does **not** re-stamp. Items it returns already carry `__source` from the originating member; the multiplex passes it through. For a single-object read that resolved across multiple owning members (a "conflict"), the returned object carries the chosen member's `__source`; the others are reported via the conflict side-channel. For a de-duped list item that appeared in more than one member, the kept item carries the first member's `__source`; if knowing all owners matters, the multiplex may additionally set `__source.client.meta.alsoFrom: string[]` — optional.

### Why this shape

- A multi-source UI can render a per-item source chip and a "fetched 3s ago via list" / "live from gateway" affordance directly off `__source`.
- `via.request` + timing make the data viewer self-documenting for debugging ("this aggregate value came from `getAggregate(agent1, telemetry)` at 12:04:11, took 230ms" vs. "pushed by `aggregateUpdate` 1s ago").
- Single-source callers that never look at `__source` are unaffected — the field is new and optional, and nothing existing changed.

The hard requirements: (1) nothing in the existing return structures is removed, renamed, or modified — `__source` is the only addition; (2) for every returned datum, a consumer can determine the source client and whether it came from a REST request (with that request's parameters and timing) or from the gateway (with the event name and receipt time).

## Testing requirements

- Unit tests for `MultiplexClient`: registry semantics — `registerSource` idempotent on id; `enableSource` builds the client via `factory` exactly once and reuses it on a later re-enable (factory call count asserted); `disableSource` keeps the client object, removes it from fan-out, and (per `disconnectOnDisable`) disconnects/keeps its gateway; `setActiveSources` enables/disables to match exactly and is a no-op when the enabled set already matches; `removeSource` discards. **Routing by agent scope** — a request for agent X goes to the cloud member (scope `"all"`, no enumeration) and to a local member iff its scope list contains X; a local member with `"unknown"` scope is included optimistically and the next call routes precisely once it resolves. Read fan-out + merge for each core method (including de-dup and `limit` re-application on merged message lists); write routing (single member, ambiguous → error, none → error); capability union over enabled members; conflict surfacing; `__source` pass-through from members; a disabled-then-re-enabled member rejoins merged results on the next refetch without a rebuild.
- Unit tests for `LocalAgentClient`: every advertised capability works against a faked local-agent transport; every unadvertised capability throws `UnsupportedCapabilityError`; `getCapabilities()` matches the advertised table; returned data carries a `__source` with `client.kind === "local"` and a `via` envelope (REST timing/params or gateway event); `getAgentScope()` resolves to `{ mode: "list", agentIds: [deviceId] }` from the faked whoami/listAgents source, is cached, and `getKnownAgentScope()` is `"unknown"` before resolution then the cached list.
- `DooverClient`: `getAgentScope()` / `getKnownAgentScope()` → `{ mode: "all" }` with no network call.
- `DooverClient`: `getCapabilities()` returns the full set; `supports()` consistent; every returned datum (REST and gateway) carries `__source` with `client.kind === "cloud"`, correct `via.method`/`via.request`/timing for REST and `via.event`/`receivedAt` for gateway; existing return shapes are otherwise byte-for-byte unchanged (regression test against a recorded fixture, ignoring `__source`); `isConnected()` tracks the gateway; `getStatus()` reflects connect/ready/close/error transitions; `onStatusChange` fires on each transition and the unsubscribe fn stops it.
- `MultiplexClient` status: `isConnected()` is true iff all enabled `gateway.subscribe` members are connected; `getStatus()` includes a `members[]` breakdown (enabled members + disabled-as-`disconnected`), a correct rolled-up `state` (`connected`/`degraded`/`error`/etc.), and a rolled-up `agentScope` (`"all"` when cloud is enabled, the union list otherwise); `onStatusChange` fires when any enabled member changes (including a member's agent scope resolving) and when the enabled set changes.
- `doover-js/react` hooks: existing tests still pass with a `DooverClient`; new tests with a `MultiplexClient` over two faked members assert merged data, `__source` on each item, and source-dimensioned query keys; `useClientStatus` returns the seeded status and re-renders on `onStatusChange` (single-source and multiplex cases).
- A composite-gateway test: subscribing through `MultiplexClient.gateway` reaches the right member, ref-counts, tears down on the returned unsubscribe, and forwarded events carry the originating member's `__source`.

## Open decision points (to be resolved in implementation, recorded here)

1. **Unscoped query-key source dimension:** `"*"` token (recommended — re-converges on next refetch, registry keeps disabled members warm) vs. sorted enabled-member-id list.
2. **`LocalAgentClient` ⚠ TBD capabilities:** `channels.create`, `aggregates.attachment`, `messages.get`, `messages.attachment` — resolve against the real local-agent transport; reflect truthfully in `getCapabilities()`.
3. **Conflict surfacing shape:** event vs. snapshot vs. both.
4. **`__source` on `Blob` returns (`getAggregateAttachment` / `getMessageAttachment`):** leave `Blob` untagged vs. wrap in `{ blob; __source }`.
5. **Composite `getSession()`:** synthesised vs. first-member passthrough.
6. **Non-core capability granularity:** finalise the `alarms.*` … `users.*` / `rpc.*` / `*.timeseries` / `*.dataSeries` capability spellings against the real subclient method lists (core set is normative as written).
7. **De-duped multi-owner list items:** whether to populate `__source.client.meta.alsoFrom` with the other owning member ids, or rely on agent-scope rollup only.
8. **`DataClientStatus` rollup details for `MultiplexClient`:** how to summarise `lastEvent`/`lastError`/`latencyMs` across members (worst-of vs. most-recent) — the `members[]` breakdown carries the precise per-source data regardless.
9. **`useConnectionState` deprecation:** soft-deprecate in favour of `useClientStatus`, or keep both first-class.
10. **`LocalAgentClient` device-id source:** dedicated whoami/info endpoint vs. `agents.listAgents()[0].id` fallback — depends on the local-agent transport. Whichever, `getAgentScope()` must end up reporting the device id(s) actually served.
11. **Multiplex internal ownership map:** keep an `agentId → Set<sourceId>` cache derived from member scopes as an optimisation, or always consult `getKnownAgentScope()` directly.

## Deliverables checklist

- [ ] `Capability` union + `ALL_CAPABILITIES` + `UnsupportedCapabilityError` (and `AmbiguousWriteError`) exported.
- [ ] `DataClient` interface (full `DooverClient` surface) + `*ApiLike` / `GatewayClientLike` / `RpcDispatcherLike` interfaces extracted and exported; `DataClientStatus` / `DataClientConnectionState` / `AgentScope` exported; `DooverClient implements DataClient` with `getCapabilities()` / `supports()` / `isConnected()` / `getStatus()` / `onStatusChange()` / `getAgentScope()` / `getKnownAgentScope()` (cloud scope = `"all"`, no network).
- [ ] `SourceProvenance` type exported; `__source` stamped on every REST/gateway output by `DooverClient` and `LocalAgentClient`; existing return shapes otherwise unchanged.
- [ ] `LocalAgentClient` implemented + tested — implements the full `DataClient` surface (throw-stubs for unadvertised capabilities), with a documented capability table; status methods implemented; `getAgentScope()` resolves the device id from the local agent (whoami/listAgents) and caches it.
- [ ] `MultiplexClient` implemented + tested — persistent source registry (`registerSource` / `setActiveSources` / `enableSource` / `disableSource` / `removeSource`, build-once-via-factory, reuse on re-enable, `disconnectOnDisable`), request-time routing by member `getAgentScope()` (cloud = `"all"`, local = list, optimistic on `"unknown"`), fan-out/merge over enabled members, write routing, composite gateway, conflicts, capability union, `__source` pass-through, status+scope rollup with `members[]`.
- [ ] `doover-js/react`: `DooverProvider`/`useDooverClient` typed against `DataClient`; all hooks gain optional `sources` option + source-dimensioned keys; new `useClientStatus()` hook; existing behaviour unchanged for `DooverClient`.
- [ ] Exports added to `src/index.ts` and `src/react/index.ts`.
- [ ] Changelog / version bump (target `0.5.0-alpha.x` or `0.5.0`).
