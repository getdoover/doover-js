# doover-js: `DataClient` contract, capabilities, `LocalAgentClient`, `MultiplexClient` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a capability-aware `DataClient` interface to doover-js, make `DooverClient` implement it (plus `__source` provenance on all outputs), and ship two new `DataClient` implementations — `LocalAgentClient` (one device) and `MultiplexClient` (fan-out/merge over a persistent registry of members) — while keeping `doover-js/react` working unchanged.

**Architecture:** A new `src/client/data-client.ts` declares the structural contract (every subclient as a `*ApiLike` type, plus status/scope/capability methods). `DooverClient` gains additive methods and wraps its subclients + gateway with a `ProvenanceStamper`. `LocalAgentClient` reuses `RestClient`/`GatewayClient` against a LAN base URL with no auth. `MultiplexClient` owns a `Map<sourceId, RegisteredSource>`, builds members lazily via a `factory`, routes agent-scoped calls by each member's `getAgentScope()`, merges read results, routes writes to exactly one member, and exposes a composite gateway. The existing react hooks are widened to accept `DataClient` and gain an optional `sources?: string[]` option folded into query keys.

**Tech Stack:** TypeScript (ES2020, CommonJS, `strict`), no runtime deps for core; `@tanstack/react-query` + `react` (peer) for the react entrypoint. Tests: `mocha` + `chai` (+ `chai-as-promised`) + `sinon`, run via `tsx/cjs`; react tests via `@testing-library/react` + `global-jsdom`. `npm test` runs `test:node` (`src/test/**/*.test.ts`) then `test:react` (`src/test/**/*.test.tsx`).

**Conventions to follow (from the codebase):**
- Subclient API classes live in `src/apis/*.ts`, take `RestClient` in the constructor, use the overload-then-`_private` pattern (string args OR `{ agentId, channelName }` identifier).
- Errors live next to their domain; `DooverApiError` is in `src/http/errors.ts` and takes `{ status, body, url, method, message? }`.
- Public exports go through `src/index.ts` (root) and `src/react/index.ts` (react entrypoint).
- Tests use `MockWebSocket` / `createFetchMock` / `createJsonResponse` / `installSessionStorageMock` from `src/test/helpers.ts`. New `DooverClient` / `LocalAgentClient` instances in tests pass `disableBrowserLifecycleHooks: true`.
- Run a single test file: `npx mocha --exit --require tsx/cjs src/test/<name>.test.ts`. Run a single react test file: `npx mocha --exit --require global-jsdom/register --require tsx/cjs src/test/<name>.test.tsx`. Typecheck: `npx tsc --noEmit`.

**Locked decisions** (the spec's open decision points, resolved): see `docs/superpowers/specs/2026-05-11-doover-js-dataclient-multiplex-design.md` § "Locked decisions". In short: `"*"` for unscoped query keys; `LocalAgentClient` does **not** advertise `channels.create` / `aggregates.attachment` / `messages.get` / `messages.attachment` in v1; conflicts surfaced via both event and snapshot; `Blob` returns left untagged; composite `getSession()` = first connected member's session; multiplex routes by `getKnownAgentScope()` directly (no separate ownership map); `useConnectionState` soft-deprecated.

**Capability granularity note:** The plan defines `Capability` exactly as written in Task 1. The non-core entries (`alarms.*` … `users.*`, `rpc.send`, `messages.timeseries`, `messages.invocationLogs`, `channels.dataSeries`) are mapped to concrete subclient methods in Task 24's table — do not invent extra capability strings.

**Subclient → method inventory** (used by Tasks 9, 12, 24 — confirm against the source files when implementing):
- `AgentsApi`: `listAgents`, `getMultiAgentMessages`, `getMultiAgentAggregates`
- `ChannelsApi`: `listChannels`, `getChannel`, `createChannel`, `putChannel`, `archiveChannel`, `unarchiveChannel`, `listDataSeries`
- `MessagesApi`: `listMessages`, `postMessage`, `getTimeseries`, `getMessage`, `putMessage`, `patchMessage`, `deleteMessage`, `getMessageAttachment`, `getInvocationLogs`, `createMultipartPayload` (sync helper — never stamped)
- `AggregatesApi`: `getAggregate`, `putAggregate`, `patchAggregate`, `getAggregateAttachment`
- `AlarmsApi`: `listAlarms`, `createAlarm`, `getAlarm`, `putAlarm`, `patchAlarm`, `deleteAlarm`
- `ConnectionsApi`: `getAgentConnections`, `getAgentConnectionHistory`, `getAgentSubscriptionHistory`, `getConnection`, `getChannelSubscriptions`, `syncConnection`
- `NotificationsApi`: `getAgentNotifications`, `getAgentNotificationEndpoints`, `createNotificationEndpoint`, `updateNotificationEndpoint`, `deleteNotificationEndpoint`, `testNotificationEndpoint`, `getAgentNotificationSubscriptions`, `createNotificationSubscription`, `getAgentDefaultNotificationSubscriptions`, `deleteDefaultNotificationSubscription`, `updateNotificationSubscription`, `deleteNotificationSubscription`, `getAgentNotificationSubscribers`, `updateMeWebPushEndpoint`, `getWebPushPublicKey`
- `PermissionsApi`: `getAgentPermission`, `getAgentPermissionDebug`, `syncPermissions`
- `ProcessorsApi`: `createProcessorSchedule`, `deleteProcessorSchedule`, `regenerateScheduleToken`, `getScheduleInfo`, `getScheduleInfoAlias`, `createProcessorSubscription`, `deleteProcessorSubscription`, `getProcessorSubscriptionInfo`, `getProcessorSubscriptionInfoAlias`, `createIngestionEndpoint`, `deleteIngestionEndpoint`, `invokeIngestionEndpoint`
- `TurnApi`: `createTurnToken`
- `UsersApi`: `getMe`
- `GatewayClient` (public): `setStats`, `connect`, `disconnect`, `on`, `off`, `subscribe`, `unsubscribe`, `subscribeToChannel`, `syncChannel`, `sendOneShotMessage`, `getSession`, `isConnected`, `getSubscriptionCount`, `getSubscriptions`, `reconnect`
- `RpcDispatcher` (public): `setStats`, `send`

---

## Phase 1 — Core types & contract (no behaviour change)

### Task 1: `Capability` union + `ALL_CAPABILITIES`

**Files:**
- Create: `src/client/capabilities.ts`
- Test: `src/test/capabilities.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/capabilities.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { ALL_CAPABILITIES } from "../client/capabilities";

describe("Capability", () => {
  it("ALL_CAPABILITIES has no duplicates and includes the core set", () => {
    expect(new Set(ALL_CAPABILITIES).size).to.equal(ALL_CAPABILITIES.length);
    for (const cap of [
      "agents.list",
      "channels.list",
      "channels.get",
      "channels.create",
      "channels.archive",
      "aggregates.get",
      "aggregates.put",
      "aggregates.patch",
      "messages.list",
      "messages.listHistorical",
      "messages.post",
      "gateway.subscribe",
      "gateway.realtime",
    ] as const) {
      expect(ALL_CAPABILITIES).to.include(cap);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/capabilities.test.ts`
Expected: FAIL — cannot find module `../client/capabilities`.

- [ ] **Step 3: Write `src/client/capabilities.ts`**

```ts
/**
 * One capability per distinct endpoint-or-ability across the full `DataClient`
 * surface. A backend advertises exactly what it can do; callers gate calls on
 * these and an unsupported call throws `UnsupportedCapabilityError`.
 *
 * String-literal union (not a TS enum) so values serialise cleanly and can
 * appear in error messages / debug UIs verbatim.
 */
export type Capability =
  // agents
  | "agents.list"
  | "agents.multiAgentMessages"
  | "agents.multiAgentAggregates"
  // channels
  | "channels.list"
  | "channels.get"
  | "channels.create" // covers createChannel + putChannel
  | "channels.archive" // covers archive + unarchive
  | "channels.dataSeries" // listDataSeries
  // aggregates
  | "aggregates.get"
  | "aggregates.put"
  | "aggregates.patch"
  | "aggregates.attachment"
  // messages
  | "messages.list" // list recent / windowed-by-cursor (latest N)
  | "messages.listHistorical" // pagination beyond the live buffer (deep history)
  | "messages.get"
  | "messages.post"
  | "messages.put" // covers putMessage + patchMessage
  | "messages.delete"
  | "messages.attachment"
  | "messages.timeseries" // getTimeseries
  | "messages.invocationLogs" // getInvocationLogs
  // gateway / realtime
  | "gateway.subscribe" // can open a subscription channel at all
  | "gateway.realtime" // pushes live message/aggregate updates over that subscription
  | "gateway.oneShot" // sendOneShotMessage
  // rpc
  | "rpc.send"
  // alarms / connections / notifications / permissions / processors / turn / users
  | "alarms.read" // listAlarms, getAlarm
  | "alarms.write" // createAlarm, putAlarm, patchAlarm, deleteAlarm
  | "connections.read" // all ConnectionsApi reads
  | "connections.write" // syncConnection
  | "notifications.read" // all NotificationsApi reads + getWebPushPublicKey
  | "notifications.write" // all NotificationsApi mutations
  | "permissions.read" // getAgentPermission, getAgentPermissionDebug
  | "permissions.write" // syncPermissions
  | "processors.read" // getScheduleInfo*, getProcessorSubscriptionInfo*
  | "processors.write" // all ProcessorsApi mutations + invokeIngestionEndpoint
  | "turn.credentials" // createTurnToken
  | "users.me"; // getMe

export const ALL_CAPABILITIES: readonly Capability[] = [
  "agents.list",
  "agents.multiAgentMessages",
  "agents.multiAgentAggregates",
  "channels.list",
  "channels.get",
  "channels.create",
  "channels.archive",
  "channels.dataSeries",
  "aggregates.get",
  "aggregates.put",
  "aggregates.patch",
  "aggregates.attachment",
  "messages.list",
  "messages.listHistorical",
  "messages.get",
  "messages.post",
  "messages.put",
  "messages.delete",
  "messages.attachment",
  "messages.timeseries",
  "messages.invocationLogs",
  "gateway.subscribe",
  "gateway.realtime",
  "gateway.oneShot",
  "rpc.send",
  "alarms.read",
  "alarms.write",
  "connections.read",
  "connections.write",
  "notifications.read",
  "notifications.write",
  "permissions.read",
  "permissions.write",
  "processors.read",
  "processors.write",
  "turn.credentials",
  "users.me",
] as const;
```

> Note: this collapses `users.read` / `users.write` from the spec's draft into a single `users.me`, since `UsersApi` only has `getMe`. `channels.create` covers `putChannel` too. These are the spec-sanctioned "finalise against the actual subclient method lists" choices.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx mocha --exit --require tsx/cjs src/test/capabilities.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/capabilities.ts src/test/capabilities.test.ts
git commit -m "feat: add Capability union and ALL_CAPABILITIES"
```

---

### Task 2: `UnsupportedCapabilityError` + `AmbiguousWriteError`

**Files:**
- Create: `src/client/errors.ts`
- Test: `src/test/data-client-errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/data-client-errors.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { AmbiguousWriteError, UnsupportedCapabilityError } from "../client/errors";
import { DooverApiError } from "../http/errors";

describe("DataClient errors", () => {
  it("UnsupportedCapabilityError carries the capability and clientId", () => {
    const err = new UnsupportedCapabilityError("messages.listHistorical", "local:1");
    expect(err).to.be.instanceOf(DooverApiError);
    expect(err.capability).to.equal("messages.listHistorical");
    expect(err.clientId).to.equal("local:1");
    expect(err.message).to.include("messages.listHistorical");
    expect(err.name).to.equal("UnsupportedCapabilityError");
  });

  it("AmbiguousWriteError lists candidate source ids", () => {
    const err = new AmbiguousWriteError("messages.post", ["cloud", "local:1"]);
    expect(err).to.be.instanceOf(DooverApiError);
    expect(err.candidateSourceIds).to.deep.equal(["cloud", "local:1"]);
    expect(err.message).to.include("cloud");
    expect(err.message).to.include("local:1");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/data-client-errors.test.ts`
Expected: FAIL — cannot find module `../client/errors`.

- [ ] **Step 3: Write `src/client/errors.ts`**

```ts
import type { Capability } from "./capabilities";
import { DooverApiError } from "../http/errors";

/**
 * Thrown when a `DataClient` method is called whose backing capability the
 * client does not advertise. Extends `DooverApiError` so existing
 * `instanceof DooverApiError` error handling catches it; the HTTP-ish fields
 * are placeholders since no request was made.
 */
export class UnsupportedCapabilityError extends DooverApiError {
  readonly capability: Capability;
  readonly clientId?: string;

  constructor(capability: Capability, clientId?: string) {
    super({
      status: 0,
      body: { capability, clientId },
      url: "",
      method: "",
      message:
        `Capability "${capability}" is not supported` +
        (clientId ? ` by client "${clientId}"` : "") + ".",
    });
    this.name = "UnsupportedCapabilityError";
    this.capability = capability;
    this.clientId = clientId;
  }
}

/**
 * Thrown by `MultiplexClient` when a write cannot be routed to a single
 * member — more than one enabled member owns the targeted agent and has the
 * write capability, and the call was not `sources`-scoped to one of them.
 */
export class AmbiguousWriteError extends DooverApiError {
  readonly capability: Capability;
  readonly candidateSourceIds: string[];

  constructor(capability: Capability, candidateSourceIds: string[]) {
    super({
      status: 0,
      body: { capability, candidateSourceIds },
      url: "",
      method: "",
      message:
        `Ambiguous write for "${capability}": ${candidateSourceIds.length} ` +
        `members are eligible (${candidateSourceIds.join(", ")}). ` +
        `Scope the call with { sources: [<one-id>] }.`,
    });
    this.name = "AmbiguousWriteError";
    this.capability = capability;
    this.candidateSourceIds = candidateSourceIds;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx mocha --exit --require tsx/cjs src/test/data-client-errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/errors.ts src/test/data-client-errors.test.ts
git commit -m "feat: add UnsupportedCapabilityError and AmbiguousWriteError"
```

---

### Task 3: `SourceProvenance` type + `__source?` on data shapes

**Files:**
- Create: `src/types/provenance.ts`
- Modify: `src/types/common.ts` (add `__source?` to `Channel`, `Aggregate`, `MessageStructure`, `AgentAggregate`, `Alarm`, `ConnectionSubscription`, `ConnectionSubscriptionLog`, `ConnectionDetails`, `NotificationSubscription`, `NotificationEndpoint`, `AgentPermission`, `TurnCredential`, `DataSeries`, `DataSeriesResult`, `RpcMessageData`)
- Modify: `src/types/viewer.ts` (add `__source?` to `Agent`, `User`)
- Test: `src/test/provenance-type.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/provenance-type.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import type { SourceProvenance } from "../types/provenance";
import type { Aggregate } from "../types/common";

describe("SourceProvenance", () => {
  it("is structurally usable on existing data shapes (compile-time)", () => {
    const prov: SourceProvenance = {
      client: { id: "cloud", kind: "cloud" },
      retrievedAt: Date.now(),
      via: { transport: "rest", method: "aggregates.getAggregate", request: {}, startedAt: 0, durationMs: 1 },
    };
    const agg: Aggregate = { data: {}, attachments: [], __source: prov };
    expect(agg.__source?.client.kind).to.equal("cloud");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/provenance-type.test.ts`
Expected: FAIL — cannot find module `../types/provenance` (and `__source` not assignable on `Aggregate`).

- [ ] **Step 3: Write `src/types/provenance.ts`**

```ts
/**
 * Provenance envelope stamped on every datum a `DataClient` returns —
 * describing which client produced it, when, and how (REST request with
 * params/timing, or gateway event with name/receipt time).
 *
 * Purely additive: every data shape gains `__source?: SourceProvenance`.
 * Nothing existing is removed/renamed/modified.
 */
export interface SourceProvenance {
  /** Which DataClient produced this datum. For a stand-alone client this is
   *  its own id; for an item via a MultiplexClient it is the originating
   *  member's id. */
  client: {
    id: string;
    /** "cloud" | "local" | … */
    kind: string;
    label?: string;
    /** Arbitrary client/source metadata (base URL, org id, device id, …). */
    meta?: Record<string, unknown>;
  };
  /** When the client obtained this datum (epoch ms). */
  retrievedAt: number;
  via: SourceProvenanceViaRest | SourceProvenanceViaGateway;
}

export interface SourceProvenanceViaRest {
  transport: "rest";
  /** The DataClient method that produced it, e.g. "messages.listMessages". */
  method: string;
  /** The input the caller passed (agentId, channelName, params, body summary). */
  request: Record<string, unknown>;
  startedAt: number; // epoch ms
  durationMs: number;
  /** HTTP status, when known. */
  status?: number;
}

export interface SourceProvenanceViaGateway {
  transport: "gateway";
  /** The gateway event that carried it, e.g. "messageCreate", "aggregateUpdate". */
  event: string;
  sessionId?: string;
  /** When the event was received (epoch ms). */
  receivedAt: number;
}
```

- [ ] **Step 4: Add `__source?` to `src/types/common.ts`**

At the top of `src/types/common.ts` add:

```ts
import type { SourceProvenance } from "./provenance";
```

Then add `__source?: SourceProvenance;` as a field to each of these interfaces (do not touch any existing field): `Aggregate<TData>`, `MessageStructure<TData>`, `Channel<TAgg>`, `Alarm`, `ConnectionSubscription`, `ConnectionSubscriptionLog`, `ConnectionDetails`, `NotificationSubscription`, `NotificationEndpoint`, `AgentPermission`, `TurnCredential`, `AgentAggregate<TData>`, `DataSeriesResult`, `DataSeries`, `RpcMessageData`. Example for `Aggregate`:

```ts
export interface Aggregate<TData = Record<string, JSONValue>> {
  data: TData;
  attachments: Attachment[];
  last_updated?: number | null;
  __source?: SourceProvenance;
}
```

- [ ] **Step 5: Add `__source?` to `src/types/viewer.ts`**

Add `import type { SourceProvenance } from "./provenance";` at the top, then `__source?: SourceProvenance;` to `interface Agent` and `interface User`.

- [ ] **Step 6: Run the test + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/provenance-type.test.ts && npx tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/types/provenance.ts src/types/common.ts src/types/viewer.ts src/test/provenance-type.test.ts
git commit -m "feat: add SourceProvenance type and optional __source field on data shapes"
```

---

### Task 4: `DataClient` interface, `*ApiLike` types, status & scope types

**Files:**
- Create: `src/client/data-client.ts`
- Test: `src/test/data-client-shape.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/data-client-shape.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { DooverClient } from "../client/doover-client";
import type { DataClient } from "../client/data-client";
import { MockWebSocket, createFetchMock } from "./helpers";

describe("DataClient shape", () => {
  it("DooverClient is assignable to DataClient (compile-time) and has the contract methods", () => {
    const client: DataClient = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: createFetchMock() as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
    });
    expect(client.agents).to.exist;
    expect(client.gateway).to.exist;
    expect(client.rpc).to.exist;
    expect(typeof client.getCapabilities).to.equal("function");
    expect(typeof client.supports).to.equal("function");
    expect(typeof client.isConnected).to.equal("function");
    expect(typeof client.getStatus).to.equal("function");
    expect(typeof client.onStatusChange).to.equal("function");
    expect(typeof client.getAgentScope).to.equal("function");
    expect(typeof client.getKnownAgentScope).to.equal("function");
  });
});
```

> This test will not pass until Task 8 adds the methods to `DooverClient`. That's fine — it's the Task-4-and-8 acceptance test; commit the file now and let it go green after Task 8.

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/data-client-shape.test.ts`
Expected: FAIL — cannot find module `../client/data-client`.

- [ ] **Step 3: Write `src/client/data-client.ts`**

```ts
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
```

- [ ] **Step 4: Run typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the new file compiles; `data-client-shape.test.ts` will still fail at runtime until Task 8 — that's expected).

- [ ] **Step 5: Commit**

```bash
git add src/client/data-client.ts src/test/data-client-shape.test.ts
git commit -m "feat: add DataClient interface, *ApiLike types, status/scope types"
```

---

### Task 5: Wire Phase-1 exports into `src/index.ts`

**Files:**
- Modify: `src/index.ts`
- Test: `src/test/exports.test.ts` (extend if it exists; else create)

- [ ] **Step 1: Write the failing test**

```ts
// src/test/exports.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import * as doover from "../index";

describe("public exports (Phase 1)", () => {
  it("exports the new capability/contract symbols", () => {
    expect(doover.ALL_CAPABILITIES).to.be.an("array");
    expect(doover.UnsupportedCapabilityError).to.be.a("function");
    expect(doover.AmbiguousWriteError).to.be.a("function");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/exports.test.ts`
Expected: FAIL — `ALL_CAPABILITIES` undefined.

- [ ] **Step 3: Add to `src/index.ts`**

Add these lines (near the other client exports):

```ts
export { ALL_CAPABILITIES } from "./client/capabilities";
export type { Capability } from "./client/capabilities";
export { UnsupportedCapabilityError, AmbiguousWriteError } from "./client/errors";
export type {
  DataClient,
  AgentScope,
  DataClientStatus,
  DataClientConnectionState,
  AgentsApiLike,
  AggregatesApiLike,
  AlarmsApiLike,
  ChannelsApiLike,
  ConnectionsApiLike,
  MessagesApiLike,
  NotificationsApiLike,
  PermissionsApiLike,
  ProcessorsApiLike,
  TurnApiLike,
  UsersApiLike,
  GatewayClientLike,
  RpcDispatcherLike,
} from "./client/data-client";
export type {
  SourceProvenance,
  SourceProvenanceViaRest,
  SourceProvenanceViaGateway,
} from "./types/provenance";
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/exports.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/test/exports.test.ts
git commit -m "feat: export DataClient/Capability/SourceProvenance from package root"
```

---

## Phase 2 — `DooverClient implements DataClient` + `__source` stamping

### Task 6: `ProvenanceStamper` + `wrapSubclient`

**Files:**
- Create: `src/client/provenance.ts`
- Test: `src/test/provenance-stamper.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/provenance-stamper.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { ProvenanceStamper, wrapSubclient } from "../client/provenance";

describe("ProvenanceStamper", () => {
  const stamper = new ProvenanceStamper({ id: "cloud", kind: "cloud", meta: { x: 1 } });

  it("stamps a plain object top-level", () => {
    const out = stamper.stampRest({ a: 1 }, { method: "x.y", request: { z: 2 }, startedAt: 0, durationMs: 5, status: 200 });
    expect(out).to.include({ a: 1 });
    expect(out.__source?.client.id).to.equal("cloud");
    expect(out.__source?.via).to.deep.include({ transport: "rest", method: "x.y", durationMs: 5, status: 200 });
  });

  it("stamps each element of an array", () => {
    const out = stamper.stampRest([{ a: 1 }, { a: 2 }], { method: "x.list", request: {}, startedAt: 0, durationMs: 1 });
    expect(out[0].__source?.client.kind).to.equal("cloud");
    expect(out[1].__source?.client.kind).to.equal("cloud");
  });

  it("stamps array-valued props one level deep (e.g. { results: [...] })", () => {
    const out = stamper.stampRest({ results: [{ a: 1 }], count: 1 }, { method: "x.batch", request: {}, startedAt: 0, durationMs: 1 });
    expect(out.__source?.client.id).to.equal("cloud");
    expect(out.results[0].__source?.client.id).to.equal("cloud");
  });

  it("leaves Blobs and primitives untouched", () => {
    const blob = new Blob(["x"]);
    expect(stamper.stampRest(blob, { method: "m", request: {}, startedAt: 0, durationMs: 1 })).to.equal(blob);
    expect(stamper.stampRest(undefined, { method: "m", request: {}, startedAt: 0, durationMs: 1 })).to.equal(undefined);
  });

  it("wrapSubclient stamps awaited results with subclient.method", async () => {
    const api = { thing: async () => ({ a: 1 }), sync: () => 42 };
    const wrapped = wrapSubclient(api, "channels", stamper);
    const r = await wrapped.thing();
    expect(r.__source?.via).to.include({ method: "channels.thing", transport: "rest" });
    expect(wrapped.sync()).to.equal(42); // sync passthrough
  });

  it("stampGatewayEvent stamps payload + nested aggregate/message", () => {
    const out = stamper.stampGatewayEvent(
      { author_id: "a", channel: { agent_id: "x", name: "c" }, aggregate: { data: {}, attachments: [] } },
      { event: "aggregateUpdate", sessionId: "s1" },
    );
    expect(out.__source?.via).to.deep.include({ transport: "gateway", event: "aggregateUpdate", sessionId: "s1" });
    expect(out.aggregate.__source?.via).to.deep.include({ transport: "gateway", event: "aggregateUpdate" });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/provenance-stamper.test.ts`
Expected: FAIL — cannot find module `../client/provenance`.

- [ ] **Step 3: Write `src/client/provenance.ts`**

```ts
import type {
  SourceProvenance,
  SourceProvenanceViaGateway,
  SourceProvenanceViaRest,
} from "../types/provenance";

export interface ClientIdentity {
  id: string;
  kind: string;
  label?: string;
  meta?: Record<string, unknown>;
}

interface RestContext {
  /** e.g. "messages.listMessages" */
  method: string;
  /** caller inputs (agentId, channelName, params, body summary) */
  request: Record<string, unknown>;
  startedAt: number;
  durationMs: number;
  status?: number;
}

interface GatewayContext {
  event: string;
  sessionId?: string;
}

/** Property names whose (object) value should also be stamped, for the known
 *  gateway envelopes ({ ..., aggregate }, { ..., message }). */
const NESTED_OBJECT_PROPS = ["aggregate", "message"] as const;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== "object" || v === null) return false;
  if (Array.isArray(v)) return false;
  if (typeof Blob !== "undefined" && v instanceof Blob) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export class ProvenanceStamper {
  constructor(private readonly identity: ClientIdentity) {}

  stampRest<T>(value: T, ctx: RestContext): T {
    const via: SourceProvenanceViaRest = {
      transport: "rest",
      method: ctx.method,
      request: ctx.request,
      startedAt: ctx.startedAt,
      durationMs: ctx.durationMs,
      ...(ctx.status !== undefined ? { status: ctx.status } : {}),
    };
    return this.stampGraph(value, via);
  }

  stampGatewayEvent<T>(value: T, ctx: GatewayContext): T {
    const via: SourceProvenanceViaGateway = {
      transport: "gateway",
      event: ctx.event,
      ...(ctx.sessionId !== undefined ? { sessionId: ctx.sessionId } : {}),
      receivedAt: Date.now(),
    };
    return this.stampGraph(value, via);
  }

  /** Build the full provenance envelope from a `via`. */
  private prov(via: SourceProvenance["via"]): SourceProvenance {
    return { client: this.identity, retrievedAt: Date.now(), via };
  }

  /**
   * Arrays → stamp each plain-object element. Plain objects → set `__source`,
   * then shallow-stamp array-valued props' elements and known nested-object
   * props (`aggregate`, `message`). Everything else (Blob, primitives,
   * undefined, FormData, class instances) → returned unchanged.
   */
  private stampGraph<T>(value: T, via: SourceProvenance["via"]): T {
    const prov = this.prov(via);
    if (Array.isArray(value)) {
      return value.map((el) => (isPlainObject(el) ? { ...el, __source: prov } : el)) as unknown as T;
    }
    if (!isPlainObject(value)) return value;
    const out: Record<string, unknown> = { ...value, __source: prov };
    for (const [k, v] of Object.entries(out)) {
      if (k === "__source") continue;
      if (Array.isArray(v)) {
        out[k] = v.map((el) => (isPlainObject(el) ? { ...el, __source: prov } : el));
      } else if ((NESTED_OBJECT_PROPS as readonly string[]).includes(k) && isPlainObject(v)) {
        out[k] = { ...v, __source: prov };
      }
    }
    return out as unknown as T;
  }
}

/**
 * Returns a Proxy over `api` whose methods, when they return a Promise, stamp
 * the resolved value with `via.method = "<subclientName>.<methodName>"`.
 * Synchronous returns (e.g. `createMultipartPayload`) pass through untouched.
 */
export function wrapSubclient<T extends object>(
  api: T,
  subclientName: string,
  stamper: ProvenanceStamper,
): T {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function" || typeof prop !== "string") return value;
      const methodName = `${subclientName}.${prop}`;
      return function (...args: unknown[]) {
        const startedAt = Date.now();
        const out = (value as (...a: unknown[]) => unknown).apply(target, args);
        if (out instanceof Promise) {
          return out.then((result) =>
            stamper.stampRest(result, {
              method: methodName,
              request: { args: summariseArgs(args) },
              startedAt,
              durationMs: Date.now() - startedAt,
            }),
          );
        }
        return out;
      };
    },
  }) as T;
}

/** Keep `via.request` small: drop FormData/Blob bodies, cap string length. */
function summariseArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    if (typeof FormData !== "undefined" && a instanceof FormData) return "[FormData]";
    if (typeof Blob !== "undefined" && a instanceof Blob) return "[Blob]";
    if (typeof a === "string" && a.length > 200) return `${a.slice(0, 200)}…`;
    return a;
  });
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/provenance-stamper.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/provenance.ts src/test/provenance-stamper.test.ts
git commit -m "feat: add ProvenanceStamper and wrapSubclient"
```

---

### Task 7: `ClientStatusTracker`

A small helper both `DooverClient` and `LocalAgentClient` use to derive a `DataClientStatus` from a `GatewayClientLike`'s lifecycle events.

**Files:**
- Create: `src/client/status-tracker.ts`
- Test: `src/test/status-tracker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/status-tracker.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { ClientStatusTracker } from "../client/status-tracker";

// Minimal GatewayClientLike stub: just on/off + isConnected + getSession.
function makeGatewayStub() {
  const listeners = new Map<string, Set<(...a: unknown[]) => void>>();
  let connected = false;
  let session: { session_id: string } | null = null;
  return {
    gw: {
      on(e: string, h: (...a: unknown[]) => void) {
        (listeners.get(e) ?? listeners.set(e, new Set()).get(e)!).add(h);
      },
      off(e: string, h: (...a: unknown[]) => void) {
        listeners.get(e)?.delete(h);
      },
      isConnected: () => connected,
      getSession: () => session,
    } as unknown as import("../client/data-client").GatewayClientLike,
    emit(e: string, ...args: unknown[]) {
      listeners.get(e)?.forEach((h) => h(...args));
    },
    setConnected(v: boolean) { connected = v; },
    setSession(s: { session_id: string } | null) { session = s; },
  };
}

describe("ClientStatusTracker", () => {
  it("derives state from gateway lifecycle and notifies listeners", () => {
    const { gw, emit, setConnected, setSession } = makeGatewayStub();
    const tracker = new ClientStatusTracker("cloud", gw, () => "all");
    const seen: string[] = [];
    const off = tracker.onChange((s) => seen.push(s.state));

    expect(tracker.getStatus().state).to.equal("disconnected");
    expect(tracker.getStatus().agentScope).to.equal("all");

    emit("open");
    expect(tracker.getStatus().lastEvent).to.equal("open");

    setConnected(true);
    setSession({ session_id: "s1" });
    emit("ready", { session_id: "s1" });
    const ready = tracker.getStatus();
    expect(ready.connected).to.equal(true);
    expect(ready.state).to.equal("connected");
    expect(ready.session).to.deep.equal({ id: "s1" });

    setConnected(false);
    emit("close", { code: 1006 });
    expect(tracker.getStatus().connected).to.equal(false);
    expect(tracker.getStatus().state).to.equal("connecting");

    emit("wssError", { message: "boom" });
    expect(tracker.getStatus().state).to.equal("error");
    expect(tracker.getStatus().lastError).to.equal("boom");

    expect(seen.length).to.be.greaterThan(3);
    off();
    emit("open");
    const len = seen.length;
    emit("ready", { session_id: "s2" });
    expect(seen.length).to.equal(len); // unsubscribed
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/status-tracker.test.ts`
Expected: FAIL — cannot find module `../client/status-tracker`.

- [ ] **Step 3: Write `src/client/status-tracker.ts`**

```ts
import type {
  AgentScope,
  DataClientConnectionState,
  DataClientStatus,
  GatewayClientLike,
} from "./data-client";

type AnyGateway = GatewayClientLike & {
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
  getSession?(): { session_id: string } | null;
};

/**
 * Tracks a `DataClient`'s realtime status by subscribing to its gateway's
 * `open` / `ready` / `close` / `wssError` events. Emits a fresh
 * `DataClientStatus` to listeners whenever the derived snapshot changes.
 */
export class ClientStatusTracker {
  private lastEvent: string | undefined = "init";
  private lastError: string | undefined;
  private session: { id: string } | null = null;
  private listeners = new Set<(status: DataClientStatus) => void>();
  private detach: Array<() => void> = [];

  constructor(
    private readonly clientId: string,
    private readonly gateway: GatewayClientLike,
    private readonly knownScope: () => AgentScope | "unknown",
  ) {
    const gw = gateway as AnyGateway;
    const onOpen = () => this.transition("open");
    const onReady = (s?: { session_id?: string }) => {
      if (s?.session_id) this.session = { id: s.session_id };
      this.transition("ready");
    };
    const onClose = () => this.transition("close");
    const onErr = (e?: { message?: string }) => {
      this.lastError = e?.message ?? "gateway error";
      this.transition("error");
    };
    gw.on("open", onOpen);
    gw.on("ready", onReady);
    gw.on("close", onClose);
    gw.on("wssError", onErr);
    this.detach.push(
      () => gw.off("open", onOpen),
      () => gw.off("ready", onReady),
      () => gw.off("close", onClose),
      () => gw.off("wssError", onErr),
    );
  }

  /** Call when the agent scope resolves (so listeners re-render). */
  notifyScopeChanged(): void {
    this.emit();
  }

  getStatus(): DataClientStatus {
    const connected = this.gateway.isConnected();
    let state: DataClientConnectionState;
    if (this.lastEvent === "error") state = "error";
    else if (connected) state = "connected";
    else if (this.lastEvent === "init") state = "disconnected";
    else state = "connecting"; // saw open/close but not currently connected → reconnecting
    return {
      clientId: this.clientId,
      connected,
      state,
      session: this.session,
      lastEvent: this.lastEvent,
      latencyMs: null,
      ...(this.lastError ? { lastError: this.lastError } : {}),
      agentScope: this.knownScope(),
      at: Date.now(),
    };
  }

  onChange(listener: (status: DataClientStatus) => void): () => void {
    this.listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.detach.forEach((fn) => fn());
    this.detach = [];
    this.listeners.clear();
  }

  private transition(event: string): void {
    this.lastEvent = event;
    if (event !== "error") {
      // a successful lifecycle event clears a stale error so state can recover
      this.lastError = undefined;
    }
    this.emit();
  }

  private emit(): void {
    const snapshot = this.getStatus();
    this.listeners.forEach((l) => l(snapshot));
  }
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/status-tracker.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/status-tracker.ts src/test/status-tracker.test.ts
git commit -m "feat: add ClientStatusTracker"
```

---

### Task 8: `DooverClient` — identity, capabilities, scope, status; `implements DataClient`

**Files:**
- Modify: `src/http/rest-client.ts` (add `sourceId?` / `sourceLabel?` to `DooverClientConfig`)
- Modify: `src/client/doover-client.ts`
- Test: `src/test/doover-client-dataclient.test.ts`; the existing `src/test/data-client-shape.test.ts` now goes green too.

- [ ] **Step 1: Write the failing test**

```ts
// src/test/doover-client-dataclient.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { DooverClient } from "../client/doover-client";
import { ALL_CAPABILITIES } from "../client/capabilities";
import { MockWebSocket, createFetchMock } from "./helpers";

function makeClient(extra: Record<string, unknown> = {}) {
  return new DooverClient({
    dataRestUrl: "https://api.example.com",
    controlApiUrl: "https://control.example.com",
    dataWssUrl: "wss://ws.example.com",
    fetchImpl: createFetchMock() as typeof fetch,
    webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    disableBrowserLifecycleHooks: true,
    ...extra,
  });
}

describe("DooverClient as DataClient", () => {
  it("advertises the full capability set", () => {
    const caps = makeClient().getCapabilities();
    for (const c of ALL_CAPABILITIES) expect(caps.has(c)).to.equal(true);
    expect(makeClient().supports("messages.listHistorical")).to.equal(true);
  });

  it("getAgentScope resolves to { mode: 'all' } with no network call", async () => {
    const fetchMock = createFetchMock();
    const client = makeClient({ fetchImpl: fetchMock as typeof fetch });
    expect(await client.getAgentScope()).to.deep.equal({ mode: "all" });
    expect(client.getKnownAgentScope()).to.deep.equal({ mode: "all" });
    expect((fetchMock as { called: boolean }).called).to.equal(false);
  });

  it("isConnected mirrors the gateway; getStatus reflects it; clientId defaults to 'cloud'", () => {
    const client = makeClient();
    expect(client.isConnected()).to.equal(false);
    const status = client.getStatus();
    expect(status.clientId).to.equal("cloud");
    expect(status.connected).to.equal(false);
    expect(status.agentScope).to.deep.equal({ mode: "all" });
  });

  it("honours a custom sourceId", () => {
    expect(makeClient({ sourceId: "cloud-eu" }).getStatus().clientId).to.equal("cloud-eu");
  });

  it("onStatusChange fires on gateway lifecycle and unsubscribes", () => {
    const client = makeClient();
    const seen: number[] = [];
    const off = client.onStatusChange(() => seen.push(1));
    // Drive the gateway: emit a fake 'open'. The gateway's emit is private,
    // but `reconnect()`/`connect()` paths are heavy; instead simulate via the
    // MockWebSocket the client created. Simplest: open the socket.
    MockWebSocket.instances[MockWebSocket.instances.length - 1]?.open?.();
    expect(seen.length).to.be.greaterThan(0);
    off();
    const len = seen.length;
    MockWebSocket.instances[MockWebSocket.instances.length - 1]?.close?.();
    expect(seen.length).to.equal(len);
  });
});
```

> If driving the socket via `MockWebSocket.instances` proves flaky (the client may not have called `connect()` yet), call `await client.gateway.connect()` first, then `MockWebSocket.instances.at(-1)!.open()` / `.receive({ op: 0, t: "Ready", d: { session_id: "s", session_token: "t", subscriptions: [] } })`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/doover-client-dataclient.test.ts`
Expected: FAIL — `getCapabilities` is not a function.

- [ ] **Step 3: Add config fields in `src/http/rest-client.ts`**

In `DooverClientConfig`, add:

```ts
  /** Stable id for this client as a data source. Defaults to "cloud". Used in
   *  `__source` provenance and `DataClientStatus.clientId`. */
  sourceId?: string;
  /** Optional human label for this source (UI/debug). */
  sourceLabel?: string;
```

- [ ] **Step 4: Rewrite `src/client/doover-client.ts`**

```ts
import { AgentsApi } from "../apis/agents-api";
import { AggregatesApi } from "../apis/aggregates-api";
import { AlarmsApi } from "../apis/alarms-api";
import { ChannelsApi } from "../apis/channels-api";
import { ConnectionsApi } from "../apis/connections-api";
import { MessagesApi } from "../apis/messages-api";
import { NotificationsApi } from "../apis/notifications-api";
import { PermissionsApi } from "../apis/permissions-api";
import { ProcessorsApi } from "../apis/processors-api";
import { TurnApi } from "../apis/turn-api";
import { UsersApi } from "../apis/users-api";
import { buildAuth } from "../auth/build-auth";
import type { DooverAuth } from "../auth/doover-auth";
import { GatewayClient } from "../gateway/gateway-client";
import { RestClient, type DooverClientConfig } from "../http/rest-client";
import { RpcDispatcher } from "../rpc/rpc-dispatcher";
import { DooverDataProvider } from "../viewer/doover-data-provider";
import { ALL_CAPABILITIES, type Capability } from "./capabilities";
import type {
  AgentsApiLike, AggregatesApiLike, AlarmsApiLike, ChannelsApiLike,
  ConnectionsApiLike, DataClient, DataClientStatus, AgentScope,
  GatewayClientLike, MessagesApiLike, NotificationsApiLike, PermissionsApiLike,
  ProcessorsApiLike, RpcDispatcherLike, TurnApiLike, UsersApiLike,
} from "./data-client";
import { ProvenanceStamper, wrapSubclient, type ClientIdentity } from "./provenance";
import { ClientStatusTracker } from "./status-tracker";
import { DooverStatsCollector, type DooverStatsSnapshot } from "./stats";

const ALL_CAPS_SET: ReadonlySet<Capability> = new Set(ALL_CAPABILITIES);

export class DooverClient implements DataClient {
  readonly auth: DooverAuth;
  readonly rest: RestClient;
  readonly viewer: DooverDataProvider;
  readonly users: UsersApiLike;
  readonly channels: ChannelsApiLike;
  readonly messages: MessagesApiLike;
  readonly aggregates: AggregatesApiLike;
  readonly alarms: AlarmsApiLike;
  readonly connections: ConnectionsApiLike;
  readonly notifications: NotificationsApiLike;
  readonly permissions: PermissionsApiLike;
  readonly processors: ProcessorsApiLike;
  readonly turn: TurnApiLike;
  readonly agents: AgentsApiLike;
  readonly gateway: GatewayClientLike;
  readonly rpc: RpcDispatcherLike;
  readonly stats: DooverStatsCollector;

  private readonly identity: ClientIdentity;
  private readonly statusTracker: ClientStatusTracker;
  /** Underlying concrete gateway (the public `gateway` is the same object,
   *  typed as the structural `GatewayClientLike`). */
  private readonly gatewayImpl: GatewayClient;

  constructor(config: DooverClientConfig) {
    this.auth = buildAuth({
      auth: config.auth,
      profile: config.profile,
      configManager: config.configManager,
      token: config.token,
      tokenExpires: config.tokenExpires,
      refreshToken: config.refreshToken,
      refreshTokenId: config.refreshTokenId,
      authServerUrl: config.authServerUrl,
      authServerClientId: config.authServerClientId,
      fetchImpl: config.fetchImpl,
    });

    this.identity = {
      id: config.sourceId ?? "cloud",
      kind: "cloud",
      ...(config.sourceLabel ? { label: config.sourceLabel } : {}),
      meta: {
        dataRestUrl: config.dataRestUrl,
        controlApiUrl: config.controlApiUrl,
        ...(config.organisationId ? { organisationId: config.organisationId } : {}),
      },
    };
    const stamper = new ProvenanceStamper(this.identity);

    this.rest = new RestClient(config, this.auth);
    this.gatewayImpl = new GatewayClient(config, this.auth);
    this.gatewayImpl.setProvenanceHook((value, ctx) => stamper.stampGatewayEvent(value, ctx));
    this.gateway = this.gatewayImpl;
    this.viewer = new DooverDataProvider({
      rest: this.rest,
      gateway: this.gatewayImpl,
      controlApiUrl: config.controlApiUrl,
    });

    this.users = wrapSubclient(new UsersApi(this.rest, config.controlApiUrl), "users", stamper);
    this.channels = wrapSubclient(new ChannelsApi(this.rest), "channels", stamper);
    this.messages = wrapSubclient(new MessagesApi(this.rest), "messages", stamper);
    this.aggregates = wrapSubclient(new AggregatesApi(this.rest), "aggregates", stamper);
    this.alarms = wrapSubclient(new AlarmsApi(this.rest), "alarms", stamper);
    this.connections = wrapSubclient(new ConnectionsApi(this.rest), "connections", stamper);
    this.notifications = wrapSubclient(new NotificationsApi(this.rest), "notifications", stamper);
    this.permissions = wrapSubclient(new PermissionsApi(this.rest), "permissions", stamper);
    this.processors = wrapSubclient(new ProcessorsApi(this.rest), "processors", stamper);
    this.turn = wrapSubclient(new TurnApi(this.rest), "turn", stamper);
    this.agents = wrapSubclient(new AgentsApi(this.rest, config.controlApiUrl), "agents", stamper);

    // RpcDispatcher needs the concrete MessagesApi (it calls postMessage internally);
    // give it an *unwrapped* one so stamping happens once at the public boundary.
    this.rpc = new RpcDispatcher(this.gatewayImpl, new MessagesApi(this.rest));

    this.stats = new DooverStatsCollector();
    this.rest.setStats(this.stats);
    this.gatewayImpl.setStats(this.stats);
    (this.rpc as RpcDispatcher).setStats(this.stats);

    this.statusTracker = new ClientStatusTracker(this.identity.id, this.gateway, () => this.getKnownAgentScope());
  }

  enableStats(): void { this.stats.setEnabled(true); }
  disableStats(): void { this.stats.setEnabled(false); }
  getStats(): DooverStatsSnapshot { return this.stats.snapshot(); }

  // --- DataClient: capabilities ---
  getCapabilities(): ReadonlySet<Capability> { return ALL_CAPS_SET; }
  supports(cap: Capability): boolean { return ALL_CAPS_SET.has(cap); }

  // --- DataClient: agent scope (cloud serves every agent) ---
  getAgentScope(): Promise<AgentScope> { return Promise.resolve({ mode: "all" }); }
  getKnownAgentScope(): AgentScope | "unknown" { return { mode: "all" }; }

  // --- DataClient: status ---
  isConnected(): boolean { return this.gateway.isConnected(); }
  getStatus(): DataClientStatus { return this.statusTracker.getStatus(); }
  onStatusChange(listener: (status: DataClientStatus) => void): () => void {
    return this.statusTracker.onChange(listener);
  }
}
```

> Note: `this.rpc` is typed `RpcDispatcherLike` in the interface; we still construct a real `RpcDispatcher` and cast for `setStats`. If `RpcDispatcherLike` (= `Pick<RpcDispatcher, keyof RpcDispatcher>`) already includes `setStats`, the cast is unnecessary — keep whichever the compiler accepts.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit`
Expected: error in `GatewayClient` — `setProvenanceHook` doesn't exist yet. That's Task 10. To unblock typechecking *this* task in isolation, you may stub `setProvenanceHook(_hook: unknown): void {}` on `GatewayClient` now and flesh it out in Task 10. (If executing sequentially, just proceed to Task 10 before running the full typecheck.)

- [ ] **Step 6: Run the tests (after Task 10's gateway hook lands)**

Run: `npx mocha --exit --require tsx/cjs src/test/doover-client-dataclient.test.ts src/test/data-client-shape.test.ts src/test/doover-client.test.ts`
Expected: PASS (note `data-client-shape.test.ts` now goes green; `doover-client.test.ts` still passes — `client.viewer` and `client.gateway === client.viewer.gateway` still hold).

- [ ] **Step 7: Commit**

```bash
git add src/http/rest-client.ts src/client/doover-client.ts src/test/doover-client-dataclient.test.ts
git commit -m "feat: DooverClient implements DataClient (capabilities, scope, status) + provenance wiring"
```

---

### Task 9: `RestClient` provenance is via subclient wrapping — verify the cloud REST `via.method`

This task has no new production code (the wrapping happened in Task 8); it adds a behavioural test that REST results carry `__source` with `via.transport === "rest"`, `via.method` like `"channels.getChannel"`, and timing.

**Files:**
- Test: `src/test/doover-client-provenance.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/test/doover-client-provenance.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { DooverClient } from "../client/doover-client";
import { MockWebSocket, createFetchMock, createJsonResponse } from "./helpers";

describe("DooverClient REST provenance", () => {
  it("stamps __source on REST results", async () => {
    const fetchMock = createFetchMock((url) => {
      if (url.includes("/channels/c1")) return createJsonResponse({ name: "c1", is_private: false, owner_id: "o" });
      return createJsonResponse({});
    });
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
      sourceId: "cloud",
    });
    const channel = await client.channels.getChannel("a1", "c1");
    expect(channel.name).to.equal("c1");
    expect(channel.__source?.client).to.deep.include({ id: "cloud", kind: "cloud" });
    expect(channel.__source?.via).to.include({ transport: "rest", method: "channels.getChannel" });
    if (channel.__source?.via.transport === "rest") {
      expect(channel.__source.via.durationMs).to.be.a("number");
      expect(channel.__source.via.request).to.have.property("args");
    }
  });
});
```

- [ ] **Step 2: Run**

Run: `npx mocha --exit --require tsx/cjs src/test/doover-client-provenance.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/test/doover-client-provenance.test.ts
git commit -m "test: DooverClient stamps __source on REST results"
```

---

### Task 10: `GatewayClient.setProvenanceHook` + stamp emitted gateway payloads

**Files:**
- Modify: `src/gateway/gateway-client.ts`
- Test: `src/test/gateway-provenance.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/gateway-provenance.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { GatewayClient } from "../gateway/gateway-client";
import type { DooverClientConfig } from "../http/rest-client";

function makeConfig(): DooverClientConfig {
  return {
    dataRestUrl: "https://example.com/api",
    controlApiUrl: "https://example.com/control",
    dataWssUrl: "wss://example.com/gateway",
    disableBrowserLifecycleHooks: true,
  } as DooverClientConfig;
}

describe("GatewayClient provenance hook", () => {
  it("stamps emitted payloads when a hook is set; raw when not", () => {
    const gw = new GatewayClient(makeConfig());
    let stamped: unknown;
    gw.on("messageCreate", (m) => { stamped = m; });
    // no hook → raw
    (gw as unknown as { handleMessage: (raw: string) => void }).handleMessage(
      JSON.stringify({ op: 0, t: "MessageCreate", d: { id: "m1", data: {}, attachments: [], author_id: "a", channel: { agent_id: "x", name: "c" } } }),
    );
    expect((stamped as { __source?: unknown }).__source).to.equal(undefined);

    // with hook → stamped
    gw.setProvenanceHook((value, ctx) => ({ ...(value as object), __source: { client: { id: "cloud", kind: "cloud" }, retrievedAt: Date.now(), via: { transport: "gateway", event: ctx.event, receivedAt: Date.now() } } }) as never);
    (gw as unknown as { handleMessage: (raw: string) => void }).handleMessage(
      JSON.stringify({ op: 0, t: "MessageCreate", d: { id: "m2", data: {}, attachments: [], author_id: "a", channel: { agent_id: "x", name: "c" } } }),
    );
    expect((stamped as { __source?: { via: { event: string } } }).__source?.via.event).to.equal("MessageCreate");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/gateway-provenance.test.ts`
Expected: FAIL — `setProvenanceHook` is not a function.

- [ ] **Step 3: Modify `src/gateway/gateway-client.ts`**

Add the hook type and field, the setter, a `stamp(...)` helper, and wrap the payloads emitted from `handleMessage`:

```ts
// near the top, after the imports:
import type { SourceProvenanceViaGateway } from "../types/provenance";

export type GatewayProvenanceHook = <T>(
  value: T,
  ctx: { event: string; sessionId?: string },
) => T;
```

Inside the class, add a field and setter:

```ts
  private provenanceHook: GatewayProvenanceHook | null = null;

  /** Optional hook that stamps `__source` provenance onto emitted gateway
   *  payloads. `DooverClient` / `LocalAgentClient` set this; standalone
   *  `GatewayClient` users leave it null and get raw payloads. */
  setProvenanceHook(hook: GatewayProvenanceHook | null): void {
    this.provenanceHook = hook;
  }

  private stamp<T>(value: T, event: string): T {
    if (!this.provenanceHook) return value;
    return this.provenanceHook(value, {
      event,
      ...(this.session?.session_id ? { sessionId: this.session.session_id } : {}),
    });
  }
```

In `handleMessage`, wrap each emitted *data* payload with `this.stamp(...)`. The relevant cases become:

```ts
      case "ChannelSync":
        this.emit("channelSync", this.stamp(message.d, "channelSync"));
        break;
      case "MessageCreate":
        this.emit("messageCreate", this.stamp(addTimestampToMessage(message.d), "messageCreate"));
        break;
      case "MessageUpdate":
        this.emit(
          "messageUpdate",
          this.stamp(addTimestampToMessage(message.d.message), "messageUpdate"),
          message.d.request_data,
        );
        break;
      case "AggregateUpdate":
        this.emit("aggregateUpdate", this.stamp(message.d, "aggregateUpdate"));
        break;
      case "AlarmTrigger":
        this.emit("alarmTrigger", this.stamp(message.d, "alarmTrigger"));
        break;
      case "OneShotMessage":
        this.emit("oneShotMessage", this.stamp(message.d, "oneShotMessage"));
        break;
```

(Leave `Hello`, `Ready`, `ChannelSubscription`, `ChannelUnsubscription`, `WSSErrorEvent` unstamped — they're control/lifecycle frames, not data.)

> The `stamp` helper passes the *whole* event-data object to the hook; `ProvenanceStamper.stampGatewayEvent` already shallow-stamps the nested `aggregate` / `message` sub-objects, so `subscribeToChannel`'s `onAggregate(event.aggregate)` / `onMessageUpdate(msg, …)` callbacks deliver stamped objects.

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/gateway-provenance.test.ts src/test/gateway-subscriptions.test.ts src/test/gateway-client.test.ts && npx tsc --noEmit`
Expected: PASS (existing gateway tests unchanged — no hook set in those).

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add src/gateway/gateway-client.ts src/test/gateway-provenance.test.ts
git commit -m "feat: GatewayClient provenance hook; stamp emitted realtime payloads"
```

---

### Task 11: Regression — existing return shapes unchanged (ignoring `__source`)

**Files:**
- Test: `src/test/provenance-regression.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/test/provenance-regression.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { DooverClient } from "../client/doover-client";
import { MockWebSocket, createFetchMock, createJsonResponse } from "./helpers";

function stripSource<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (k, val) => (k === "__source" ? undefined : val)));
}

describe("provenance is additive only", () => {
  it("REST payloads equal the wire body once __source is stripped", async () => {
    const wire = { name: "c1", is_private: false, owner_id: "o", id: "ch1" };
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: createFetchMock(() => createJsonResponse(wire)) as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
    });
    const channel = await client.channels.getChannel("a1", "c1");
    expect(channel.__source).to.exist; // it IS stamped
    expect(stripSource(channel)).to.deep.equal(wire); // …but otherwise byte-identical
  });

  it("listMessages stamps each element, leaving the array shape intact", async () => {
    const wire = [
      { id: "2", data: { v: 2 }, attachments: [], author_id: "a", channel: { agent_id: "a1", name: "c1" } },
      { id: "1", data: { v: 1 }, attachments: [], author_id: "a", channel: { agent_id: "a1", name: "c1" } },
    ];
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: createFetchMock(() => createJsonResponse(wire)) as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
    });
    const msgs = await client.messages.listMessages("a1", "c1", { limit: 2 });
    expect(msgs).to.have.length(2);
    expect(msgs[0].__source?.via).to.include({ method: "messages.listMessages" });
    // shape minus __source and the client-added `timestamp` matches the wire item
    const { __source: _s, timestamp: _t, ...rest } = msgs[0] as Record<string, unknown>;
    expect(rest).to.deep.equal(wire[0]);
  });
});
```

- [ ] **Step 2: Run**

Run: `npx mocha --exit --require tsx/cjs src/test/provenance-regression.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/test/provenance-regression.test.ts
git commit -m "test: provenance is additive — existing shapes unchanged"
```

---

## Phase 3 — `LocalAgentClient`

`LocalAgentClient` is a `DataClient` for a single local device agent over its REST + realtime transport. Assumption: the local agent speaks the same wire shapes as the cloud (`Channel`, `MessageStructure`, `Aggregate`, the gateway op-codes), so it reuses `RestClient` / `GatewayClient` with a different base URL and **no auth**. Any method whose capability it does not advertise is a throw-stub raising `UnsupportedCapabilityError`.

**Capability table (v1) — what `LocalAgentClient.getCapabilities()` returns:**

| Capability | Advertised? |
|---|---|
| `agents.list` | ✓ (degenerate — the one device) |
| `channels.list`, `channels.get` | ✓ |
| `aggregates.get`, `aggregates.put`, `aggregates.patch` | ✓ |
| `messages.list`, `messages.post`, `messages.put` | ✓ |
| `gateway.subscribe`, `gateway.realtime`, `gateway.oneShot` | ✓ |
| everything else (`agents.multiAgentMessages/Aggregates`, `channels.create/archive/dataSeries`, `aggregates.attachment`, `messages.listHistorical/get/delete/attachment/timeseries/invocationLogs`, `rpc.send`, all `alarms.*` / `connections.*` / `notifications.*` / `permissions.*` / `processors.*` / `turn.*` / `users.*`) | ✗ |

> `messages.put` ⇒ both `putMessage` and `patchMessage` work. `messages.get` is **not** advertised in v1 (locked decision #2). `rpc.send` is not advertised (no RPC over the local agent in v1).

### Task 12: `LocalAgentClient` skeleton — config, identity, capabilities, throw-stubs

**Files:**
- Create: `src/client/local-agent-client.ts`
- Test: `src/test/local-agent-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/local-agent-client.test.ts
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as chai from "chai";
import { describe, it } from "mocha";

import { LocalAgentClient } from "../client/local-agent-client";
import { UnsupportedCapabilityError } from "../client/errors";
import { MockWebSocket, createFetchMock } from "./helpers";

chai.use(chaiAsPromised);
const { expect: xpect } = chai;

function makeLocal(extra: Record<string, unknown> = {}) {
  return new LocalAgentClient({
    baseUrl: "http://192.168.0.7:49100",
    fetchImpl: createFetchMock() as typeof fetch,
    webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    disableBrowserLifecycleHooks: true,
    sourceId: "local:192.168.0.7:49100",
    ...extra,
  });
}

describe("LocalAgentClient", () => {
  it("advertises the v1 capability set and not the others", () => {
    const caps = makeLocal().getCapabilities();
    for (const c of ["agents.list", "channels.list", "channels.get", "aggregates.get",
      "aggregates.put", "aggregates.patch", "messages.list", "messages.post", "messages.put",
      "gateway.subscribe", "gateway.realtime", "gateway.oneShot"] as const) {
      expect(caps.has(c)).to.equal(true);
    }
    for (const c of ["messages.listHistorical", "messages.get", "channels.create",
      "channels.archive", "rpc.send", "users.me", "alarms.read"] as const) {
      expect(caps.has(c)).to.equal(false);
    }
  });

  it("throw-stubs every unadvertised method with UnsupportedCapabilityError", async () => {
    const c = makeLocal();
    await xpect(c.messages.getMessage("a", "ch", "m")).to.be.rejectedWith(UnsupportedCapabilityError);
    await xpect(c.channels.createChannel("a", "ch", {} as never)).to.be.rejectedWith(UnsupportedCapabilityError);
    await xpect(c.users.getMe()).to.be.rejectedWith(UnsupportedCapabilityError);
    await xpect(c.rpc.send({ agentId: "a", channelName: "ch" }, { method: "x", request: {} })).to.be.rejectedWith(UnsupportedCapabilityError);
    try { await c.alarms.listAlarms("a", "ch"); expect.fail("should throw"); }
    catch (e) { expect(e).to.be.instanceOf(UnsupportedCapabilityError); expect((e as UnsupportedCapabilityError).capability).to.equal("alarms.read"); expect((e as UnsupportedCapabilityError).clientId).to.equal("local:192.168.0.7:49100"); }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/local-agent-client.test.ts`
Expected: FAIL — cannot find module `../client/local-agent-client`.

- [ ] **Step 3: Write `src/client/local-agent-client.ts`** (skeleton — transport methods filled in Tasks 13–17, but write the *whole* class now with throw-stubs everywhere, then replace stubs with real impls in later tasks)

```ts
import { GatewayClient } from "../gateway/gateway-client";
import { RestClient, type DooverClientConfig } from "../http/rest-client";
import type { Capability } from "./capabilities";
import type {
  AgentScope, AgentsApiLike, AggregatesApiLike, AlarmsApiLike, ChannelsApiLike,
  ConnectionsApiLike, DataClient, DataClientStatus, GatewayClientLike,
  MessagesApiLike, NotificationsApiLike, PermissionsApiLike, ProcessorsApiLike,
  RpcDispatcherLike, TurnApiLike, UsersApiLike,
} from "./data-client";
import { UnsupportedCapabilityError } from "./errors";
import { ProvenanceStamper, wrapSubclient, type ClientIdentity } from "./provenance";
import { ClientStatusTracker } from "./status-tracker";

export interface LocalAgentClientConfig {
  /** Base URL of the local agent's REST API, e.g. "http://192.168.0.7:49100". */
  baseUrl: string;
  /** Base URL of the local agent's WebSocket gateway. Defaults to `baseUrl`
   *  with http(s)→ws(s). */
  wssUrl?: string;
  fetchImpl?: typeof fetch;
  webSocketImpl?: typeof WebSocket;
  webSocketFactory?: DooverClientConfig["webSocketFactory"];
  disableBrowserLifecycleHooks?: boolean;
  /** Stable source id. Defaults to `local:<host>:<port>` derived from baseUrl. */
  sourceId?: string;
  sourceLabel?: string;
  /** Reserved for a future LAN auth blob — ignored in v1. */
  auth?: unknown;
}

const LOCAL_CAPABILITIES: readonly Capability[] = [
  "agents.list",
  "channels.list",
  "channels.get",
  "aggregates.get",
  "aggregates.put",
  "aggregates.patch",
  "messages.list",
  "messages.post",
  "messages.put",
  "gateway.subscribe",
  "gateway.realtime",
  "gateway.oneShot",
] as const;

function deriveSourceId(baseUrl: string): string {
  try {
    const u = new URL(baseUrl);
    return `local:${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return `local:${baseUrl}`;
  }
}

function httpToWs(url: string): string {
  return url.replace(/^http/i, "ws");
}

export class LocalAgentClient implements DataClient {
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

  private readonly identity: ClientIdentity;
  private readonly capSet: ReadonlySet<Capability>;
  private readonly rest: RestClient;
  private readonly gatewayImpl: GatewayClient;
  private readonly statusTracker: ClientStatusTracker;
  /** Resolved device-agent id list; null until first resolution. */
  private resolvedScope: string[] | null = null;
  private scopeResolving: Promise<AgentScope> | null = null;

  constructor(config: LocalAgentClientConfig) {
    const sourceId = config.sourceId ?? deriveSourceId(config.baseUrl);
    this.identity = {
      id: sourceId,
      kind: "local",
      ...(config.sourceLabel ? { label: config.sourceLabel } : {}),
      meta: { baseUrl: config.baseUrl },
    };
    this.capSet = new Set(LOCAL_CAPABILITIES);
    const stamper = new ProvenanceStamper(this.identity);

    // RestClient / GatewayClient expect a DooverClientConfig — give them one
    // with the local URLs, no auth, no org/sharing headers.
    const restConfig = {
      dataRestUrl: config.baseUrl,
      controlApiUrl: config.baseUrl,
      dataWssUrl: config.wssUrl ?? httpToWs(config.baseUrl),
      organisationId: null,
      sharing: "none",
      fetchImpl: config.fetchImpl,
      webSocketImpl: config.webSocketImpl,
      webSocketFactory: config.webSocketFactory,
      disableBrowserLifecycleHooks: config.disableBrowserLifecycleHooks,
    } as unknown as DooverClientConfig;

    this.rest = new RestClient(restConfig); // no auth arg
    this.gatewayImpl = new GatewayClient(restConfig);
    this.gatewayImpl.setProvenanceHook((value, ctx) => stamper.stampGatewayEvent(value, ctx));
    this.gateway = this.gatewayImpl;

    // Real subclients for advertised methods; throw-stub proxies for the rest.
    // Implemented incrementally — see Tasks 13–17. Until then, every subclient
    // is the throw-stub. Task 13+ replace `channels`, `messages`, `aggregates`,
    // `agents` with real wrapped instances; the never-advertised ones stay stubs.
    this.agents = this.unsupportedSubclient<AgentsApiLike>("agents");      // → Task 13/16
    this.channels = this.unsupportedSubclient<ChannelsApiLike>("channels"); // → Task 13
    this.messages = this.unsupportedSubclient<MessagesApiLike>("messages"); // → Task 13/14
    this.aggregates = this.unsupportedSubclient<AggregatesApiLike>("aggregates"); // → Task 13/14
    this.alarms = this.unsupportedSubclient<AlarmsApiLike>("alarms");
    this.connections = this.unsupportedSubclient<ConnectionsApiLike>("connections");
    this.notifications = this.unsupportedSubclient<NotificationsApiLike>("notifications");
    this.permissions = this.unsupportedSubclient<PermissionsApiLike>("permissions");
    this.processors = this.unsupportedSubclient<ProcessorsApiLike>("processors");
    this.turn = this.unsupportedSubclient<TurnApiLike>("turn");
    this.users = this.unsupportedSubclient<UsersApiLike>("users");
    this.rpc = this.unsupportedSubclient<RpcDispatcherLike>("rpc");

    this.statusTracker = new ClientStatusTracker(this.identity.id, this.gateway, () => this.getKnownAgentScope());
    void stamper; // (used by Task 13+ when wrapping real subclients)
  }

  // --- capabilities ---
  getCapabilities(): ReadonlySet<Capability> { return this.capSet; }
  supports(cap: Capability): boolean { return this.capSet.has(cap); }

  // --- agent scope (implemented in Task 16) ---
  getAgentScope(): Promise<AgentScope> {
    if (this.resolvedScope) return Promise.resolve({ mode: "list", agentIds: this.resolvedScope });
    // placeholder until Task 16:
    return Promise.resolve({ mode: "list", agentIds: [] });
  }
  getKnownAgentScope(): AgentScope | "unknown" {
    return this.resolvedScope ? { mode: "list", agentIds: this.resolvedScope } : "unknown";
  }

  // --- status ---
  isConnected(): boolean { return this.gateway.isConnected(); }
  getStatus(): DataClientStatus { return this.statusTracker.getStatus(); }
  onStatusChange(listener: (status: DataClientStatus) => void): () => void {
    return this.statusTracker.onChange(listener);
  }

  /**
   * Builds a Proxy that throws `UnsupportedCapabilityError` (mapped via
   * METHOD_TO_CAPABILITY) for every method call. Used for subclients with no
   * advertised methods, and as the base others are derived from.
   */
  private unsupportedSubclient<T extends object>(name: string): T {
    const clientId = this.identity.id;
    return new Proxy({}, {
      get(_t, prop) {
        if (typeof prop !== "string") return undefined;
        return () => {
          const cap = METHOD_TO_CAPABILITY[`${name}.${prop}`] ?? guessCapability(name);
          return Promise.reject(new UnsupportedCapabilityError(cap, clientId));
        };
      },
    }) as T;
  }
}

/** Maps `"<subclient>.<method>"` → the Capability that gates it. Covers the
 *  methods a caller is likely to hit; anything not listed falls back to a
 *  per-subclient guess. Keep in sync with the subclient inventory. */
const METHOD_TO_CAPABILITY: Record<string, Capability> = {
  "agents.listAgents": "agents.list",
  "agents.getMultiAgentMessages": "agents.multiAgentMessages",
  "agents.getMultiAgentAggregates": "agents.multiAgentAggregates",
  "channels.listChannels": "channels.list",
  "channels.getChannel": "channels.get",
  "channels.createChannel": "channels.create",
  "channels.putChannel": "channels.create",
  "channels.archiveChannel": "channels.archive",
  "channels.unarchiveChannel": "channels.archive",
  "channels.listDataSeries": "channels.dataSeries",
  "aggregates.getAggregate": "aggregates.get",
  "aggregates.putAggregate": "aggregates.put",
  "aggregates.patchAggregate": "aggregates.patch",
  "aggregates.getAggregateAttachment": "aggregates.attachment",
  "messages.listMessages": "messages.list",
  "messages.postMessage": "messages.post",
  "messages.getMessage": "messages.get",
  "messages.putMessage": "messages.put",
  "messages.patchMessage": "messages.put",
  "messages.deleteMessage": "messages.delete",
  "messages.getMessageAttachment": "messages.attachment",
  "messages.getTimeseries": "messages.timeseries",
  "messages.getInvocationLogs": "messages.invocationLogs",
  "rpc.send": "rpc.send",
  "users.getMe": "users.me",
  "turn.createTurnToken": "turn.credentials",
};

function guessCapability(subclient: string): Capability {
  switch (subclient) {
    case "alarms": return "alarms.read";
    case "connections": return "connections.read";
    case "notifications": return "notifications.read";
    case "permissions": return "permissions.read";
    case "processors": return "processors.read";
    case "turn": return "turn.credentials";
    case "users": return "users.me";
    case "rpc": return "rpc.send";
    default: return "channels.get";
  }
}
```

- [ ] **Step 4: Run the test + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/local-agent-client.test.ts && npx tsc --noEmit`
Expected: PASS. (The `getMessage`/`createChannel`/etc. throw-stub assertions pass; capability table matches.)

- [ ] **Step 5: Commit**

```bash
git add src/client/local-agent-client.ts src/test/local-agent-client.test.ts
git commit -m "feat: LocalAgentClient skeleton — config, identity, capabilities, throw-stubs"
```

---

### Task 13: `LocalAgentClient` — advertised reads (`agents.listAgents`, `channels.list/get`, `aggregates.get`, `messages.list`) + `__source`

**Files:**
- Modify: `src/client/local-agent-client.ts`
- Modify: `src/test/local-agent-client.test.ts` (add cases)

- [ ] **Step 1: Add the failing tests**

```ts
  it("listChannels / getChannel / getAggregate / listMessages hit the local REST base and carry __source kind 'local'", async () => {
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith("/channels")) return createJsonResponse([{ name: "c1", is_private: false, owner_id: "o" }]);
      if (url.includes("/channels/c1/aggregate")) return createJsonResponse({ data: { v: 1 }, attachments: [] });
      if (url.includes("/channels/c1/messages")) return createJsonResponse([{ id: "m1", data: {}, attachments: [], author_id: "a", channel: { agent_id: "dev7", name: "c1" } }]);
      if (url.includes("/channels/c1")) return createJsonResponse({ name: "c1", is_private: false, owner_id: "o" });
      return createJsonResponse({});
    });
    const c = makeLocal({ fetchImpl: fetchMock as typeof fetch });
    const list = await c.channels.listChannels("dev7");
    expect(list[0].__source?.client.kind).to.equal("local");
    expect(list[0].__source?.via).to.include({ transport: "rest", method: "channels.listChannels" });
    const agg = await c.aggregates.getAggregate("dev7", "c1");
    expect(agg.__source?.client.id).to.equal("local:192.168.0.7:49100");
    const msgs = await c.messages.listMessages("dev7", "c1");
    expect(msgs[0].__source?.via).to.include({ transport: "rest" });
  });
```

(Uses `chai-as-promised`'s `createJsonResponse` import already present from helpers — add it to the file's imports.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/local-agent-client.test.ts`
Expected: FAIL — `listChannels` rejects with `UnsupportedCapabilityError` (still a stub).

- [ ] **Step 3: Implement real read subclients in `local-agent-client.ts`**

The local agent speaks the cloud wire shapes, so reuse the concrete API classes against `this.rest`, then build a per-subclient Proxy that delegates *advertised* methods to the real (provenance-wrapped) instance and throws for the rest. Replace the stub assignments and add a helper:

```ts
import { AgentsApi } from "../apis/agents-api";
import { AggregatesApi } from "../apis/aggregates-api";
import { ChannelsApi } from "../apis/channels-api";
import { MessagesApi } from "../apis/messages-api";
```

In the constructor, after `this.rest`/`stamper` are set:

```ts
    const realAgents = wrapSubclient(new AgentsApi(this.rest, config.baseUrl), "agents", stamper);
    const realChannels = wrapSubclient(new ChannelsApi(this.rest), "channels", stamper);
    const realMessages = wrapSubclient(new MessagesApi(this.rest), "messages", stamper);
    const realAggregates = wrapSubclient(new AggregatesApi(this.rest), "aggregates", stamper);

    this.agents = this.gatedSubclient<AgentsApiLike>("agents", realAgents, ["listAgents"]);
    this.channels = this.gatedSubclient<ChannelsApiLike>("channels", realChannels, ["listChannels", "getChannel"]);
    this.aggregates = this.gatedSubclient<AggregatesApiLike>("aggregates", realAggregates,
      ["getAggregate", "putAggregate", "patchAggregate"]);
    this.messages = this.gatedSubclient<MessagesApiLike>("messages", realMessages,
      ["listMessages", "postMessage", "putMessage", "patchMessage", "createMultipartPayload"]);
```

(`putAggregate`/`patchAggregate`/`postMessage`/`putMessage`/`patchMessage` are completed in Task 14 — listing them as allowed now is harmless because the underlying `RestClient` just makes the call; if you want to land reads-only first, omit the write method names here and add them in Task 14.)

Add the helper method:

```ts
  /**
   * Wraps a real (provenance-wrapped) subclient so only `allowed` method names
   * pass through; any other method call throws `UnsupportedCapabilityError`.
   */
  private gatedSubclient<T extends object>(name: string, real: object, allowed: string[]): T {
    const allowSet = new Set(allowed);
    const clientId = this.identity.id;
    return new Proxy(real, {
      get(target, prop, receiver) {
        if (typeof prop !== "string") return Reflect.get(target, prop, receiver);
        if (allowSet.has(prop)) return Reflect.get(target, prop, receiver);
        return () => {
          const cap = METHOD_TO_CAPABILITY[`${name}.${prop}`] ?? guessCapability(name);
          return Promise.reject(new UnsupportedCapabilityError(cap, clientId));
        };
      },
    }) as T;
  }
```

> Drop the now-dead `void stamper;` line and the comments about Task 13+ in Task 12's constructor.

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/local-agent-client.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/local-agent-client.ts src/test/local-agent-client.test.ts
git commit -m "feat: LocalAgentClient advertised reads (channels/aggregates/messages list+get, agents.list)"
```

---

### Task 14: `LocalAgentClient` — advertised writes (`aggregates.put/patch`, `messages.post/put`)

**Files:**
- Modify: `src/client/local-agent-client.ts` (ensure the write method names are in the `allowed` lists from Task 13 — `["getAggregate","putAggregate","patchAggregate"]`, `["listMessages","postMessage","putMessage","patchMessage","createMultipartPayload"]`)
- Modify: `src/test/local-agent-client.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
  it("postMessage / putMessage / putAggregate / patchAggregate go through to the local REST base", async () => {
    const seen: Array<{ method?: string; url: string }> = [];
    const fetchMock = createFetchMock((url, init) => {
      seen.push({ method: init?.method, url });
      if (url.includes("/messages")) return createJsonResponse({ id: "m9", data: {}, attachments: [], author_id: "a", channel: { agent_id: "dev7", name: "c1" } });
      return createJsonResponse({ data: {}, attachments: [] });
    });
    const c = makeLocal({ fetchImpl: fetchMock as typeof fetch });
    const m = await c.messages.postMessage("dev7", "c1", { hello: 1 } as never);
    expect(m.__source?.client.kind).to.equal("local");
    await c.aggregates.putAggregate("dev7", "c1", { v: 2 });
    await c.aggregates.patchAggregate("dev7", "c1", { v: 3 });
    await c.messages.putMessage("dev7", "c1", "m9", { v: 4 } as never);
    expect(seen.some((s) => s.method === "POST" && s.url.includes("/messages"))).to.equal(true);
    expect(seen.some((s) => s.method === "PUT" && s.url.includes("/aggregate"))).to.equal(true);
    expect(seen.some((s) => s.method === "PATCH" && s.url.includes("/aggregate"))).to.equal(true);
  });
```

- [ ] **Step 2: Run to verify it fails (or passes if Task 13 already allowed the writes)**

Run: `npx mocha --exit --require tsx/cjs src/test/local-agent-client.test.ts`
Expected: PASS if Task 13 already listed the write methods in `allowed`; otherwise FAIL → add them, then PASS.

- [ ] **Step 3: Run + commit**

```bash
git add src/client/local-agent-client.ts src/test/local-agent-client.test.ts
git commit -m "feat: LocalAgentClient advertised writes (aggregate put/patch, message post/put)"
```

---

### Task 15: `LocalAgentClient` — gateway + status

The gateway already exists (`this.gateway = this.gatewayImpl`). This task adds tests proving realtime works and status reflects the local link, plus `gateway.sendOneShotMessage` is reachable (it's a `GatewayClient` method already — no gating needed since the whole gateway is exposed).

**Files:**
- Modify: `src/test/local-agent-client.test.ts`

- [ ] **Step 1: Add tests**

```ts
  it("status reflects the local gateway: disconnected before connect, connected after Ready", async () => {
    const c = makeLocal();
    expect(c.isConnected()).to.equal(false);
    expect(c.getStatus().state).to.equal("disconnected");
    await c.gateway.connect();
    const ws = MockWebSocket.instances.at(-1)!;
    ws.open();
    ws.receive({ op: 0, t: "Hello", d: {} });
    ws.receive({ op: 0, t: "Ready", d: { session_id: "s1", session_token: "t", subscriptions: [] } });
    expect(c.isConnected()).to.equal(true);
    expect(c.getStatus().state).to.equal("connected");
    expect(c.getStatus().clientId).to.equal("local:192.168.0.7:49100");
  });

  it("realtime: subscribeToChannel handlers receive stamped MessageCreate", async () => {
    const c = makeLocal();
    await c.gateway.connect();
    const ws = MockWebSocket.instances.at(-1)!;
    ws.open();
    ws.receive({ op: 0, t: "Ready", d: { session_id: "s1", session_token: "t", subscriptions: [] } });
    let got: unknown;
    c.gateway.subscribeToChannel({ agent_id: "dev7", name: "c1" }, { onMessage: (m) => { got = m; } });
    ws.receive({ op: 0, t: "MessageCreate", d: { id: "m1", data: {}, attachments: [], author_id: "a", channel: { agent_id: "dev7", name: "c1" } } });
    expect((got as { __source?: { client: { kind: string } } }).__source?.client.kind).to.equal("local");
  });
```

- [ ] **Step 2: Run + commit**

Run: `npx mocha --exit --require tsx/cjs src/test/local-agent-client.test.ts`
Expected: PASS.

```bash
git add src/test/local-agent-client.test.ts
git commit -m "test: LocalAgentClient gateway + status"
```

---

### Task 16: `LocalAgentClient.getAgentScope()` — resolve & cache the device id

**Files:**
- Modify: `src/client/local-agent-client.ts`
- Modify: `src/test/local-agent-client.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
  it("getAgentScope resolves to { mode: 'list', agentIds: [deviceId] } via listAgents, caches it, and getKnownAgentScope is 'unknown' first", async () => {
    let agentCalls = 0;
    const fetchMock = createFetchMock((url) => {
      if (url.includes("/agents")) { agentCalls += 1; return createJsonResponse({ agents: [{ id: "dev7", name: "Device 7" }] }); }
      return createJsonResponse({});
    });
    const c = makeLocal({ fetchImpl: fetchMock as typeof fetch });
    expect(c.getKnownAgentScope()).to.equal("unknown");
    const scope = await c.getAgentScope();
    expect(scope).to.deep.equal({ mode: "list", agentIds: ["dev7"] });
    expect(c.getKnownAgentScope()).to.deep.equal({ mode: "list", agentIds: ["dev7"] });
    await c.getAgentScope(); // cached
    expect(agentCalls).to.equal(1);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/local-agent-client.test.ts`
Expected: FAIL — `getAgentScope()` returns `{ mode: "list", agentIds: [] }` (placeholder).

- [ ] **Step 3: Implement `getAgentScope` and connect-time kickoff**

Replace the placeholder `getAgentScope` body:

```ts
  getAgentScope(): Promise<AgentScope> {
    if (this.resolvedScope) return Promise.resolve({ mode: "list", agentIds: this.resolvedScope });
    if (this.scopeResolving) return this.scopeResolving;
    this.scopeResolving = (async () => {
      try {
        // The local agent represents one device. Locked decision #10: derive the
        // id from listAgents()[0].id (no assumed whoami endpoint).
        const res = await this.agents.listAgents();
        const first = (res?.agents ?? res?.results ?? [])[0];
        const id = first?.id;
        this.resolvedScope = id ? [String(id)] : [];
      } catch {
        this.resolvedScope = [];
      } finally {
        this.scopeResolving = null;
        this.statusTracker.notifyScopeChanged();
      }
      return { mode: "list", agentIds: this.resolvedScope! };
    })();
    return this.scopeResolving;
  }
```

Add reconnect invalidation + connect-time kickoff in the constructor, after `this.gatewayImpl` is created:

```ts
    // Resolve the device id on (re)connect so routing is precise before the
    // first agent-scoped request; invalidate the cache on each new session.
    this.gatewayImpl.on("ready", () => {
      this.resolvedScope = null;
      void this.getAgentScope();
    });
```

> If `listAgents` itself throws (`UnsupportedCapabilityError`) — it won't, since `agents.list` is advertised — the `catch` leaves the scope empty.

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/local-agent-client.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/local-agent-client.ts src/test/local-agent-client.test.ts
git commit -m "feat: LocalAgentClient.getAgentScope resolves & caches the device id"
```

---

### Task 17: Export `LocalAgentClient`

**Files:**
- Modify: `src/index.ts`
- Modify: `src/test/exports.test.ts`

- [ ] **Step 1: Add the test case**

```ts
  it("exports LocalAgentClient", () => {
    expect(doover.LocalAgentClient).to.be.a("function");
  });
```

- [ ] **Step 2: Run to verify it fails; then add the export**

In `src/index.ts`:

```ts
export { LocalAgentClient } from "./client/local-agent-client";
export type { LocalAgentClientConfig } from "./client/local-agent-client";
```

- [ ] **Step 3: Run + commit**

Run: `npx mocha --exit --require tsx/cjs src/test/exports.test.ts && npm test`
Expected: all green.

```bash
git add src/index.ts src/test/exports.test.ts
git commit -m "feat: export LocalAgentClient"
```

---

## Phase 4 — `MultiplexClient`

The "DooverClientLike aggregator" handed to `DooverProvider` by a multi-source consumer. It owns a persistent `Map<sourceId, RegisteredSource>`; members are built lazily once via a `factory` and reused forever. Reads fan out over enabled members and merge; writes route to exactly one; the gateway is a composite; capabilities are the union of enabled members'.

**File layout for this phase:**
- `src/client/multiplex-client.ts` — registry/activation, capabilities, status/scope, the subclient facades, conflicts.
- `src/client/multiplex-gateway.ts` — `MultiplexGateway` (composite `GatewayClientLike`).
- `src/client/multiplex-merge.ts` — pure merge helpers (`mergeMessages`, `dedupeBy`, …) — easy to unit-test in isolation.

### Task 18: `multiplex-merge.ts` — pure merge helpers

**Files:**
- Create: `src/client/multiplex-merge.ts`
- Test: `src/test/multiplex-merge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/multiplex-merge.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { dedupeBy, mergeMessages } from "../client/multiplex-merge";

describe("multiplex merge helpers", () => {
  it("dedupeBy keeps the first occurrence", () => {
    const out = dedupeBy([{ id: "a", n: 1 }, { id: "b", n: 2 }, { id: "a", n: 3 }], (x) => x.id);
    expect(out).to.deep.equal([{ id: "a", n: 1 }, { id: "b", n: 2 }]);
  });

  it("mergeMessages: dedup by id, sort to requested order, re-apply limit", () => {
    const a = [{ id: "5" }, { id: "3" }, { id: "1" }];
    const b = [{ id: "4" }, { id: "3" }, { id: "2" }];
    const desc = mergeMessages([a, b] as never, { order: "desc", limit: 4 });
    expect(desc.map((m) => (m as { id: string }).id)).to.deep.equal(["5", "4", "3", "2"]);
    const asc = mergeMessages([a, b] as never, { order: "asc", limit: 3 });
    expect(asc.map((m) => (m as { id: string }).id)).to.deep.equal(["1", "2", "3"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-merge.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write `src/client/multiplex-merge.ts`**

```ts
import type { MessageStructure } from "../types/common";

/** Keep the first item for each key; preserve input order otherwise. */
export function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = keyOf(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/** Compare two snowflake-ish id strings numerically when possible, else lexically. */
function compareIds(a: string, b: string): number {
  // Snowflakes are big — compare as BigInt when both parse, else string compare.
  try {
    const ba = BigInt(a);
    const bb = BigInt(b);
    return ba < bb ? -1 : ba > bb ? 1 : 0;
  } catch {
    return a < b ? -1 : a > b ? 1 : 0;
  }
}

/**
 * Merge per-member message arrays: concatenate, de-dup by `id` (first member
 * wins), sort by id to match `order` ("desc" = newest first, the cloud's
 * native order; "asc" = oldest first), then truncate to `limit` if given.
 */
export function mergeMessages(
  perMember: MessageStructure[][],
  opts: { order: "asc" | "desc"; limit?: number },
): MessageStructure[] {
  const all = ([] as MessageStructure[]).concat(...perMember);
  const unique = dedupeBy(all, (m) => m.id);
  unique.sort((x, y) => {
    const c = compareIds(x.id, y.id);
    return opts.order === "asc" ? c : -c;
  });
  return typeof opts.limit === "number" ? unique.slice(0, opts.limit) : unique;
}
```

- [ ] **Step 4: Run + commit**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-merge.test.ts`
Expected: PASS.

```bash
git add src/client/multiplex-merge.ts src/test/multiplex-merge.test.ts
git commit -m "feat: multiplex merge helpers (dedupeBy, mergeMessages)"
```

---

### Task 19: `MultiplexClient` registry & activation

**Files:**
- Create: `src/client/multiplex-client.ts`
- Test: `src/test/multiplex-registry.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/multiplex-registry.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";
import sinon from "sinon";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

// A no-op DataClient stub with a controllable connected flag + gateway events.
function stubMember(id: string): DataClient & { _setConnected(v: boolean): void; _emit(): void; gatewayListeners: Set<() => void> } {
  let connected = false;
  let disposed = false;
  const gwListeners = new Set<() => void>();
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  const statusListeners = new Set<(s: unknown) => void>();
  return {
    agents: noop, channels: noop, messages: noop, aggregates: noop, alarms: noop,
    connections: noop, notifications: noop, permissions: noop, processors: noop,
    turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => { connected = false; }, reconnect: async () => {},
      on: (_e: string, h: () => void) => gwListeners.add(h), off: (_e: string, h: () => void) => gwListeners.delete(h),
      subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {},
      sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => connected,
      getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(["channels.list", "channels.get"] as const),
    supports: (c: string) => c === "channels.list" || c === "channels.get",
    isConnected: () => connected,
    getStatus: () => ({ clientId: id, connected, state: connected ? "connected" : "disconnected", agentScope: "all" as const, at: Date.now() }),
    onStatusChange: (l: (s: unknown) => void) => { statusListeners.add(l); return () => statusListeners.delete(l); },
    getAgentScope: async () => ({ mode: "all" as const }),
    getKnownAgentScope: () => ({ mode: "all" as const }),
    _setConnected(v: boolean) { connected = v; statusListeners.forEach((l) => l(undefined)); },
    _emit() { gwListeners.forEach((h) => h()); },
    gatewayListeners: gwListeners,
  } as never;
}

describe("MultiplexClient registry & activation", () => {
  it("builds a member via factory exactly once and reuses it on re-enable", () => {
    const built: Record<string, number> = {};
    const factory = sinon.spy((d: SourceDescriptor) => { built[d.id] = (built[d.id] ?? 0) + 1; return stubMember(d.id); });
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }], enable: ["cloud"] });
    expect(built.cloud).to.equal(1);
    mux.disableSource("cloud");
    mux.enableSource("cloud");
    expect(built.cloud).to.equal(1); // not rebuilt
    expect(mux.getActiveSources().map((s) => s.descriptor.id)).to.deep.equal(["cloud"]);
  });

  it("registerSource is idempotent on id (updates metadata only)", () => {
    const factory = sinon.spy((d: SourceDescriptor) => stubMember(d.id));
    const mux = new MultiplexClient({ factory });
    mux.registerSource({ id: "local:1", kind: "local", label: "A" });
    mux.registerSource({ id: "local:1", kind: "local", label: "B" });
    expect(mux.getRegisteredSources()).to.have.length(1);
    expect(mux.getRegisteredSources()[0].descriptor.label).to.equal("B");
    expect(factory.called).to.equal(false); // registering doesn't build
  });

  it("setActiveSources enables/disables to match exactly and is a no-op when unchanged", () => {
    const factory = sinon.spy((d: SourceDescriptor) => stubMember(d.id));
    const mux = new MultiplexClient({ factory });
    mux.setActiveSources([{ id: "cloud", kind: "cloud" }, { id: "local:1", kind: "local" }]);
    expect(mux.getActiveSources().map((s) => s.descriptor.id).sort()).to.deep.equal(["cloud", "local:1"]);
    const before = factory.callCount;
    mux.setActiveSources(["local:1", "cloud"]); // same set, different order → no-op
    expect(factory.callCount).to.equal(before);
    mux.setActiveSources(["cloud"]); // disable local:1
    expect(mux.getActiveSources().map((s) => s.descriptor.id)).to.deep.equal(["cloud"]);
    expect(mux.getRegisteredSources()).to.have.length(2); // still registered
  });

  it("disableSource keeps the client and (default) disconnects its gateway; removeSource discards", () => {
    const member = stubMember("local:1");
    const factory = () => member as never;
    const mux = new MultiplexClient({ factory, register: [{ id: "local:1", kind: "local" }], enable: ["local:1"] });
    member._setConnected(true);
    const disc = sinon.spy(member.gateway, "disconnect");
    mux.disableSource("local:1");
    expect(disc.called).to.equal(true);
    expect(mux.getRegisteredSources()[0].client).to.equal(member); // kept
    mux.removeSource("local:1");
    expect(mux.getRegisteredSources()).to.have.length(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-registry.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Write the registry portion of `src/client/multiplex-client.ts`**

```ts
import type { Capability } from "./capabilities";
import type {
  AgentScope, AgentsApiLike, AggregatesApiLike, AlarmsApiLike, ChannelsApiLike,
  ConnectionsApiLike, DataClient, DataClientStatus, GatewayClientLike,
  MessagesApiLike, NotificationsApiLike, PermissionsApiLike, ProcessorsApiLike,
  RpcDispatcherLike, TurnApiLike, UsersApiLike,
} from "./data-client";

export type { DataClient } from "./data-client";

/** A serialisable description of a source. */
export interface SourceDescriptor {
  /** Stable id, also the registry key (e.g. "cloud", "local:192.168.0.1:49100"). */
  id: string;
  /** Source kind — selects the factory branch. */
  kind: string;
  /** Kind-specific params (e.g. { host, port } for "local"). */
  params?: Record<string, unknown>;
  /** Optional human label. */
  label?: string;
}

export interface RegisteredSource {
  descriptor: SourceDescriptor;
  /** Resolved lazily on first enable; undefined until then. */
  client?: DataClient;
  enabled: boolean;
}

export interface MultiplexClientOptions {
  /** Builds a DataClient for a not-yet-seen descriptor. Called at most once per id. */
  factory: (descriptor: SourceDescriptor) => DataClient | Promise<DataClient>;
  /** Descriptors to pre-register (not necessarily enabled). */
  register?: SourceDescriptor[];
  /** Ids to enable initially (or pass `enableAll`). */
  enable?: string[];
  /** Enable every `register` id initially. */
  enableAll?: boolean;
  /** When a source is disabled, also disconnect its gateway? Default true. */
  disconnectOnDisable?: boolean;
  /** Id reported in `getStatus().clientId`. Default "multiplex". */
  clientId?: string;
}

type MuxEvent = "change" | "conflict";

export class MultiplexClient implements DataClient {
  // subclient facades — assigned in the constructor (Task 22+ fill the bodies)
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

  private readonly registry = new Map<string, RegisteredSource>();
  private readonly factory: MultiplexClientOptions["factory"];
  private readonly disconnectOnDisable: boolean;
  private readonly clientId: string;
  private readonly eventListeners = new Map<MuxEvent, Set<(...args: unknown[]) => void>>();
  private capabilitiesCache: ReadonlySet<Capability> | null = null;

  constructor(options: MultiplexClientOptions) {
    this.factory = options.factory;
    this.disconnectOnDisable = options.disconnectOnDisable ?? true;
    this.clientId = options.clientId ?? "multiplex";

    for (const d of options.register ?? []) this.registerSource(d);
    const toEnable = options.enableAll
      ? (options.register ?? []).map((d) => d.id)
      : (options.enable ?? []);
    for (const id of toEnable) this.enableSource(id);

    // Subclient facades + composite gateway — see Tasks 22, 24, 26.
    this.agents = this.makeReadFacade<AgentsApiLike>("agents");
    this.channels = this.makeReadFacade<ChannelsApiLike>("channels");
    this.messages = this.makeReadFacade<MessagesApiLike>("messages");
    this.aggregates = this.makeReadFacade<AggregatesApiLike>("aggregates");
    this.alarms = this.makeReadFacade<AlarmsApiLike>("alarms");
    this.connections = this.makeReadFacade<ConnectionsApiLike>("connections");
    this.notifications = this.makeReadFacade<NotificationsApiLike>("notifications");
    this.permissions = this.makeReadFacade<PermissionsApiLike>("permissions");
    this.processors = this.makeReadFacade<ProcessorsApiLike>("processors");
    this.turn = this.makeReadFacade<TurnApiLike>("turn");
    this.users = this.makeReadFacade<UsersApiLike>("users");
    this.rpc = this.makeRpcFacade();
    this.gateway = this.makeCompositeGateway();
  }

  // ===== registry / activation =====

  registerSource(descriptor: SourceDescriptor): void {
    const existing = this.registry.get(descriptor.id);
    if (existing) {
      // idempotent: update metadata only, never rebuild the client
      existing.descriptor = { ...existing.descriptor, ...descriptor };
      return;
    }
    this.registry.set(descriptor.id, { descriptor, enabled: false });
  }

  setActiveSources(idsOrDescriptors: Array<string | SourceDescriptor>): void {
    const wanted = new Set<string>();
    for (const item of idsOrDescriptors) {
      if (typeof item === "string") {
        if (!this.registry.has(item)) {
          throw new Error(`MultiplexClient.setActiveSources: unknown source id "${item}" — pass a descriptor to auto-register.`);
        }
        wanted.add(item);
      } else {
        this.registerSource(item);
        wanted.add(item.id);
      }
    }
    const currentlyEnabled = new Set(
      [...this.registry.values()].filter((s) => s.enabled).map((s) => s.descriptor.id),
    );
    const same = wanted.size === currentlyEnabled.size && [...wanted].every((id) => currentlyEnabled.has(id));
    if (same) return; // no-op
    for (const id of currentlyEnabled) if (!wanted.has(id)) this.disableSource(id, { silent: true });
    for (const id of wanted) if (!currentlyEnabled.has(id)) this.enableSource(id, { silent: true });
    this.invalidateCapabilities();
    this.emit("change");
  }

  enableSource(id: string, opts?: { silent?: boolean }): void {
    const src = this.registry.get(id);
    if (!src) throw new Error(`MultiplexClient.enableSource: unknown source id "${id}".`);
    if (src.enabled) return;
    if (!src.client) {
      const built = this.factory(src.descriptor);
      if (built instanceof Promise) {
        // Async factory: enable now, attach the client when it resolves.
        src.enabled = true;
        void built.then((client) => {
          src.client = client;
          this.attachMemberListeners(src);
          this.invalidateCapabilities();
          this.emit("change");
        });
        if (!opts?.silent) { this.invalidateCapabilities(); this.emit("change"); }
        return;
      }
      src.client = built;
    }
    src.enabled = true;
    this.attachMemberListeners(src);
    if (!opts?.silent) { this.invalidateCapabilities(); this.emit("change"); }
  }

  disableSource(id: string, opts?: { silent?: boolean }): void {
    const src = this.registry.get(id);
    if (!src || !src.enabled) return;
    src.enabled = false;
    this.detachMemberListeners(src);
    if (this.disconnectOnDisable && src.client) {
      try { src.client.gateway.disconnect(); } catch { /* ignore */ }
    }
    if (!opts?.silent) { this.invalidateCapabilities(); this.emit("change"); }
  }

  removeSource(id: string): void {
    const src = this.registry.get(id);
    if (!src) return;
    if (src.enabled) this.disableSource(id, { silent: true });
    else if (src.client) { try { src.client.gateway.disconnect(); } catch { /* ignore */ } }
    this.registry.delete(id);
    this.invalidateCapabilities();
    this.emit("change");
  }

  getActiveSources(): readonly RegisteredSource[] {
    return [...this.registry.values()].filter((s) => s.enabled);
  }
  getRegisteredSources(): readonly RegisteredSource[] {
    return [...this.registry.values()];
  }

  /** Enabled members that have a built `client`. */
  protected enabledClients(): Array<{ id: string; src: RegisteredSource; client: DataClient }> {
    return this.getActiveSources()
      .filter((s): s is RegisteredSource & { client: DataClient } => !!s.client)
      .map((s) => ({ id: s.descriptor.id, src: s, client: s.client }));
  }

  // ===== events (change, conflict) =====
  on(event: MuxEvent, handler: (...args: unknown[]) => void): void {
    (this.eventListeners.get(event) ?? this.eventListeners.set(event, new Set()).get(event)!).add(handler);
  }
  off(event: MuxEvent, handler: (...args: unknown[]) => void): void {
    this.eventListeners.get(event)?.delete(handler);
  }
  protected emit(event: MuxEvent, ...args: unknown[]): void {
    this.eventListeners.get(event)?.forEach((h) => h(...args));
  }

  private invalidateCapabilities(): void { this.capabilitiesCache = null; }

  // --- placeholders filled in later tasks ---
  private attachMemberListeners(_src: RegisteredSource): void { /* Task 27 */ }
  private detachMemberListeners(_src: RegisteredSource): void { /* Task 27 */ }
  private makeReadFacade<T extends object>(_name: string): T { return {} as T; } // Task 22/24
  private makeRpcFacade(): RpcDispatcherLike { return {} as RpcDispatcherLike; } // Task 24
  private makeCompositeGateway(): GatewayClientLike { return {} as GatewayClientLike; } // Task 26

  // --- DataClient: capabilities/scope/status — placeholders, filled in Tasks 20, 27 ---
  getCapabilities(): ReadonlySet<Capability> {
    if (!this.capabilitiesCache) {
      const u = new Set<Capability>();
      for (const { client } of this.enabledClients()) for (const c of client.getCapabilities()) u.add(c);
      this.capabilitiesCache = u;
    }
    return this.capabilitiesCache;
  }
  supports(cap: Capability): boolean { return this.getCapabilities().has(cap); }
  isConnected(): boolean { return false; }                       // Task 27
  getStatus(): DataClientStatus { return { clientId: this.clientId, connected: false, state: "disconnected", agentScope: "unknown", at: Date.now() }; } // Task 27
  onStatusChange(_l: (s: DataClientStatus) => void): () => void { return () => {}; } // Task 27
  getAgentScope(): Promise<AgentScope> { return Promise.resolve({ mode: "list", agentIds: [] }); } // Task 21/27
  getKnownAgentScope(): AgentScope | "unknown" { return "unknown"; } // Task 21/27
}
```

> The `getCapabilities()` here is already correct (union over enabled members) — Task 20 just adds tests + the no-member-supports throw path lives in the facades (Task 24). The other `DataClient` methods are stubs to be replaced in Tasks 21 & 27.

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-registry.test.ts && npx tsc --noEmit`
Expected: PASS (registry tests). Note the `gateway` stub in the test calls `member.gateway.disconnect` — `disableSource` calls it; sinon spy sees it.

- [ ] **Step 5: Commit**

```bash
git add src/client/multiplex-client.ts src/test/multiplex-registry.test.ts
git commit -m "feat: MultiplexClient registry & activation (register/enable/disable/remove/setActiveSources)"
```

---

### Task 20: `MultiplexClient.getCapabilities()` — union over enabled members

**Files:**
- Modify: `src/test/multiplex-registry.test.ts` (or a new `src/test/multiplex-capabilities.test.ts`)

- [ ] **Step 1: Add the test**

```ts
// src/test/multiplex-capabilities.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

function memberWithCaps(id: string, caps: string[]): DataClient {
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: noop, channels: noop, messages: noop, aggregates: noop, alarms: noop, connections: noop,
    notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {},
      subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {},
      sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0,
      getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(caps as never),
    supports: (c: string) => caps.includes(c),
    isConnected: () => false,
    getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: "all" as const, at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => ({ mode: "all" as const }),
    getKnownAgentScope: () => ({ mode: "all" as const }),
  } as never;
}

describe("MultiplexClient capabilities", () => {
  it("is the union over enabled members; recomputed on enable/disable", () => {
    const factory = (d: SourceDescriptor) =>
      d.id === "cloud" ? memberWithCaps("cloud", ["channels.list", "messages.listHistorical"])
        : memberWithCaps("local", ["channels.list", "messages.list"]);
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local", kind: "local" }], enable: ["cloud"] });
    expect([...mux.getCapabilities()].sort()).to.deep.equal(["channels.list", "messages.listHistorical"]);
    mux.enableSource("local");
    expect([...mux.getCapabilities()].sort()).to.deep.equal(["channels.list", "messages.list", "messages.listHistorical"]);
    mux.disableSource("cloud");
    expect([...mux.getCapabilities()].sort()).to.deep.equal(["channels.list", "messages.list"]);
    expect(mux.supports("messages.list")).to.equal(true);
    expect(mux.supports("messages.listHistorical")).to.equal(false);
  });
});
```

- [ ] **Step 2: Run + commit**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-capabilities.test.ts`
Expected: PASS.

```bash
git add src/test/multiplex-capabilities.test.ts
git commit -m "test: MultiplexClient.getCapabilities is the union over enabled members"
```

---

### Task 21: Agent-scope routing helper + `getAgentScope()` rollup

**Files:**
- Modify: `src/client/multiplex-client.ts`
- Test: `src/test/multiplex-routing.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/multiplex-routing.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { AgentScope, DataClient, SourceDescriptor } from "../client/multiplex-client";

function member(id: string, scope: () => AgentScope | "unknown", caps: string[] = ["channels.get"]): DataClient {
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: noop, channels: noop, messages: noop, aggregates: noop, alarms: noop, connections: noop,
    notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {},
      subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {},
      sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0,
      getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(caps as never), supports: (c: string) => caps.includes(c),
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: scope(), at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => { const s = scope(); return s === "unknown" ? { mode: "list", agentIds: [] } : s; },
    getKnownAgentScope: scope,
  } as never;
}

describe("MultiplexClient agent-scope routing", () => {
  it("membersForAgent: cloud (scope 'all') always included; local iff its list has the agent; 'unknown' included optimistically", () => {
    let localScope: AgentScope | "unknown" = "unknown";
    const factory = (d: SourceDescriptor) =>
      d.id === "cloud" ? member("cloud", () => ({ mode: "all" }))
        : member("local", () => localScope);
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local", kind: "local" }], enableAll: true });
    const m = mux as unknown as { membersForAgent(agentId: string): Array<{ id: string }> };
    expect(m.membersForAgent("dev7").map((x) => x.id).sort()).to.deep.equal(["cloud", "local"]); // local unknown → optimistic
    localScope = { mode: "list", agentIds: ["dev9"] };
    expect(m.membersForAgent("dev7").map((x) => x.id)).to.deep.equal(["cloud"]); // local now excluded
    localScope = { mode: "list", agentIds: ["dev7"] };
    expect(m.membersForAgent("dev7").map((x) => x.id).sort()).to.deep.equal(["cloud", "local"]);
  });

  it("getAgentScope rollup: 'all' if any enabled member is 'all'; else union list", async () => {
    const factory = (d: SourceDescriptor) =>
      d.id === "cloud" ? member("cloud", () => ({ mode: "all" }))
        : member(d.id, () => ({ mode: "list", agentIds: [d.id.replace("local:", "")] }));
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:a", kind: "local" }, { id: "local:b", kind: "local" }], enableAll: true });
    expect(await mux.getAgentScope()).to.deep.equal({ mode: "all" });
    mux.disableSource("cloud");
    const rolled = await mux.getAgentScope();
    expect(rolled).to.deep.equal({ mode: "list", agentIds: ["a", "b"] });
    expect(mux.getKnownAgentScope()).to.deep.equal({ mode: "list", agentIds: ["a", "b"] });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-routing.test.ts`
Expected: FAIL — `membersForAgent` not a function / `getAgentScope` returns `[]`.

- [ ] **Step 3: Implement in `multiplex-client.ts`** — replace the `getAgentScope`/`getKnownAgentScope` stubs and add `membersForAgent`:

```ts
  /**
   * Enabled members eligible for a request targeting `agentId`: those whose
   * scope is `{ mode: "all" }` (the cloud — no enumeration), those whose list
   * contains `agentId`, and those whose scope is still `"unknown"` (included
   * optimistically; their scope settles for the next call). If `agentId` is
   * undefined (a non-agent-scoped read), all enabled members are eligible.
   */
  protected membersForAgent(agentId?: string): Array<{ id: string; src: RegisteredSource; client: DataClient }> {
    const all = this.enabledClients();
    if (agentId === undefined) return all;
    return all.filter(({ client }) => {
      const scope = client.getKnownAgentScope();
      if (scope === "unknown") return true; // optimistic
      if (scope.mode === "all") return true;
      return scope.agentIds.includes(agentId);
    });
  }

  /** Members (enabled) that both own `agentId` and advertise `cap`. */
  protected membersForAgentWithCapability(agentId: string | undefined, cap: Capability) {
    return this.membersForAgent(agentId).filter(({ client }) => client.supports(cap));
  }

  getAgentScope(): Promise<AgentScope> {
    return Promise.all(this.enabledClients().map(({ client }) => client.getAgentScope())).then((scopes) => {
      if (scopes.some((s) => s.mode === "all")) return { mode: "all" };
      const ids = new Set<string>();
      for (const s of scopes) if (s.mode === "list") for (const id of s.agentIds) ids.add(id);
      return { mode: "list", agentIds: [...ids] };
    });
  }

  getKnownAgentScope(): AgentScope | "unknown" {
    const known = this.enabledClients().map(({ client }) => client.getKnownAgentScope());
    if (known.some((s) => s !== "unknown" && s.mode === "all")) return { mode: "all" };
    if (known.some((s) => s === "unknown")) return "unknown";
    const ids = new Set<string>();
    for (const s of known) if (s !== "unknown" && s.mode === "list") for (const id of s.agentIds) ids.add(id);
    return { mode: "list", agentIds: [...ids] };
  }
```

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-routing.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/multiplex-client.ts src/test/multiplex-routing.test.ts
git commit -m "feat: MultiplexClient agent-scope routing helper + getAgentScope rollup"
```

---

### Task 22: Read fan-out & merge — core methods + `sources?` options bag

**Files:**
- Modify: `src/client/multiplex-client.ts`
- Test: `src/test/multiplex-reads.test.ts`

This task implements the `channels`, `aggregates`, `messages`, `agents` facades for the **core** methods. Each facade is a hand-written object (not a Proxy) so the merge rules are explicit. The optional trailing `{ sources?: string[] }` options bag is appended to every read method's existing parameter list.

**Routing/merge rules to implement (from the spec's table):**

| Method | Capability | Agent? | Merge |
|---|---|---|---|
| `agents.listAgents(opts?)` | `agents.list` | no | concat all members' `.agents`/`.results`; dedupe by agent `id` (first member wins); return same response shape with merged `agents`+`results`+`count`. |
| `agents.getMultiAgentMessages(channelName, params, opts?)` | `agents.multiAgentMessages` | no | concat `.results`; dedupe by `id`; sort desc; same response shape with merged `results`+`count`. |
| `agents.getMultiAgentAggregates(channelName, params, opts?)` | `agents.multiAgentAggregates` | no | concat `.results`; dedupe by `agent_id`; same shape. |
| `channels.listChannels(agentId, opts?)` | `channels.list` | yes | concat arrays; dedupe by channel `name` (first member wins). |
| `channels.getChannel(agentId, name, opts?)` | `channels.get` | yes | first owning member's value; if 2+ returned and differ → record conflict. |
| `aggregates.getAggregate(agentId, name, opts?)` | `aggregates.get` | yes | first owning member's value; conflict if 2+ differ. |
| `messages.listMessages(agentId, name, params?, opts?)` | `messages.list` (or `messages.listHistorical` if params imply deep history — see note) | yes | `mergeMessages(perMember, { order, limit })`. |
| `messages.getMessage(agentId, name, id, opts?)` | `messages.get` | yes | first member that returns a non-404 message. |
| attachments (`getAggregateAttachment`, `getMessageAttachment`) | `aggregates.attachment` / `messages.attachment` | yes | first member that returns a `Blob`. |

> **Historical-window detection:** treat the call as needing `messages.listHistorical` if `params.after` is set OR `params.before` is older than ~24h ago (compare the snowflake's embedded timestamp; reuse `extractSnowflakeId` from `src/utils/snowflake.ts`). Otherwise `messages.list`. A member is eligible if it has *either* the implied capability *or* `messages.list` when the window is "latest N". Keep this in a small `requiredMessagesCapability(params)` helper.

- [ ] **Step 1: Write the failing test**

```ts
// src/test/multiplex-reads.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

// Helper that builds a member whose subclients return canned values + record __source.
function dataMember(id: string, opts: {
  scope?: { mode: "all" } | { mode: "list"; agentIds: string[] };
  caps?: string[];
  channels?: Record<string, { name: string; is_private: boolean; owner_id: string }[]>;
  channel?: Record<string, { name: string; v: number }>;
  aggregate?: Record<string, { data: unknown; attachments: unknown[] }>;
  messages?: Record<string, { id: string }[]>;
  agents?: { id: string }[];
}): DataClient {
  const scope = opts.scope ?? { mode: "all" as const };
  const caps = new Set(opts.caps ?? ["agents.list", "channels.list", "channels.get", "aggregates.get", "messages.list"]);
  const src = (method: string) => ({ client: { id, kind: id.startsWith("local") ? "local" : "cloud" }, retrievedAt: Date.now(), via: { transport: "rest" as const, method, request: {}, startedAt: 0, durationMs: 1 } });
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: { listAgents: async () => ({ agents: (opts.agents ?? []).map((a) => ({ ...a, __source: src("agents.listAgents") })) }) } as never,
    channels: {
      listChannels: async (agentId: string) => (opts.channels?.[agentId] ?? []).map((c) => ({ ...c, __source: src("channels.listChannels") })),
      getChannel: async (agentId: string, name: string) => { const c = opts.channel?.[`${agentId}/${name}`]; if (!c) { const e = new Error("404") as Error & { status: number }; e.status = 404; throw e; } return { ...c, __source: src("channels.getChannel") }; },
    } as never,
    aggregates: {
      getAggregate: async (agentId: string, name: string) => { const a = opts.aggregate?.[`${agentId}/${name}`]; if (!a) { const e = new Error("404") as Error & { status: number }; e.status = 404; throw e; } return { ...a, __source: src("aggregates.getAggregate") }; },
    } as never,
    messages: {
      listMessages: async (agentId: string, name: string) => (opts.messages?.[`${agentId}/${name}`] ?? []).map((m) => ({ ...m, data: {}, attachments: [], author_id: "a", channel: { agent_id: agentId, name }, __source: src("messages.listMessages") })),
    } as never,
    alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => caps as never, supports: (c: string) => caps.has(c),
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: scope, at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => scope, getKnownAgentScope: () => scope,
  } as never;
}

describe("MultiplexClient reads", () => {
  function mk(members: Record<string, DataClient>) {
    const factory = (d: SourceDescriptor) => members[d.id];
    return new MultiplexClient({ factory, register: Object.keys(members).map((id) => ({ id, kind: id.startsWith("local") ? "local" : "cloud" })), enableAll: true });
  }

  it("listChannels merges + dedupes by name across owning members; items keep their member __source", async () => {
    const mux = mk({
      cloud: dataMember("cloud", { scope: { mode: "all" }, channels: { dev7: [{ name: "a", is_private: false, owner_id: "o" }, { name: "shared", is_private: false, owner_id: "o" }] } }),
      "local:1": dataMember("local:1", { scope: { mode: "list", agentIds: ["dev7"] }, channels: { dev7: [{ name: "b", is_private: false, owner_id: "o" }, { name: "shared", is_private: false, owner_id: "o" }] } }),
    });
    const list = await mux.channels.listChannels("dev7");
    expect(list.map((c) => c.name).sort()).to.deep.equal(["a", "b", "shared"]);
    const shared = list.find((c) => c.name === "shared")!;
    expect(shared.__source?.client.id).to.equal("cloud"); // first member wins
    // sources-scoped → only local:1
    const onlyLocal = await mux.channels.listChannels("dev7", { sources: ["local:1"] });
    expect(onlyLocal.map((c) => c.name).sort()).to.deep.equal(["b", "shared"]);
  });

  it("getChannel: only the local member owns dev9 → returns its value", async () => {
    const mux = mk({
      cloud: dataMember("cloud", { scope: { mode: "all" }, channel: { "dev7/c": { name: "c", v: 1 } } }),
      "local:9": dataMember("local:9", { scope: { mode: "list", agentIds: ["dev9"] }, channel: { "dev9/c": { name: "c", v: 99 } } }),
    });
    // cloud is 'all' so it's also asked for dev9, but its getChannel 404s → ignored.
    const ch = await mux.channels.getChannel("dev9", "c");
    expect((ch as unknown as { v: number }).v).to.equal(99);
    expect(ch.__source?.client.id).to.equal("local:9");
  });

  it("listMessages merges by id, dedupes, re-applies limit", async () => {
    const mux = mk({
      cloud: dataMember("cloud", { scope: { mode: "all" }, messages: { "dev7/c": [{ id: "5" }, { id: "3" }, { id: "1" }] } }),
      "local:1": dataMember("local:1", { scope: { mode: "list", agentIds: ["dev7"] }, caps: ["messages.list", "channels.get"], messages: { "dev7/c": [{ id: "4" }, { id: "3" }, { id: "2" }] } }),
    });
    const msgs = await mux.messages.listMessages("dev7", "c", { limit: 4, order: "desc" });
    expect(msgs.map((m) => m.id)).to.deep.equal(["5", "4", "3", "2"]);
    const m3 = msgs.find((m) => m.id === "3")!;
    expect(m3.__source?.client.id).to.equal("cloud");
  });

  it("listAgents concatenates members' agents and dedupes by id", async () => {
    const mux = mk({
      cloud: dataMember("cloud", { agents: [{ id: "dev7" }, { id: "dev8" }] }),
      "local:7": dataMember("local:7", { agents: [{ id: "dev7" }] }),
    });
    const res = await mux.agents.listAgents();
    expect((res.agents ?? []).map((a) => a.id).sort()).to.deep.equal(["dev7", "dev8"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-reads.test.ts`
Expected: FAIL — `mux.channels.listChannels` is `undefined` (facade stub returns `{}`).

- [ ] **Step 3: Implement the core read facades in `multiplex-client.ts`**

Add imports: `import { dedupeBy, mergeMessages } from "./multiplex-merge";` and `import { extractSnowflakeId } from "../utils/snowflake";` and `import { UnsupportedCapabilityError } from "./errors";`. Add a small helper to resolve the `sources?` option:

```ts
  /** Resolve the optional `{ sources?: string[] }` bag from a method's trailing
   *  arg: returns the candidate members, narrowed to `sources` if given (each
   *  must be enabled), still capability-filtered by the caller. The bag is the
   *  LAST argument if it is a plain object with a `sources` array. */
  private splitSourcesOption(args: unknown[]): { args: unknown[]; sources?: string[] } {
    const last = args[args.length - 1];
    if (last && typeof last === "object" && !Array.isArray(last) && Array.isArray((last as { sources?: unknown }).sources)) {
      return { args: args.slice(0, -1), sources: (last as { sources: string[] }).sources };
    }
    return { args };
  }

  private candidates(agentId: string | undefined, cap: Capability, sources?: string[]) {
    let members = this.membersForAgentWithCapability(agentId, cap);
    if (sources) {
      const allow = new Set(sources);
      members = members.filter((m) => allow.has(m.id));
    }
    return members;
  }

  /** Throw if no enabled member supports `cap` at all (regardless of agent). */
  private assertSomeMemberSupports(cap: Capability): void {
    if (!this.enabledClients().some(({ client }) => client.supports(cap))) {
      throw new UnsupportedCapabilityError(cap, this.clientId);
    }
  }

  private isNotFound(err: unknown): boolean {
    return !!err && typeof err === "object" && (err as { status?: number }).status === 404;
  }

  private requiredMessagesCapability(params?: { before?: string; after?: string }): Capability {
    if (params?.after) return "messages.listHistorical";
    if (params?.before) {
      const ts = extractSnowflakeId(params.before); // epoch ms embedded in the snowflake
      if (typeof ts === "number" && ts < Date.now() - 24 * 60 * 60 * 1000) return "messages.listHistorical";
    }
    return "messages.list";
  }
```

> Check the actual signature of `extractSnowflakeId` in `src/utils/snowflake.ts` — it returns the timestamp portion. If it returns something else, adjust `requiredMessagesCapability` accordingly (or, conservatively, treat any `before` older than now-24h as historical only when a reliable timestamp is extractable; otherwise default to `messages.list`).

Now the facades — replace `makeReadFacade` calls in the constructor for the **core four** with explicit objects (keep `makeReadFacade` for the non-core ones, implemented in Task 24):

```ts
    this.channels = this.makeChannelsFacade();
    this.aggregates = this.makeAggregatesFacade();
    this.messages = this.makeMessagesFacade();
    this.agents = this.makeAgentsFacade();
    this.alarms = this.makeReadFacade<AlarmsApiLike>("alarms");
    // …connections/notifications/permissions/processors/turn/users via makeReadFacade…
```

```ts
  private makeChannelsFacade(): ChannelsApiLike {
    const self = this;
    return {
      async listChannels(agentIdOrId: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([agentIdOrId, ...rest]);
        const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId: string }).agentId;
        self.assertSomeMemberSupports("channels.list");
        const members = self.candidates(agentId, "channels.list", sources);
        const perMember = await Promise.all(members.map((m) => (m.client.channels.listChannels as (...a: unknown[]) => Promise<unknown[]>)(...args)));
        return dedupeBy(([] as unknown[]).concat(...perMember) as { name: string }[], (c) => c.name) as never;
      },
      async getChannel(agentIdOrId: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([agentIdOrId, ...rest]);
        const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId: string }).agentId;
        const name = typeof args[0] === "string" ? (args[1] as string) : (args[0] as { channelName: string }).channelName;
        self.assertSomeMemberSupports("channels.get");
        const members = self.candidates(agentId, "channels.get", sources);
        const settled = await Promise.allSettled(members.map((m) => (m.client.channels.getChannel as (...a: unknown[]) => Promise<unknown>)(...args)));
        const ok = settled.flatMap((r, i) => r.status === "fulfilled" ? [{ value: r.value, id: members[i].id }] : (r.status === "rejected" && !self.isNotFound(r.reason) ? (() => { throw r.reason; })() : []));
        if (ok.length === 0) { const e = new Error(`channel ${agentId}/${name} not found`) as Error & { status: number }; e.status = 404; throw e; }
        if (ok.length > 1) self.recordConflict("channels.getChannel", agentId, name, ok);
        return ok[0].value as never;
      },
      createChannel: self.unsupportedMethod("channels.createChannel", "channels.create") as never,
      putChannel: self.unsupportedMethod("channels.putChannel", "channels.create") as never,
      archiveChannel: self.routedWrite("channels.archiveChannel", "channels.archive") as never,
      unarchiveChannel: self.routedWrite("channels.unarchiveChannel", "channels.archive") as never,
      listDataSeries: self.unsupportedMethod("channels.listDataSeries", "channels.dataSeries") as never,
    } as ChannelsApiLike;
  }
```

> `createChannel` is technically a *write* — it routes via `routedWrite` (Task 23). It's shown here as `unsupportedMethod` only to keep this step compilable in isolation; replace with `self.routedWrite("channels.createChannel", "channels.create")` once Task 23 lands. `unsupportedMethod(method, cap)` returns `() => Promise.reject(new UnsupportedCapabilityError(cap, this.clientId))` — but only call it from `assertSomeMemberSupports`-style guards; better, see Task 24's generic `makeReadFacade` which checks `candidates` and throws only when empty. For the core writes, use `routedWrite` (Task 23). For now, stub `unsupportedMethod` as:

```ts
  private unsupportedMethod(_method: string, cap: Capability) {
    return () => Promise.reject(new UnsupportedCapabilityError(cap, this.clientId));
  }
```

```ts
  private makeAggregatesFacade(): AggregatesApiLike {
    const self = this;
    return {
      async getAggregate(agentIdOrId: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([agentIdOrId, ...rest]);
        const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId: string }).agentId;
        const name = typeof args[0] === "string" ? (args[1] as string) : (args[0] as { channelName: string }).channelName;
        self.assertSomeMemberSupports("aggregates.get");
        const members = self.candidates(agentId, "aggregates.get", sources);
        const settled = await Promise.allSettled(members.map((m) => (m.client.aggregates.getAggregate as (...a: unknown[]) => Promise<unknown>)(...args)));
        const ok = settled.flatMap((r, i) => r.status === "fulfilled" ? [{ value: r.value, id: members[i].id }] : (r.status === "rejected" && !self.isNotFound(r.reason) ? (() => { throw r.reason; })() : []));
        if (ok.length === 0) { const e = new Error(`aggregate ${agentId}/${name} not found`) as Error & { status: number }; e.status = 404; throw e; }
        if (ok.length > 1) self.recordConflict("aggregates.getAggregate", agentId, name, ok);
        return ok[0].value as never;
      },
      putAggregate: self.routedWrite("aggregates.putAggregate", "aggregates.put") as never,
      patchAggregate: self.routedWrite("aggregates.patchAggregate", "aggregates.patch") as never,
      async getAggregateAttachment(agentIdOrId: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([agentIdOrId, ...rest]);
        const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId: string }).agentId;
        self.assertSomeMemberSupports("aggregates.attachment");
        const members = self.candidates(agentId, "aggregates.attachment", sources);
        for (const m of members) {
          try { return await (m.client.aggregates.getAggregateAttachment as (...a: unknown[]) => Promise<Blob>)(...args); }
          catch (e) { if (!self.isNotFound(e)) throw e; }
        }
        const e = new Error("attachment not found") as Error & { status: number }; e.status = 404; throw e;
      },
    } as AggregatesApiLike;
  }
```

```ts
  private makeMessagesFacade(): MessagesApiLike {
    const self = this;
    return {
      async listMessages(agentIdOrId: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([agentIdOrId, ...rest]);
        const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId: string }).agentId;
        const params = (typeof args[0] === "string" ? args[2] : args[1]) as { order?: "asc" | "desc"; limit?: number; before?: string; after?: string } | undefined;
        const implied = self.requiredMessagesCapability(params);
        // a member is eligible if it has the implied cap; for "latest N" that IS messages.list.
        self.assertSomeMemberSupports(implied);
        const members = self.candidates(agentId, implied, sources);
        const perMember = await Promise.all(members.map((m) => (m.client.messages.listMessages as (...a: unknown[]) => Promise<unknown[]>)(...args)));
        return mergeMessages(perMember as never, { order: params?.order ?? "desc", limit: params?.limit }) as never;
      },
      async getMessage(agentIdOrId: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([agentIdOrId, ...rest]);
        const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId: string }).agentId;
        self.assertSomeMemberSupports("messages.get");
        const members = self.candidates(agentId, "messages.get", sources);
        for (const m of members) {
          try { return await (m.client.messages.getMessage as (...a: unknown[]) => Promise<unknown>)(...args) as never; }
          catch (e) { if (!self.isNotFound(e)) throw e; }
        }
        const e = new Error("message not found") as Error & { status: number }; e.status = 404; throw e;
      },
      postMessage: self.routedWrite("messages.postMessage", "messages.post") as never,
      putMessage: self.routedWrite("messages.putMessage", "messages.put") as never,
      patchMessage: self.routedWrite("messages.patchMessage", "messages.put") as never,
      deleteMessage: self.routedWrite("messages.deleteMessage", "messages.delete") as never,
      getTimeseries: self.makeFanoutFirst("messages.getTimeseries", "messages.timeseries") as never,
      getMessageAttachment: self.makeBlobFanout("messages.getMessageAttachment", "messages.attachment") as never,
      getInvocationLogs: self.makeFanoutFirst("messages.getInvocationLogs", "messages.invocationLogs") as never,
      createMultipartPayload(jsonPayload: Record<string, unknown>, attachments: Array<Blob | File>) {
        // pure helper — no member needed; mirror MessagesApi.createMultipartPayload
        const fd = new FormData();
        fd.set("json_payload", JSON.stringify(jsonPayload));
        attachments.forEach((a, i) => fd.set(`attachment-${i}`, a));
        return fd;
      },
    } as MessagesApiLike;
  }
```

```ts
  private makeAgentsFacade(): AgentsApiLike {
    const self = this;
    return {
      async listAgents(...rawArgs: unknown[]) {
        const { args, sources } = self.splitSourcesOption(rawArgs);
        self.assertSomeMemberSupports("agents.list");
        let members = self.enabledClients().filter(({ client }) => client.supports("agents.list"));
        if (sources) { const allow = new Set(sources); members = members.filter((m) => allow.has(m.id)); }
        const responses = await Promise.all(members.map((m) => (m.client.agents.listAgents as (...a: unknown[]) => Promise<{ agents?: unknown[]; results?: unknown[] }>)(...args)));
        const merged = dedupeBy(([] as { id: string }[]).concat(...responses.map((r) => (r.agents ?? r.results ?? []) as { id: string }[])), (a) => a.id);
        return { agents: merged, results: merged, count: merged.length } as never;
      },
      async getMultiAgentMessages(channelName: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([channelName, ...rest]);
        self.assertSomeMemberSupports("agents.multiAgentMessages");
        let members = self.enabledClients().filter(({ client }) => client.supports("agents.multiAgentMessages"));
        if (sources) { const allow = new Set(sources); members = members.filter((m) => allow.has(m.id)); }
        const responses = await Promise.all(members.map((m) => (m.client.agents.getMultiAgentMessages as (...a: unknown[]) => Promise<{ results: { id: string }[] }>)(...args)));
        const merged = mergeMessages(responses.map((r) => r.results) as never, { order: "desc" });
        return { results: merged, count: merged.length } as never;
      },
      async getMultiAgentAggregates(channelName: unknown, ...rest: unknown[]) {
        const { args, sources } = self.splitSourcesOption([channelName, ...rest]);
        self.assertSomeMemberSupports("agents.multiAgentAggregates");
        let members = self.enabledClients().filter(({ client }) => client.supports("agents.multiAgentAggregates"));
        if (sources) { const allow = new Set(sources); members = members.filter((m) => allow.has(m.id)); }
        const responses = await Promise.all(members.map((m) => (m.client.agents.getMultiAgentAggregates as (...a: unknown[]) => Promise<{ results: { agent_id: string }[] }>)(...args)));
        const merged = dedupeBy(([] as { agent_id: string }[]).concat(...responses.map((r) => r.results)), (a) => a.agent_id);
        return { results: merged, count: merged.length } as never;
      },
    } as AgentsApiLike;
  }
```

Add stubs for `recordConflict`, `routedWrite`, `makeFanoutFirst`, `makeBlobFanout` to be filled by Tasks 23 & 25 (so this compiles):

```ts
  protected recordConflict(_method: string, _agentId: string, _name: string, _values: Array<{ value: unknown; id: string }>): void { /* Task 25 */ }
  private routedWrite(_method: string, cap: Capability) { return (..._a: unknown[]) => Promise.reject(new UnsupportedCapabilityError(cap, this.clientId)); } // Task 23
  private makeFanoutFirst(_method: string, cap: Capability) { return (..._a: unknown[]) => Promise.reject(new UnsupportedCapabilityError(cap, this.clientId)); } // Task 24
  private makeBlobFanout(_method: string, cap: Capability) { return (..._a: unknown[]) => Promise.reject(new UnsupportedCapabilityError(cap, this.clientId)); } // Task 24
```

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-reads.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/multiplex-client.ts src/test/multiplex-reads.test.ts
git commit -m "feat: MultiplexClient core read fan-out & merge + sources option"
```

---

### Task 23: Write routing (`routedWrite`) + `AmbiguousWriteError`

**Files:**
- Modify: `src/client/multiplex-client.ts`
- Test: `src/test/multiplex-writes.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/multiplex-writes.test.ts
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as chai from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import { AmbiguousWriteError, UnsupportedCapabilityError } from "../client/errors";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

chai.use(chaiAsPromised);
const { expect: xp } = chai;

function writeMember(id: string, scope: { mode: "all" } | { mode: "list"; agentIds: string[] }, caps: string[], sink: string[]): DataClient {
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  const post = async (agentId: string) => { sink.push(`${id}:${agentId}`); return { id: "m", data: {}, attachments: [], author_id: "a", channel: { agent_id: agentId, name: "c" } }; };
  return {
    agents: noop, channels: noop,
    messages: { postMessage: (a: string) => post(a) } as never,
    aggregates: { putAggregate: async (a: string) => { sink.push(`${id}:put:${a}`); return { data: {}, attachments: [] }; } } as never,
    alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(caps as never), supports: (c: string) => caps.includes(c),
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: scope, at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => scope, getKnownAgentScope: () => scope,
  } as never;
}

describe("MultiplexClient writes", () => {
  function mk(members: Record<string, DataClient>) {
    const factory = (d: SourceDescriptor) => members[d.id];
    return new MultiplexClient({ factory, register: Object.keys(members).map((id) => ({ id, kind: id.startsWith("local") ? "local" : "cloud" })), enableAll: true });
  }

  it("routes to the single member that owns the agent and has the write cap", async () => {
    const sink: string[] = [];
    const mux = mk({
      cloud: writeMember("cloud", { mode: "all" }, ["messages.post"], sink),
      "local:7": writeMember("local:7", { mode: "list", agentIds: ["dev7"] }, ["messages.post"], sink),
    });
    // dev99 only owned by cloud (local:7 owns dev7) → routes to cloud
    await mux.messages.postMessage("dev99", "c", { x: 1 } as never);
    expect(sink).to.deep.equal(["cloud:dev99"]);
  });

  it("ambiguous when 2+ members own the agent and have the cap → AmbiguousWriteError", async () => {
    const sink: string[] = [];
    const mux = mk({
      cloud: writeMember("cloud", { mode: "all" }, ["messages.post"], sink),
      "local:7": writeMember("local:7", { mode: "list", agentIds: ["dev7"] }, ["messages.post"], sink),
    });
    await xp(mux.messages.postMessage("dev7", "c", { x: 1 } as never)).to.be.rejectedWith(AmbiguousWriteError);
    // …unless scoped to one:
    await mux.messages.postMessage("dev7", "c", { x: 1 } as never, { sources: ["local:7"] } as never);
    expect(sink).to.deep.equal(["local:7:dev7"]);
  });

  it("no member with the cap → UnsupportedCapabilityError", async () => {
    const mux = mk({ cloud: writeMember("cloud", { mode: "all" }, ["messages.list"], []) });
    await xp(mux.messages.postMessage("dev7", "c", {} as never)).to.be.rejectedWith(UnsupportedCapabilityError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-writes.test.ts`
Expected: FAIL — `postMessage` rejects with `UnsupportedCapabilityError` (the `routedWrite` stub).

- [ ] **Step 3: Implement `routedWrite` in `multiplex-client.ts`**

```ts
  import { AmbiguousWriteError } from "./errors";  // add to imports (UnsupportedCapabilityError already imported)

  /**
   * Returns a method that routes a write to exactly one member:
   *  (a) `{ sources: [oneId] }` scoping → that member;
   *  (b) else the single enabled member that owns the targeted agent and has `cap`;
   *  (c) else `UnsupportedCapabilityError` (none) or `AmbiguousWriteError` (>1).
   * The targeted agent id is `args[0]` (string form) or `args[0].agentId` (identifier form).
   * Writes are never fanned out.
   */
  private routedWrite(method: string, cap: Capability) {
    const self = this;
    return async function (...rawArgs: unknown[]) {
      const { args, sources } = self.splitSourcesOption(rawArgs);
      const agentId = typeof args[0] === "string" ? args[0] : (args[0] as { agentId?: string } | undefined)?.agentId;
      let members = self.candidates(agentId, cap, sources);
      if (sources && sources.length === 1) {
        const only = members.find((m) => m.id === sources[0]);
        if (!only) throw new UnsupportedCapabilityError(cap, sources[0]);
        members = [only];
      }
      if (members.length === 0) throw new UnsupportedCapabilityError(cap, self.clientId);
      if (members.length > 1) throw new AmbiguousWriteError(cap, members.map((m) => m.id));
      const target = members[0];
      const subclient = method.split(".")[0] as keyof DataClient;
      const fnName = method.split(".")[1];
      const fn = (target.client[subclient] as Record<string, (...a: unknown[]) => unknown>)[fnName];
      return fn.apply(target.client[subclient], args);
    };
  }
```

> `createChannel` is also a write — go back to `makeChannelsFacade` (Task 22) and replace `createChannel: self.unsupportedMethod(...)` and `putChannel: self.unsupportedMethod(...)` with `createChannel: self.routedWrite("channels.createChannel", "channels.create") as never` and `putChannel: self.routedWrite("channels.putChannel", "channels.create") as never`. `archiveChannel`/`unarchiveChannel` already use `routedWrite`.

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-writes.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/multiplex-client.ts src/test/multiplex-writes.test.ts
git commit -m "feat: MultiplexClient write routing + AmbiguousWriteError"
```

---

### Task 24: Non-core methods — generic fan-out facades + capability map

**Files:**
- Modify: `src/client/multiplex-client.ts`
- Test: `src/test/multiplex-noncore.test.ts`

The non-core subclients (`alarms`, `connections`, `notifications`, `permissions`, `processors`, `turn`, `users`) follow the spec's stated pattern: **read → fan-out (first non-404 / merged) ; write → route-to-one ; capability-gated**. Implement them with two generic builders driven by a per-method capability + kind map.

**Per-method classification (the table to encode):**

| Subclient.method | Capability | Kind |
|---|---|---|
| `alarms.listAlarms`, `alarms.getAlarm` | `alarms.read` | read-fanout-first (agent-scoped) |
| `alarms.createAlarm`, `alarms.putAlarm`, `alarms.patchAlarm`, `alarms.deleteAlarm` | `alarms.write` | write-route |
| `connections.getAgentConnections`, `getAgentConnectionHistory`, `getAgentSubscriptionHistory`, `getConnection`, `getChannelSubscriptions` | `connections.read` | read-fanout-first |
| `connections.syncConnection` | `connections.write` | write-route |
| `notifications.*` reads (`getAgentNotifications`, `getAgentNotificationEndpoints`, `getAgentNotificationSubscriptions`, `getAgentDefaultNotificationSubscriptions`, `getAgentNotificationSubscribers`, `getWebPushPublicKey`) | `notifications.read` | read-fanout-first |
| `notifications.*` writes (`createNotificationEndpoint`, `updateNotificationEndpoint`, `deleteNotificationEndpoint`, `testNotificationEndpoint`, `createNotificationSubscription`, `deleteDefaultNotificationSubscription`, `updateNotificationSubscription`, `deleteNotificationSubscription`, `updateMeWebPushEndpoint`) | `notifications.write` | write-route |
| `permissions.getAgentPermission`, `getAgentPermissionDebug` | `permissions.read` | read-fanout-first |
| `permissions.syncPermissions` | `permissions.write` | write-route (no agent → ambiguous unless one member or scoped) |
| `processors.getScheduleInfo`, `getScheduleInfoAlias`, `getProcessorSubscriptionInfo`, `getProcessorSubscriptionInfoAlias` | `processors.read` | read-fanout-first (no agent) |
| `processors.*` writes (`createProcessorSchedule`, `deleteProcessorSchedule`, `regenerateScheduleToken`, `createProcessorSubscription`, `deleteProcessorSubscription`, `createIngestionEndpoint`, `deleteIngestionEndpoint`, `invokeIngestionEndpoint`) | `processors.write` | write-route |
| `turn.createTurnToken` | `turn.credentials` | read-fanout-first (no agent) |
| `users.getMe` | `users.me` | read-fanout-first (no agent) |

> "read-fanout-first" = try each candidate in order, return the first that resolves (skipping 404s); for `getMe`/`createTurnToken`/`getWebPushPublicKey` the first member's result is the answer. "no agent" methods can't be agent-routed → `membersForAgent(undefined)` = all enabled members with the cap. For agent-scoped non-core reads, `args[0]` (string) or `args[0].agentId` carries the agent id; reuse the same extraction as `routedWrite`.

- [ ] **Step 1: Write the failing test**

```ts
// src/test/multiplex-noncore.test.ts
import { expect } from "chai";
import chaiAsPromised from "chai-as-promised";
import * as chai from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import { UnsupportedCapabilityError } from "../client/errors";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

chai.use(chaiAsPromised);
const { expect: xp } = chai;

function member(id: string, caps: string[], impl: Partial<Record<string, unknown>>): DataClient {
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  const make = (name: string) => (impl[name] ?? noop) as never;
  return {
    agents: noop, channels: noop, messages: noop, aggregates: noop,
    alarms: make("alarms"), connections: make("connections"), notifications: make("notifications"),
    permissions: make("permissions"), processors: make("processors"), turn: make("turn"), users: make("users"), rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(caps as never), supports: (c: string) => caps.includes(c),
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: { mode: "all" as const }, at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => ({ mode: "all" as const }), getKnownAgentScope: () => ({ mode: "all" as const }),
  } as never;
}

describe("MultiplexClient non-core methods", () => {
  function mk(members: Record<string, DataClient>) {
    const factory = (d: SourceDescriptor) => members[d.id];
    return new MultiplexClient({ factory, register: Object.keys(members).map((id) => ({ id, kind: "cloud" })), enableAll: true });
  }
  it("users.getMe returns the first member's result; throws if no member supports it", async () => {
    const mux = mk({ cloud: member("cloud", ["users.me"], { users: { getMe: async () => ({ id: "u1" }) } }) });
    expect((await mux.users.getMe()).id).to.equal("u1");
    const mux2 = mk({ cloud: member("cloud", [], {}) });
    await xp(mux2.users.getMe()).to.be.rejectedWith(UnsupportedCapabilityError);
  });
  it("alarms.listAlarms fans out; alarms.deleteAlarm routes to one", async () => {
    const sink: string[] = [];
    const mux = mk({ cloud: member("cloud", ["alarms.read", "alarms.write"], {
      alarms: { listAlarms: async () => [{ id: "al1", name: "x" }], deleteAlarm: async (a: string) => { sink.push(`del:${a}`); } },
    }) });
    expect((await mux.alarms.listAlarms("dev7", "c"))[0].id).to.equal("al1");
    await mux.alarms.deleteAlarm("dev7", "c", "al1");
    expect(sink).to.deep.equal(["del:dev7"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-noncore.test.ts`
Expected: FAIL — `mux.users.getMe` is undefined (the non-core facades are still `makeReadFacade` returning `{}`).

- [ ] **Step 3: Implement the generic facades + the method map in `multiplex-client.ts`**

```ts
type MethodKind = "read-fanout-first" | "write-route";
interface MethodSpec { cap: Capability; kind: MethodKind; agentScoped: boolean }

/** "<subclient>.<method>" → spec. Drives the generic non-core facades. */
const NONCORE_METHODS: Record<string, MethodSpec> = {
  // alarms
  "alarms.listAlarms": { cap: "alarms.read", kind: "read-fanout-first", agentScoped: true },
  "alarms.getAlarm": { cap: "alarms.read", kind: "read-fanout-first", agentScoped: true },
  "alarms.createAlarm": { cap: "alarms.write", kind: "write-route", agentScoped: true },
  "alarms.putAlarm": { cap: "alarms.write", kind: "write-route", agentScoped: true },
  "alarms.patchAlarm": { cap: "alarms.write", kind: "write-route", agentScoped: true },
  "alarms.deleteAlarm": { cap: "alarms.write", kind: "write-route", agentScoped: true },
  // connections
  "connections.getAgentConnections": { cap: "connections.read", kind: "read-fanout-first", agentScoped: true },
  "connections.getAgentConnectionHistory": { cap: "connections.read", kind: "read-fanout-first", agentScoped: true },
  "connections.getAgentSubscriptionHistory": { cap: "connections.read", kind: "read-fanout-first", agentScoped: true },
  "connections.getConnection": { cap: "connections.read", kind: "read-fanout-first", agentScoped: false },
  "connections.getChannelSubscriptions": { cap: "connections.read", kind: "read-fanout-first", agentScoped: true },
  "connections.syncConnection": { cap: "connections.write", kind: "write-route", agentScoped: true },
  // notifications (reads)
  "notifications.getAgentNotifications": { cap: "notifications.read", kind: "read-fanout-first", agentScoped: true },
  "notifications.getAgentNotificationEndpoints": { cap: "notifications.read", kind: "read-fanout-first", agentScoped: true },
  "notifications.getAgentNotificationSubscriptions": { cap: "notifications.read", kind: "read-fanout-first", agentScoped: true },
  "notifications.getAgentDefaultNotificationSubscriptions": { cap: "notifications.read", kind: "read-fanout-first", agentScoped: true },
  "notifications.getAgentNotificationSubscribers": { cap: "notifications.read", kind: "read-fanout-first", agentScoped: true },
  "notifications.getWebPushPublicKey": { cap: "notifications.read", kind: "read-fanout-first", agentScoped: false },
  // notifications (writes)
  "notifications.createNotificationEndpoint": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.updateNotificationEndpoint": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.deleteNotificationEndpoint": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.testNotificationEndpoint": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.createNotificationSubscription": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.deleteDefaultNotificationSubscription": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.updateNotificationSubscription": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.deleteNotificationSubscription": { cap: "notifications.write", kind: "write-route", agentScoped: true },
  "notifications.updateMeWebPushEndpoint": { cap: "notifications.write", kind: "write-route", agentScoped: false },
  // permissions
  "permissions.getAgentPermission": { cap: "permissions.read", kind: "read-fanout-first", agentScoped: true },
  "permissions.getAgentPermissionDebug": { cap: "permissions.read", kind: "read-fanout-first", agentScoped: true },
  "permissions.syncPermissions": { cap: "permissions.write", kind: "write-route", agentScoped: false },
  // processors
  "processors.getScheduleInfo": { cap: "processors.read", kind: "read-fanout-first", agentScoped: false },
  "processors.getScheduleInfoAlias": { cap: "processors.read", kind: "read-fanout-first", agentScoped: false },
  "processors.getProcessorSubscriptionInfo": { cap: "processors.read", kind: "read-fanout-first", agentScoped: false },
  "processors.getProcessorSubscriptionInfoAlias": { cap: "processors.read", kind: "read-fanout-first", agentScoped: false },
  "processors.createProcessorSchedule": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.deleteProcessorSchedule": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.regenerateScheduleToken": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.createProcessorSubscription": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.deleteProcessorSubscription": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.createIngestionEndpoint": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.deleteIngestionEndpoint": { cap: "processors.write", kind: "write-route", agentScoped: true },
  "processors.invokeIngestionEndpoint": { cap: "processors.write", kind: "write-route", agentScoped: true },
  // turn / users
  "turn.createTurnToken": { cap: "turn.credentials", kind: "read-fanout-first", agentScoped: false },
  "users.getMe": { cap: "users.me", kind: "read-fanout-first", agentScoped: false },
};
```

Replace `makeReadFacade` with a real implementation that builds a Proxy whose every property is a function dispatched per `NONCORE_METHODS`:

```ts
  private makeReadFacade<T extends object>(subclientName: string): T {
    const self = this;
    return new Proxy({}, {
      get(_t, prop) {
        if (typeof prop !== "string") return undefined;
        const key = `${subclientName}.${prop}`;
        const spec = NONCORE_METHODS[key];
        if (!spec) {
          // Unknown method on a non-core subclient — treat as unsupported (read).
          return () => Promise.reject(new UnsupportedCapabilityError(self.guessNonCoreCap(subclientName), self.clientId));
        }
        if (spec.kind === "write-route") {
          return self.routedWrite(key, spec.cap);
        }
        return async (...rawArgs: unknown[]) => {
          const { args, sources } = self.splitSourcesOption(rawArgs);
          self.assertSomeMemberSupports(spec.cap);
          const agentId = !spec.agentScoped ? undefined
            : (typeof args[0] === "string" ? args[0] : (args[0] as { agentId?: string } | undefined)?.agentId);
          let members = self.candidates(agentId, spec.cap, sources);
          if (members.length === 0) throw new UnsupportedCapabilityError(spec.cap, self.clientId);
          let lastErr: unknown;
          for (const m of members) {
            try {
              return await (m.client[subclientName as keyof DataClient] as Record<string, (...a: unknown[]) => unknown>)[prop](...args);
            } catch (e) { lastErr = e; if (!self.isNotFound(e)) throw e; }
          }
          throw lastErr ?? new Error(`${key}: no member returned a result`);
        };
      },
    }) as T;
  }

  private guessNonCoreCap(subclient: string): Capability {
    switch (subclient) {
      case "alarms": return "alarms.read";
      case "connections": return "connections.read";
      case "notifications": return "notifications.read";
      case "permissions": return "permissions.read";
      case "processors": return "processors.read";
      case "turn": return "turn.credentials";
      case "users": return "users.me";
      default: return "channels.get";
    }
  }
```

Also implement `makeFanoutFirst` and `makeBlobFanout` referenced by `makeMessagesFacade` (Task 22) the same way (`makeFanoutFirst` ≈ a read-fanout-first over an agent-scoped method; `makeBlobFanout` returns the first member that yields a `Blob`). And `makeRpcFacade()`:

```ts
  private makeRpcFacade(): RpcDispatcherLike {
    const self = this;
    return {
      setStats() { /* no-op for the multiplex; members keep their own stats */ },
      send(channel: { agentId: string; channelName: string }, request: unknown, options?: unknown) {
        // route like a write keyed on channel.agentId
        const router = self.routedWrite("rpc.send", "rpc.send");
        return router(channel, request, options) as never;
      },
    } as RpcDispatcherLike;
  }
```

> `routedWrite` extracts the agent id from `args[0]` — for `rpc.send` that's `{ agentId, channelName }`, so it works. The dispatched call lands on `member.rpc.send(channel, request, options)`.

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-noncore.test.ts src/test/multiplex-reads.test.ts src/test/multiplex-writes.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/multiplex-client.ts src/test/multiplex-noncore.test.ts
git commit -m "feat: MultiplexClient non-core subclients via generic fan-out/route facades"
```

---

### Task 25: Conflict surfacing — `on("conflict", …)` + `getLastConflicts()`

**Files:**
- Modify: `src/client/multiplex-client.ts`
- Test: `src/test/multiplex-conflicts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/multiplex-conflicts.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

function aggMember(id: string, scope: { mode: "all" } | { mode: "list"; agentIds: string[] }, value: unknown): DataClient {
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: noop, channels: noop, messages: noop,
    aggregates: { getAggregate: async () => ({ ...(value as object), __source: { client: { id, kind: "x" }, retrievedAt: 0, via: { transport: "rest", method: "aggregates.getAggregate", request: {}, startedAt: 0, durationMs: 0 } } }) } as never,
    alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(["aggregates.get"] as never), supports: (c: string) => c === "aggregates.get",
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: scope, at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => scope, getKnownAgentScope: () => scope,
  } as never;
}

describe("MultiplexClient conflicts", () => {
  it("getAggregate across two owning members → first wins, conflict emitted + snapshot recorded", async () => {
    const factory = (d: SourceDescriptor) => d.id === "cloud" ? aggMember("cloud", { mode: "all" }, { data: { v: 1 }, attachments: [] }) : aggMember("local:7", { mode: "list", agentIds: ["dev7"] }, { data: { v: 2 }, attachments: [] });
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:7", kind: "local" }], enableAll: true });
    const events: unknown[] = [];
    mux.on("conflict", (c) => events.push(c));
    const agg = await mux.aggregates.getAggregate("dev7", "c");
    expect((agg as unknown as { data: { v: number } }).data.v).to.equal(1); // first member
    expect(agg.__source?.client.id).to.equal("cloud");
    expect(events).to.have.length(1);
    const conflicts = mux.getLastConflicts();
    expect(conflicts).to.have.length(1);
    expect(conflicts[0].method).to.equal("aggregates.getAggregate");
    expect(conflicts[0].sourceIds.sort()).to.deep.equal(["cloud", "local:7"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-conflicts.test.ts`
Expected: FAIL — `getLastConflicts` not a function (and no `conflict` event — `recordConflict` is a no-op stub).

- [ ] **Step 3: Implement `recordConflict` + `getLastConflicts`**

```ts
export interface MultiplexConflict {
  method: string;
  agentId: string;
  channelName: string;
  /** All owning members that returned a value (in member order). */
  sourceIds: string[];
  /** The values, parallel to `sourceIds`. The chosen one is index 0. */
  values: unknown[];
  at: number;
}

// in the class:
  private lastConflicts: MultiplexConflict[] = [];
  private readonly maxConflicts = 50;

  protected recordConflict(method: string, agentId: string, channelName: string, values: Array<{ value: unknown; id: string }>): void {
    // Only a conflict if the values differ (cheap structural compare).
    const json = values.map((v) => JSON.stringify(v.value, (k, val) => (k === "__source" ? undefined : val)));
    const allEqual = json.every((j) => j === json[0]);
    if (allEqual) return;
    const conflict: MultiplexConflict = { method, agentId, channelName, sourceIds: values.map((v) => v.id), values: values.map((v) => v.value), at: Date.now() };
    this.lastConflicts.push(conflict);
    if (this.lastConflicts.length > this.maxConflicts) this.lastConflicts.shift();
    this.emit("conflict", conflict);
  }

  getLastConflicts(): readonly MultiplexConflict[] { return this.lastConflicts; }
```

> The `getChannel`/`getAggregate` facades (Task 22) already call `recordConflict(method, agentId, name, ok)` when `ok.length > 1`. `getMessage` is "first non-404 wins" — the spec doesn't require conflict recording for it (a single-id lookup), so leave it. Update Task 22's calls if the `name` variable isn't in scope there (it is in `getChannel`/`getAggregate`).

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-conflicts.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/multiplex-client.ts src/test/multiplex-conflicts.test.ts
git commit -m "feat: MultiplexClient conflict event + getLastConflicts snapshot"
```

---

### Task 26: Composite gateway — `MultiplexGateway`

**Files:**
- Create: `src/client/multiplex-gateway.ts`
- Modify: `src/client/multiplex-client.ts` (use it in `makeCompositeGateway`)
- Test: `src/test/multiplex-gateway.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/multiplex-gateway.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

// A member with a controllable fake gateway.
function gwMember(id: string, scope: { mode: "all" } | { mode: "list"; agentIds: string[] }) {
  const subs: string[] = [];
  let connected = false;
  const channelHandlers = new Map<string, Set<{ onMessage?: (m: unknown) => void }>>();
  const member = {
    agents: {} as never, channels: {} as never, messages: {} as never, aggregates: {} as never,
    alarms: {} as never, connections: {} as never, notifications: {} as never, permissions: {} as never,
    processors: {} as never, turn: {} as never, users: {} as never, rpc: {} as never,
    gateway: {
      connect: async () => { connected = true; }, disconnect: () => { connected = false; }, reconnect: async () => {},
      on: () => {}, off: () => {},
      subscribe: (c: { agent_id: string; name: string }) => subs.push(`${c.agent_id}/${c.name}`),
      unsubscribe: (c: { agent_id: string; name: string }) => { const i = subs.indexOf(`${c.agent_id}/${c.name}`); if (i >= 0) subs.splice(i, 1); },
      subscribeToChannel: (c: { agent_id: string; name: string }, h: { onMessage?: (m: unknown) => void }) => {
        const k = `${c.agent_id}/${c.name}`;
        (channelHandlers.get(k) ?? channelHandlers.set(k, new Set()).get(k)!).add(h);
        return () => channelHandlers.get(k)?.delete(h);
      },
      syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => connected ? { session_id: `${id}-s` } : null,
      isConnected: () => connected, getSubscriptionCount: () => subs.length, getSubscriptions: () => subs.map((s) => ({ agent_id: s.split("/")[0], name: s.split("/")[1] })), setStats: () => {},
    } as never,
    getCapabilities: () => new Set(["gateway.subscribe", "gateway.realtime"] as never),
    supports: (c: string) => c === "gateway.subscribe" || c === "gateway.realtime",
    isConnected: () => connected, getStatus: () => ({ clientId: id, connected, state: connected ? "connected" : "disconnected", agentScope: scope, at: Date.now() }),
    onStatusChange: () => () => {},
    getAgentScope: async () => scope, getKnownAgentScope: () => scope,
  } as unknown as DataClient;
  return { member, subs, deliver(k: string, m: unknown) { channelHandlers.get(k)?.forEach((h) => h.onMessage?.(m)); }, isConnected: () => connected };
}

describe("MultiplexGateway", () => {
  it("subscribeToChannel routes to owning members; unsubscribe tears down; connect/isConnected aggregate", async () => {
    const c = gwMember("cloud", { mode: "all" });
    const l = gwMember("local:7", { mode: "list", agentIds: ["dev7"] });
    const factory = (d: SourceDescriptor) => d.id === "cloud" ? c.member : l.member;
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:7", kind: "local" }], enableAll: true });

    await mux.gateway.connect();
    expect(mux.gateway.isConnected()).to.equal(true);
    expect(mux.isConnected()).to.equal(true);

    let got: unknown;
    const off = mux.gateway.subscribeToChannel({ agent_id: "dev7", name: "c1" }, { onMessage: (m) => { got = m; } });
    // both cloud (all) and local:7 (owns dev7) subscribed
    expect(c.subs).to.deep.equal(["dev7/c1"]);
    expect(l.subs).to.deep.equal(["dev7/c1"]);
    l.deliver("dev7/c1", { id: "m1" });
    expect(got).to.deep.equal({ id: "m1" });
    off();
    expect(c.subs).to.deep.equal([]);
    expect(l.subs).to.deep.equal([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-gateway.test.ts`
Expected: FAIL — `mux.gateway.connect` is undefined (the `makeCompositeGateway` stub returns `{}`).

- [ ] **Step 3: Write `src/client/multiplex-gateway.ts`**

```ts
import type { GatewayClientLike } from "./data-client";
import type { ChannelRef } from "../types/common";

/** Minimal view of what MultiplexGateway needs from the owning multiplex. */
export interface MultiplexGatewayHost {
  /** Enabled members with `gateway.subscribe`. */
  gatewayMembers(): Array<{ id: string; gateway: GatewayClientLike }>;
  /** Enabled members owning `agentId` that have `gateway.subscribe`. */
  gatewayMembersForAgent(agentId: string): Array<{ id: string; gateway: GatewayClientLike }>;
}

type AnyGateway = GatewayClientLike & {
  on(e: string, h: (...a: unknown[]) => void): void;
  off(e: string, h: (...a: unknown[]) => void): void;
  subscribeToChannel(c: ChannelRef, h: Record<string, (...a: unknown[]) => void>): () => void;
};

/**
 * `GatewayClientLike` facade over the members' gateways:
 *  - connect/disconnect/reconnect → fan out to members with `gateway.subscribe`.
 *  - subscribe/unsubscribe/subscribeToChannel → route to owning members; ref-counted.
 *  - on/off → register against every member; events forwarded (payloads carry `__source`
 *    from the originating member).
 *  - isConnected → all members with `gateway.subscribe` are connected.
 *  - getSession → first connected member's session (locked decision #5).
 *  - getSubscriptions/getSubscriptionCount → union across members.
 */
export class MultiplexGateway implements GatewayClientLike {
  /** consumer event handler → per-member bound handler, so off() can detach. */
  private readonly eventBindings = new Map<string, Map<(...a: unknown[]) => void, Array<{ gw: AnyGateway; bound: (...a: unknown[]) => void }>>>();

  constructor(private readonly host: MultiplexGatewayHost) {}

  setStats(): void { /* members keep their own stats collectors */ }

  async connect(): Promise<void> {
    await Promise.all(this.host.gatewayMembers().map((m) => m.gateway.connect()));
  }
  disconnect(code?: number, reason?: string): void {
    for (const m of this.host.gatewayMembers()) m.gateway.disconnect(code, reason);
  }
  async reconnect(): Promise<void> {
    await Promise.all(this.host.gatewayMembers().map((m) => m.gateway.reconnect()));
  }

  on(event: string, handler: (...a: unknown[]) => void): void {
    const perEvent = this.eventBindings.get(event) ?? this.eventBindings.set(event, new Map()).get(event)!;
    const bound: Array<{ gw: AnyGateway; bound: (...a: unknown[]) => void }> = [];
    for (const m of this.host.gatewayMembers()) {
      const gw = m.gateway as AnyGateway;
      const b = (...a: unknown[]) => handler(...a);
      gw.on(event, b);
      bound.push({ gw, bound: b });
    }
    perEvent.set(handler, bound);
  }
  off(event: string, handler: (...a: unknown[]) => void): void {
    const bound = this.eventBindings.get(event)?.get(handler);
    if (!bound) return;
    for (const { gw, bound: b } of bound) gw.off(event, b);
    this.eventBindings.get(event)!.delete(handler);
  }

  subscribe(channel: ChannelRef, options?: { diff_only?: boolean }): void {
    for (const m of this.host.gatewayMembersForAgent(channel.agent_id)) m.gateway.subscribe(channel, options);
  }
  unsubscribe(channel: ChannelRef): void {
    for (const m of this.host.gatewayMembersForAgent(channel.agent_id)) m.gateway.unsubscribe(channel);
  }
  subscribeToChannel(channel: ChannelRef, handlers: Record<string, (...a: unknown[]) => void>): () => void {
    const offs = this.host.gatewayMembersForAgent(channel.agent_id).map((m) =>
      (m.gateway as AnyGateway).subscribeToChannel(channel, handlers),
    );
    let done = false;
    return () => { if (done) return; done = true; offs.forEach((o) => o()); };
  }
  syncChannel(channel: ChannelRef): void {
    for (const m of this.host.gatewayMembersForAgent(channel.agent_id)) m.gateway.syncChannel(channel);
  }
  sendOneShotMessage(channel: ChannelRef, data: unknown): void {
    for (const m of this.host.gatewayMembersForAgent(channel.agent_id)) {
      // only members that advertised gateway.oneShot would honour it; the facade
      // forwards to all owning members — extras are harmless no-ops on the wire.
      m.gateway.sendOneShotMessage(channel, data as never);
    }
  }

  getSession(): { session_id: string; session_token: string; subscriptions: unknown[] } | null {
    for (const m of this.host.gatewayMembers()) {
      const s = m.gateway.getSession();
      if (s) return s as never;
    }
    return null;
  }
  isConnected(): boolean {
    const members = this.host.gatewayMembers();
    if (members.length === 0) return false;
    return members.every((m) => m.gateway.isConnected());
  }
  getSubscriptionCount(): number { return this.getSubscriptions().length; }
  getSubscriptions(): ChannelRef[] {
    const seen = new Set<string>();
    const out: ChannelRef[] = [];
    for (const m of this.host.gatewayMembers()) {
      for (const c of m.gateway.getSubscriptions()) {
        const k = `${c.agent_id}/${c.name}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(c);
      }
    }
    return out;
  }
}
```

- [ ] **Step 4: Wire it into `multiplex-client.ts`**

```ts
import { MultiplexGateway, type MultiplexGatewayHost } from "./multiplex-gateway";

  private makeCompositeGateway(): GatewayClientLike {
    const host: MultiplexGatewayHost = {
      gatewayMembers: () => this.enabledClients().filter(({ client }) => client.supports("gateway.subscribe")).map(({ id, client }) => ({ id, gateway: client.gateway })),
      gatewayMembersForAgent: (agentId) => this.membersForAgentWithCapability(agentId, "gateway.subscribe").map(({ id, client }) => ({ id, gateway: client.gateway })),
    };
    return new MultiplexGateway(host);
  }
```

> Note: `on`/`off` on `MultiplexGateway` bind against the member set *at call time*. That's adequate for the existing react hooks (which call `subscribeToChannel`, not bare `on`). A follow-up could re-bind on `change`; not required for v1.

- [ ] **Step 5: Run the tests + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-gateway.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/client/multiplex-gateway.ts src/client/multiplex-client.ts src/test/multiplex-gateway.test.ts
git commit -m "feat: MultiplexGateway composite gateway facade"
```

---

### Task 27: Status & scope rollup — `isConnected`/`getStatus`/`onStatusChange` with `members[]`

**Files:**
- Modify: `src/client/multiplex-client.ts`
- Test: `src/test/multiplex-status.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/test/multiplex-status.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, DataClientStatus, SourceDescriptor } from "../client/multiplex-client";

function statefulMember(id: string): { member: DataClient; setConnected(v: boolean): void; setState(s: DataClientStatus["state"]): void } {
  let connected = false;
  let state: DataClientStatus["state"] = "disconnected";
  const listeners = new Set<(s: DataClientStatus) => void>();
  const fire = () => listeners.forEach((l) => l({ clientId: id, connected, state, agentScope: { mode: "all" }, at: Date.now() }));
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    member: {
      agents: noop, channels: noop, messages: noop, aggregates: noop, alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
      gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => connected, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
      getCapabilities: () => new Set(["gateway.subscribe"] as never), supports: (c: string) => c === "gateway.subscribe",
      isConnected: () => connected,
      getStatus: () => ({ clientId: id, connected, state, agentScope: { mode: "all" }, at: Date.now() }),
      onStatusChange: (l: (s: DataClientStatus) => void) => { listeners.add(l); return () => listeners.delete(l); },
      getAgentScope: async () => ({ mode: "all" as const }), getKnownAgentScope: () => ({ mode: "all" as const }),
    } as never,
    setConnected(v: boolean) { connected = v; state = v ? "connected" : "disconnected"; fire(); },
    setState(s: DataClientStatus["state"]) { state = s; fire(); },
  };
}

describe("MultiplexClient status rollup", () => {
  it("isConnected = all gateway-subscribe members connected; state degrades; members[] present; onStatusChange fires", () => {
    const a = statefulMember("cloud");
    const b = statefulMember("local:7");
    const factory = (d: SourceDescriptor) => d.id === "cloud" ? a.member : b.member;
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud", label: "Cloud" }, { id: "local:7", kind: "local" }], enableAll: true });
    const seen: DataClientStatus[] = [];
    const off = mux.onStatusChange((s) => seen.push(s));

    expect(mux.isConnected()).to.equal(false);
    let st = mux.getStatus();
    expect(st.clientId).to.equal("multiplex");
    expect(st.members).to.have.length(2);
    expect(st.state).to.equal("disconnected");

    a.setConnected(true);
    st = mux.getStatus();
    expect(st.connected).to.equal(false); // not ALL connected
    expect(st.state).to.equal("degraded");

    b.setConnected(true);
    st = mux.getStatus();
    expect(st.connected).to.equal(true);
    expect(st.state).to.equal("connected");

    a.setState("error");
    expect(mux.getStatus().state).to.equal("error");

    expect(seen.length).to.be.greaterThan(2);
    off();
    const n = seen.length;
    b.setState("error");
    expect(seen.length).to.equal(n); // unsubscribed
  });

  it("disabled members appear in members[] as 'disconnected'", () => {
    const a = statefulMember("cloud");
    const factory = (d: SourceDescriptor) => d.id === "cloud" ? a.member : statefulMember(d.id).member;
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:7", kind: "local" }], enable: ["cloud"] });
    const st = mux.getStatus();
    const local = st.members!.find((m) => m.sourceId === "local:7")!;
    expect(local.status.state).to.equal("disconnected");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-status.test.ts`
Expected: FAIL — `mux.isConnected()` always false / no `members` / `onStatusChange` no-op.

- [ ] **Step 3: Implement the status rollup, member-listener wiring, and `gatewayMembers`**

Replace the placeholder `isConnected`/`getStatus`/`onStatusChange`/`attachMemberListeners`/`detachMemberListeners` and add the rollup. Also wire `enableSource`/`disableSource`/`removeSource` to call `attach`/`detach` (they already call `attachMemberListeners(src)`; make sure `disableSource` calls `detachMemberListeners(src)` *before* it returns, and re-emit a status change). Status listeners observe the multiplex `"change"` event (member set changed) AND each enabled member's `onStatusChange`.

```ts
  private readonly statusListeners = new Set<(status: DataClientStatus) => void>();
  /** sourceId → member unsubscribe fn for its onStatusChange. */
  private readonly memberStatusUnsubs = new Map<string, () => void>();

  private attachMemberListeners(src: RegisteredSource): void {
    if (!src.client) return;
    if (this.memberStatusUnsubs.has(src.descriptor.id)) return;
    const unsub = src.client.onStatusChange(() => this.emitStatus());
    this.memberStatusUnsubs.set(src.descriptor.id, unsub);
  }
  private detachMemberListeners(src: RegisteredSource): void {
    const unsub = this.memberStatusUnsubs.get(src.descriptor.id);
    if (unsub) { unsub(); this.memberStatusUnsubs.delete(src.descriptor.id); }
  }

  isConnected(): boolean {
    const gwMembers = this.enabledClients().filter(({ client }) => client.supports("gateway.subscribe"));
    if (gwMembers.length === 0) return false;
    return gwMembers.every(({ client }) => client.isConnected());
  }

  getStatus(): DataClientStatus {
    const members = this.getRegisteredSources().map((s) => ({
      sourceId: s.descriptor.id,
      ...(s.descriptor.label ? { label: s.descriptor.label } : {}),
      status: s.enabled && s.client
        ? s.client.getStatus()
        : ({ clientId: s.descriptor.id, connected: false, state: "disconnected" as const, agentScope: "unknown" as const, at: Date.now() }),
    }));
    const enabled = members.filter((m) => this.registry.get(m.sourceId)?.enabled);
    const gwStatuses = enabled
      .filter((m) => this.registry.get(m.sourceId)!.client?.supports("gateway.subscribe"))
      .map((m) => m.status);
    const connected = this.isConnected();
    let state: DataClientStatus["state"];
    if (enabled.some((m) => m.status.state === "error")) state = "error";
    else if (gwStatuses.length === 0) state = "disconnected";
    else if (gwStatuses.every((s) => s.connected)) state = "connected";
    else if (gwStatuses.some((s) => s.connected)) state = "degraded";
    else if (gwStatuses.some((s) => s.state === "connecting")) state = "connecting";
    else state = "disconnected";
    // most-recent member values for the scalar summary fields (locked decision #8)
    const newest = [...enabled.map((m) => m.status)].sort((x, y) => y.at - x.at)[0];
    return {
      clientId: this.clientId,
      connected,
      state,
      session: this.gateway.getSession() ? { id: (this.gateway.getSession() as { session_id?: string }).session_id ?? "" } : null,
      ...(newest?.lastEvent ? { lastEvent: newest.lastEvent } : {}),
      latencyMs: newest?.latencyMs ?? null,
      ...(newest?.lastError ? { lastError: newest.lastError } : {}),
      agentScope: this.getKnownAgentScope(),
      at: Date.now(),
      members,
    };
  }

  onStatusChange(listener: (status: DataClientStatus) => void): () => void {
    this.statusListeners.add(listener);
    let active = true;
    return () => { if (!active) return; active = false; this.statusListeners.delete(listener); };
  }

  private emitStatus(): void {
    const snap = this.getStatus();
    this.statusListeners.forEach((l) => l(snap));
  }
```

In `enableSource`/`disableSource`/`removeSource`/`setActiveSources` and the async-factory resolution callback, after the registry mutation, also call `this.emitStatus();` (so a member set change re-renders status). The `emit("change")` calls already there can be augmented: make `emit("change")` also call `this.emitStatus()`, or just add explicit `this.emitStatus()` next to each `this.emit("change")`.

Also: `attachMemberListeners` must be called when a member's `client` first resolves (the async-factory path) — it already is in that callback.

- [ ] **Step 4: Run the tests + typecheck**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-status.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/multiplex-client.ts src/test/multiplex-status.test.ts
git commit -m "feat: MultiplexClient status & scope rollup with members[] breakdown"
```

---

### Task 28: `__source` pass-through + disabled→re-enabled member rejoins; export `MultiplexClient`

**Files:**
- Modify: `src/index.ts`
- Modify: `src/test/exports.test.ts`
- Test: `src/test/multiplex-passthrough.test.ts`

- [ ] **Step 1: Write the tests**

```ts
// src/test/multiplex-passthrough.test.ts — reuses the dataMember helper pattern from multiplex-reads.test.ts
import { expect } from "chai";
import { describe, it } from "mocha";

import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

// (Copy the `dataMember` helper from src/test/multiplex-reads.test.ts — or extract it
//  into src/test/helpers.ts and import it from both. Keeping a local copy is fine.)
function dataMember(/* …same as in multiplex-reads.test.ts… */ id: string, channels: { name: string }[]): DataClient {
  const src = { client: { id, kind: id.startsWith("local") ? "local" : "cloud" }, retrievedAt: Date.now(), via: { transport: "rest" as const, method: "channels.listChannels", request: {}, startedAt: 0, durationMs: 1 } };
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: noop, channels: { listChannels: async () => channels.map((c) => ({ ...c, is_private: false, owner_id: "o", __source: src })) } as never,
    messages: noop, aggregates: noop, alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(["channels.list"] as never), supports: (c: string) => c === "channels.list",
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: { mode: "all" as const }, at: Date.now() }),
    onStatusChange: () => () => {}, getAgentScope: async () => ({ mode: "all" as const }), getKnownAgentScope: () => ({ mode: "all" as const }),
  } as never;
}

describe("MultiplexClient pass-through & re-enable", () => {
  it("merged items keep their member __source (no re-stamp); disabled member drops out; re-enable rejoins (no rebuild)", async () => {
    let builds = 0;
    const factory = (d: SourceDescriptor) => { builds += 1; return dataMember(d.id, d.id === "cloud" ? [{ name: "cloudch" }] : [{ name: "localch" }]); };
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:7", kind: "local" }], enableAll: true });
    let list = await mux.channels.listChannels("dev7");
    expect(list.map((c) => c.name).sort()).to.deep.equal(["cloudch", "localch"]);
    expect(list.find((c) => c.name === "localch")!.__source?.client.id).to.equal("local:7");
    mux.disableSource("local:7");
    list = await mux.channels.listChannels("dev7");
    expect(list.map((c) => c.name)).to.deep.equal(["cloudch"]); // local dropped out
    mux.enableSource("local:7");
    list = await mux.channels.listChannels("dev7");
    expect(list.map((c) => c.name).sort()).to.deep.equal(["cloudch", "localch"]); // rejoined
    expect(builds).to.equal(2); // never rebuilt
  });
});
```

```ts
// add to src/test/exports.test.ts
  it("exports MultiplexClient", () => {
    expect(doover.MultiplexClient).to.be.a("function");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require tsx/cjs src/test/multiplex-passthrough.test.ts src/test/exports.test.ts`
Expected: FAIL on the export test (`MultiplexClient` undefined); passthrough test should already pass given Tasks 19–27.

- [ ] **Step 3: Add the exports to `src/index.ts`**

```ts
export { MultiplexClient } from "./client/multiplex-client";
export type {
  MultiplexClientOptions,
  SourceDescriptor,
  RegisteredSource,
  MultiplexConflict,
} from "./client/multiplex-client";
```

- [ ] **Step 4: Run the full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/test/exports.test.ts src/test/multiplex-passthrough.test.ts
git commit -m "feat: export MultiplexClient; test __source pass-through + re-enable"
```

---

## Phase 5 — `doover-js/react` compatibility

Goals: `DooverProvider`/`useDooverClient` typed against `DataClient` (non-breaking widening); each existing hook gains an optional `sources?: string[]` option forwarded to the underlying call **and** folded into its query key; new `useClientStatus()`; `useConnectionState` soft-deprecated. The react test files are `*.test.tsx` (run via `test:react`).

### Task 29: Widen `DooverProvider` / `useDooverClient` to `DataClient`

**Files:**
- Modify: `src/react/context.tsx`
- Test: `src/test/react-dataclient.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/test/react-dataclient.test.tsx
import { expect } from "chai";
import { describe, it } from "mocha";
import { renderHook } from "@testing-library/react";
import React from "react";

import { DooverProvider, useDooverClient } from "../react";
import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

function stubMember(id: string): DataClient {
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: noop, channels: noop, messages: noop, aggregates: noop, alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(["channels.list"] as never), supports: () => true,
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: "unknown" as const, at: Date.now() }),
    onStatusChange: () => () => {}, getAgentScope: async () => ({ mode: "list", agentIds: [] }), getKnownAgentScope: () => "unknown",
  } as never;
}

describe("DooverProvider with a DataClient", () => {
  it("accepts a MultiplexClient and useDooverClient returns it", () => {
    const factory = (d: SourceDescriptor) => stubMember(d.id);
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }], enable: ["cloud"] });
    const { result } = renderHook(() => useDooverClient(), {
      wrapper: ({ children }) => <DooverProvider client={mux}>{children}</DooverProvider>,
    });
    expect(result.current).to.equal(mux);
  });
});
```

- [ ] **Step 2: Run to verify it fails (type error / runtime ok)**

Run: `npx tsc --noEmit` — Expected: error: `MultiplexClient` not assignable to `DooverClient` in `DooverProvider`. Then `npx mocha --exit --require global-jsdom/register --require tsx/cjs src/test/react-dataclient.test.tsx` — runtime may pass (JS ignores types) but the intent is the type widening.

- [ ] **Step 3: Modify `src/react/context.tsx`**

```tsx
import { createContext, useContext, type ReactNode } from "react";

import type { DataClient } from "../client/data-client";

const DooverClientContext = createContext<DataClient | null>(null);

export interface DooverProviderProps {
  client: DataClient;
  children: ReactNode;
}

export function DooverProvider({ client, children }: DooverProviderProps) {
  return (
    <DooverClientContext.Provider value={client}>
      {children}
    </DooverClientContext.Provider>
  );
}

/** Read the `DataClient` from context. Throws outside a `<DooverProvider>`. */
export function useDooverClient(): DataClient {
  const client = useContext(DooverClientContext);
  if (!client) {
    throw new Error("useDooverClient must be called inside a <DooverProvider>.");
  }
  return client;
}
```

> Keep the existing doc comment about pairing with `<QueryClientProvider>`.

- [ ] **Step 4: Run typecheck + the react suite**

Run: `npx tsc --noEmit && npx mocha --exit --require global-jsdom/register --require tsx/cjs src/test/react-dataclient.test.tsx src/test/react.test.tsx`
Expected: PASS (existing `react.test.tsx` still passes — `DooverClient` satisfies `DataClient`).

- [ ] **Step 5: Commit**

```bash
git add src/react/context.tsx src/test/react-dataclient.test.tsx
git commit -m "feat: type DooverProvider/useDooverClient against DataClient"
```

---

### Task 30: `useClientStatus()` hook

**Files:**
- Create: `src/react/useClientStatus.ts`
- Modify: `src/react/index.ts`
- Test: `src/test/react-client-status.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/test/react-client-status.test.tsx
import { expect } from "chai";
import { describe, it } from "mocha";
import { act, renderHook } from "@testing-library/react";
import React from "react";

import { DooverProvider, useClientStatus } from "../react";
import type { DataClient, DataClientStatus } from "../client/data-client";

function controllableClient(): { client: DataClient; push(s: Partial<DataClientStatus>): void } {
  let status: DataClientStatus = { clientId: "x", connected: false, state: "disconnected", agentScope: "unknown", at: Date.now() };
  const listeners = new Set<(s: DataClientStatus) => void>();
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    client: {
      agents: noop, channels: noop, messages: noop, aggregates: noop, alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
      gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
      getCapabilities: () => new Set(), supports: () => false,
      isConnected: () => status.connected, getStatus: () => status,
      onStatusChange: (l: (s: DataClientStatus) => void) => { listeners.add(l); return () => listeners.delete(l); },
      getAgentScope: async () => ({ mode: "all" }), getKnownAgentScope: () => "unknown",
    } as never,
    push(s: Partial<DataClientStatus>) { status = { ...status, ...s, at: Date.now() }; listeners.forEach((l) => l(status)); },
  };
}

describe("useClientStatus", () => {
  it("seeds with getStatus() and re-renders on onStatusChange", () => {
    const { client, push } = controllableClient();
    const { result } = renderHook(() => useClientStatus(), {
      wrapper: ({ children }) => <DooverProvider client={client}>{children}</DooverProvider>,
    });
    expect(result.current.state).to.equal("disconnected");
    act(() => push({ connected: true, state: "connected" }));
    expect(result.current.state).to.equal("connected");
    expect(result.current.connected).to.equal(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require global-jsdom/register --require tsx/cjs src/test/react-client-status.test.tsx`
Expected: FAIL — `useClientStatus` not exported.

- [ ] **Step 3: Write `src/react/useClientStatus.ts`**

```ts
import { useEffect, useState } from "react";

import type { DataClientStatus } from "../client/data-client";
import { useDooverClient } from "./context";

/**
 * Returns the live `DataClientStatus` for the client in context. Seeds with
 * `client.getStatus()`, subscribes via `client.onStatusChange(...)` for the
 * component's lifetime. Works for a `DooverClient` (single-source) or a
 * `MultiplexClient` (rolled-up status with a `members` breakdown). Prefer this
 * over `useConnectionState` for new code — it carries session, latency, last
 * error and per-source state.
 */
export function useClientStatus(): DataClientStatus {
  const client = useDooverClient();
  const [status, setStatus] = useState<DataClientStatus>(() => client.getStatus());

  useEffect(() => {
    setStatus(client.getStatus());
    return client.onStatusChange(setStatus);
  }, [client]);

  return status;
}
```

- [ ] **Step 4: Export from `src/react/index.ts`**

```ts
export { useClientStatus } from "./useClientStatus";
```

(and `export type { DataClientStatus, DataClientConnectionState, AgentScope } from "../client/data-client";` if not already re-exported there — convenient for consumers.)

- [ ] **Step 5: Run the test + typecheck**

Run: `npx mocha --exit --require global-jsdom/register --require tsx/cjs src/test/react-client-status.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/react/useClientStatus.ts src/react/index.ts src/test/react-client-status.test.tsx
git commit -m "feat: useClientStatus hook"
```

---

### Task 31: Hooks gain `sources?: string[]` option + source-dimensioned query keys

**Files:**
- Modify: `src/react/useChannelAggregate.ts`, `src/react/useChannelMessages.ts`, `src/react/useChannelMessage.ts`, `src/react/useChannelSubscription.ts`, `src/react/useSendMessage.ts`, `src/react/useUpdateAggregate.ts`, `src/react/useUpdateMessage.ts`, `src/react/useMultiAgentAggregates.ts`, `src/react/useMultiAgentChannelMessages.ts`
- Test: `src/test/react-sources-option.test.tsx`

**The pattern (apply to every hook):**
1. Add `sources?: string[]` to the hook's options interface (e.g. `UseChannelAggregateOptions`).
2. Derive a stable **source dimension** token: `const sourceDim = options?.sources ? [...options.sources].sort().join(",") : "*";` (locked decision #1 — unscoped uses the literal `"*"` token, not the enabled-member list).
3. Include `sourceDim` in the hook's query key — append it as the last element of the existing key tuple (e.g. `channelAggregateQueryKey(agentId, channelName)` becomes `[...channelAggregateQueryKey(agentId, channelName), sourceDim]`). **Do not change the exported `*QueryKey` helper signatures** — wrap them at the call site so existing direct callers of the helper still work; OR add an optional trailing `sources?: string[]` param to the helper that defaults to producing `"*"`. Pick the latter for ergonomics:

   ```ts
   export function channelAggregateQueryKey(
     agentId: string | undefined,
     channelName: string | undefined,
     sources?: string[],
   ) {
     const sourceDim = sources && sources.length ? [...sources].sort().join(",") : "*";
     return ["doover", "agent", agentId, "channel", channelName, "src", sourceDim] as const;
   }
   ```

   Existing callers that pass only `(agentId, channelName)` get `…, "src", "*"` — a one-time key shape change (acceptable: this is `0.5.0-alpha`).
4. Forward `sources` to the underlying `DataClient` call by appending `{ sources }` as the trailing options bag **only when `sources` is set** — e.g. `client.aggregates.getAggregate({ agentId, channelName }, options?.sources ? { sources: options.sources } : undefined)`. For a plain `DooverClient`, the options bag is ignored (its subclient methods don't read it) — harmless.
5. For `useChannelSubscription`, there is no query key; just forward `sources` so the composite gateway's `subscribeToChannel` is consulted appropriately — actually `client.gateway.subscribeToChannel` doesn't take a `sources` arg; the composite gateway already routes by `channel.agent_id`. So for `useChannelSubscription`, accepting `sources` is a **no-op** in v1 (document it: "reserved; the composite gateway routes by agent id"). Add the option to the handlers/options type but don't use it.
6. For mutation hooks (`useSendMessage`, `useUpdateAggregate`, `useUpdateMessage`), `sources` scopes the write — forward `{ sources }` to the underlying `postMessage`/`putAggregate`/`patchMessage` call. (For a `DooverClient`, ignored; for a `MultiplexClient`, it picks the write target.)

- [ ] **Step 1: Write the failing test (worked example: `useChannelAggregate`)**

```tsx
// src/test/react-sources-option.test.tsx
import { expect } from "chai";
import { describe, it } from "mocha";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { DooverProvider, useChannelAggregate, channelAggregateQueryKey } from "../react";
import { MultiplexClient } from "../client/multiplex-client";
import type { DataClient, SourceDescriptor } from "../client/multiplex-client";

function aggMember(id: string, value: unknown): DataClient {
  const src = { client: { id, kind: id.startsWith("local") ? "local" : "cloud" }, retrievedAt: 0, via: { transport: "rest" as const, method: "aggregates.getAggregate", request: {}, startedAt: 0, durationMs: 0 } };
  const noop = new Proxy({}, { get: () => () => Promise.resolve(undefined) }) as never;
  return {
    agents: noop,
    channels: { getChannel: async () => { const e = new Error("404") as Error & { status: number }; e.status = 404; throw e; } } as never,
    messages: noop,
    aggregates: { getAggregate: async () => ({ ...(value as object), __source: src }) } as never,
    alarms: noop, connections: noop, notifications: noop, permissions: noop, processors: noop, turn: noop, users: noop, rpc: noop,
    gateway: { connect: async () => {}, disconnect: () => {}, reconnect: async () => {}, on: () => {}, off: () => {}, subscribe: () => {}, unsubscribe: () => {}, subscribeToChannel: () => () => {}, syncChannel: () => {}, sendOneShotMessage: () => {}, getSession: () => null, isConnected: () => false, getSubscriptionCount: () => 0, getSubscriptions: () => [], setStats: () => {} } as never,
    getCapabilities: () => new Set(["aggregates.get", "channels.get", "gateway.subscribe"] as never),
    supports: (c: string) => ["aggregates.get", "channels.get", "gateway.subscribe"].includes(c),
    isConnected: () => false, getStatus: () => ({ clientId: id, connected: false, state: "disconnected", agentScope: { mode: "all" as const }, at: 0 }),
    onStatusChange: () => () => {}, getAgentScope: async () => ({ mode: "all" as const }), getKnownAgentScope: () => ({ mode: "all" as const }),
  } as never;
}

describe("hooks: sources option + source-dimensioned keys", () => {
  it("useChannelAggregate forwards sources and uses a source-dimensioned key; unscoped uses '*'", async () => {
    const factory = (d: SourceDescriptor) => d.id === "cloud" ? aggMember("cloud", { data: { v: 1 }, attachments: [] }) : aggMember("local:7", { data: { v: 2 }, attachments: [] });
    const mux = new MultiplexClient({ factory, register: [{ id: "cloud", kind: "cloud" }, { id: "local:7", kind: "local" }], enableAll: true });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}><DooverProvider client={mux}>{children}</DooverProvider></QueryClientProvider>
    );
    const scoped = renderHook(() => useChannelAggregate({ agentId: "dev7", channelName: "c" }, { sources: ["local:7"] }), { wrapper });
    await waitFor(() => expect(scoped.result.current.data).to.deep.equal({ v: 2 }));
    // its cache entry lives under the source-dimensioned key:
    expect(queryClient.getQueryData(channelAggregateQueryKey("dev7", "c", ["local:7"]))).to.exist;
    // an unscoped hook for the same channel uses the "*" key — distinct entry:
    expect(channelAggregateQueryKey("dev7", "c")).to.deep.equal(["doover", "agent", "dev7", "channel", "c", "src", "*"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx mocha --exit --require global-jsdom/register --require tsx/cjs src/test/react-sources-option.test.tsx`
Expected: FAIL — `channelAggregateQueryKey` doesn't take a 3rd arg / `data` never resolves under the right key.

- [ ] **Step 3: Implement the pattern in `useChannelAggregate.ts`** (then apply to the others)

```ts
export function channelAggregateQueryKey(
  agentId: string | undefined,
  channelName: string | undefined,
  sources?: string[],
) {
  const sourceDim = sources && sources.length ? [...sources].sort().join(",") : "*";
  return ["doover", "agent", agentId, "channel", channelName, "src", sourceDim] as const;
}

export interface UseChannelAggregateOptions {
  fetchInitial?: boolean;
  /** Restrict to these source ids on a MultiplexClient (ignored for a plain DooverClient). */
  sources?: string[];
}

export function useChannelAggregate<TData = Aggregate["data"]>(
  identifier: ChannelIdentifier,
  options?: UseChannelAggregateOptions,
): UseChannelAggregateResult<TData> {
  const client = useDooverClient();
  const queryClient = useQueryClient();
  const { agentId, channelName } = identifier;
  const sources = options?.sources;
  const key = channelAggregateQueryKey(agentId, channelName, sources);
  const fetchInitial = options?.fetchInitial ?? true;

  const onAggregate = useCallback(
    (aggregate: Aggregate) => { queryClient.setQueryData(key, aggregate as Aggregate<TData>); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [queryClient, agentId, channelName, sources?.join(",")],
  );

  useChannelSubscription(identifier, { onAggregate });

  const query = useQuery({
    queryKey: key,
    enabled: fetchInitial && !!agentId && !!channelName,
    staleTime: Infinity,
    queryFn: async () => {
      if (!agentId || !channelName) return undefined;
      const opts = sources ? { sources } : undefined;
      const channel = await client.channels.getChannel({ agentId, channelName }, opts as never);
      if (channel.aggregate) return channel.aggregate as Aggregate<TData>;
      return (await client.aggregates.getAggregate({ agentId, channelName }, opts as never)) as Aggregate<TData>;
    },
    retry: (failureCount, error) => {
      if (error instanceof DooverApiError && error.status === 404) return false;
      return failureCount < 3;
    },
  });

  const aggregate = query.data;
  const { data: _ignored, ...rest } = query;
  return { ...rest, data: aggregate?.data, attachments: aggregate?.attachments, last_updated: aggregate?.last_updated };
}
```

> The `channels.getChannel({ agentId, channelName }, opts)` call: on `DooverClient`, `ChannelsApi.getChannel`'s identifier overload takes `(identifier, options?: GetChannelOptions)` — passing `{ sources }` as the 2nd arg is type-incompatible. Resolve by: (a) only pass the 2nd arg when `sources` is set AND cast through `unknown` (the runtime ignores unknown keys); or (b) on a plain `DooverClient` skip passing it entirely. Recommended: `const opts = sources ? ({ sources } as never) : undefined;` and `client.channels.getChannel({ agentId, channelName }, ...(opts ? [opts] : []) )` — i.e. spread so the arg is simply absent when unscoped. Keep the same approach in every hook.

**Apply the same six steps to:**
- `useChannelMessages.ts` — `channelMessagesQueryKey(agentId, channelName, params?, sources?)` gains the `sources` dimension; forward `{ sources }` to `client.messages.listMessages`.
- `useChannelMessage.ts` — `channelMessageQueryKey(agentId, channelName, messageId, sources?)`; forward to `client.messages.getMessage`.
- `useMultiAgentAggregates.ts` — `multiAgentAggregatesQueryKey(channelName, agentIds, sources?)`; forward to `client.agents.getMultiAgentAggregates`.
- `useMultiAgentChannelMessages.ts` — `multiAgentChannelMessagesQueryKey(channelName, agentIds, params?, sources?)`; forward to `client.agents.getMultiAgentMessages`.
- `useSendMessage.ts` — add `sources?: string[]` to its options; forward `{ sources }` to `client.messages.postMessage`.
- `useUpdateAggregate.ts` — `UseUpdateAggregateOptions` gains `sources?: string[]`; forward to `putAggregate`/`patchAggregate`.
- `useUpdateMessage.ts` — `UseUpdateMessageOptions` gains `sources?: string[]`; forward to `putMessage`/`patchMessage`.
- `useChannelSubscription.ts` — add `sources?: string[]` to `ChannelSubscriptionHandlers` *or* a new 3rd param; **no-op in v1** (the composite gateway routes by agent id). Document it.

> `useSendRpc`, `useInvocationLogs`, `useTurnCredentials`, `useAgentChannel`, `useAgentConnections` are **not** in the spec's list of hooks to update — leave them as-is (they keep working: `client.rpc.send`, `client.messages.getInvocationLogs`, etc. all exist on `DataClient`). If you want, give them the same treatment in a follow-up; not required here.

- [ ] **Step 4: Run the react suite + typecheck**

Run: `npx tsc --noEmit && npm run test:react`
Expected: PASS — including the existing `react.test.tsx` (unchanged behaviour for `DooverClient`; keys gained a `"src","*"` suffix but the existing test asserts on `channelAggregateQueryKey(...)`'s *return value*, which still matches its own helper call).

> If `react.test.tsx` asserts a literal key array anywhere (search it), update that assertion to include `"src", "*"`.

- [ ] **Step 5: Commit**

```bash
git add src/react/*.ts src/test/react-sources-option.test.tsx
git commit -m "feat: react hooks accept sources option + source-dimensioned query keys"
```

---

### Task 32: Soft-deprecate `useConnectionState`

**Files:**
- Modify: `src/react/useConnectionState.ts`

- [ ] **Step 1: Add the `@deprecated` JSDoc**

Prepend to the `useConnectionState` doc comment:

```ts
/**
 * @deprecated Prefer `useClientStatus()` — it works for both `DooverClient` and
 * `MultiplexClient`, and carries session, latency, last error and per-source
 * state. `useConnectionState` is gateway-flavoured and single-source only;
 * it will remain but new code should not use it.
 *
 * Subscribes to the gateway's connection lifecycle … (existing text)
 */
```

(No behaviour change. Leave the export in `src/react/index.ts`.)

- [ ] **Step 2: Typecheck + commit**

Run: `npx tsc --noEmit && npm run test:react`
Expected: PASS.

```bash
git add src/react/useConnectionState.ts
git commit -m "docs: soft-deprecate useConnectionState in favour of useClientStatus"
```

---

## Phase 6 — Wrap-up

### Task 33: Final exports pass

**Files:**
- Modify: `src/index.ts`, `src/react/index.ts`
- Test: `src/test/exports.test.ts`, and a react export check.

- [ ] **Step 1: Add a comprehensive export assertion**

```ts
// extend src/test/exports.test.ts
  it("exports the full Phase-1..4 surface", () => {
    for (const name of ["ALL_CAPABILITIES", "UnsupportedCapabilityError", "AmbiguousWriteError", "LocalAgentClient", "MultiplexClient", "DooverClient"]) {
      expect((doover as Record<string, unknown>)[name], name).to.exist;
    }
  });
```

```tsx
// new src/test/react-exports.test.tsx
import { expect } from "chai";
import { describe, it } from "mocha";
import * as r from "../react";
describe("react exports", () => {
  it("exports useClientStatus and the key helpers", () => {
    expect(r.useClientStatus).to.be.a("function");
    expect(r.channelAggregateQueryKey).to.be.a("function");
    expect(r.useConnectionState).to.be.a("function"); // still exported (soft-deprecated)
  });
});
```

- [ ] **Step 2: Reconcile `src/index.ts` and `src/react/index.ts`**

Make sure these are all exported from `src/index.ts`: `Capability`, `ALL_CAPABILITIES`, `UnsupportedCapabilityError`, `AmbiguousWriteError`, `DataClient`, `AgentScope`, `DataClientStatus`, `DataClientConnectionState`, all `*ApiLike` types, `GatewayClientLike`, `RpcDispatcherLike`, `SourceProvenance` (+ the two `Via*` variants), `LocalAgentClient` (+ `LocalAgentClientConfig`), `MultiplexClient` (+ `MultiplexClientOptions`, `SourceDescriptor`, `RegisteredSource`, `MultiplexConflict`). From `src/react/index.ts`: `useClientStatus`, and re-export `DataClientStatus`/`AgentScope` for convenience.

- [ ] **Step 3: Run the full suite + typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts src/react/index.ts src/test/exports.test.ts src/test/react-exports.test.tsx
git commit -m "chore: finalise public exports for DataClient/LocalAgentClient/MultiplexClient"
```

---

### Task 34: README section, CHANGELOG, version bump

**Files:**
- Modify: `README.md`
- Modify: `package.json` (`version` → `0.5.0-alpha.1`)
- Create or modify: `CHANGELOG.md` if one exists (else add a "## 0.5.0-alpha.1" section to the README's changelog area / the existing "Migrating to 0.6.0" neighbourhood — match what the repo already does)

- [ ] **Step 1: Add a "Multi-source data (`DataClient`)" section to `README.md`**

Cover, with short code blocks: (1) `DataClient` is the contract `DooverClient` now implements; (2) `getCapabilities()` / `supports(cap)` / `UnsupportedCapabilityError`; (3) `LocalAgentClient` — `new LocalAgentClient({ baseUrl })`, its narrowed capability set, no auth; (4) `MultiplexClient` — `new MultiplexClient({ factory, register, enable })`, `setActiveSources([...])`, fan-out reads, routed writes, composite gateway, `getLastConflicts()`; (5) `__source` provenance on every returned datum; (6) react: `DooverProvider` accepts any `DataClient`, all hooks gained an optional `sources?: string[]`, new `useClientStatus()`, `useConnectionState` soft-deprecated. Example:

```ts
import { MultiplexClient, LocalAgentClient, getDooverClient } from "doover-js";

const mux = new MultiplexClient({
  factory: (d) =>
    d.kind === "cloud"
      ? getDooverClient({ /* cloud config */ })
      : new LocalAgentClient({ baseUrl: `http://${(d.params as any).host}:${(d.params as any).port}`, sourceId: d.id }),
  register: [{ id: "cloud", kind: "cloud" }],
  enable: ["cloud"],
});
mux.setActiveSources(["cloud", { id: "local:192.168.0.7:49100", kind: "local", params: { host: "192.168.0.7", port: 49100 } }]);
const channels = await mux.channels.listChannels("dev7"); // merged cloud + local
mux.on("conflict", (c) => console.warn("source disagreement", c));
```

- [ ] **Step 2: Bump the version**

In `package.json`: `"version": "0.5.0-alpha.1"`. Add a changelog entry summarising: `DataClient` contract + capability model + `__source` provenance (additive); `LocalAgentClient`; `MultiplexClient`; react `sources` option + `useClientStatus`; `useConnectionState` soft-deprecated.

- [ ] **Step 3: Build to make sure `dist` is consistent (optional but recommended)**

Run: `npm run build`
Expected: clean `tsc` build, no errors.

- [ ] **Step 4: Commit**

```bash
git add README.md package.json CHANGELOG.md 2>/dev/null; git add README.md package.json
git commit -m "docs: README + CHANGELOG for DataClient/LocalAgentClient/MultiplexClient; bump to 0.5.0-alpha.1"
```

---

### Task 35: Final verification

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: every `*.test.ts` and `*.test.tsx` passes, including all the existing pre-change tests (`doover-client.test.ts`, `react.test.tsx`, `gateway-*.test.ts`, `rpc-dispatcher.test.ts`, `apis.test.ts`, `api-overloads.test.ts`, …).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: no errors.

- [ ] **Step 3: Sanity-check the deliverables checklist** (in the spec file) — every box ticked:
  - `Capability` + `ALL_CAPABILITIES` + `UnsupportedCapabilityError` + `AmbiguousWriteError` exported ✔ (Tasks 1, 2, 5)
  - `DataClient` + `*ApiLike` + status/scope types exported; `DooverClient implements DataClient`, cloud scope `"all"` no network ✔ (Tasks 4, 5, 8)
  - `SourceProvenance` exported; `__source` stamped on every REST/gateway output by `DooverClient` & `LocalAgentClient`; existing shapes unchanged ✔ (Tasks 3, 6, 8, 9, 10, 11, 13–17)
  - `LocalAgentClient` implemented + tested (full surface, throw-stubs, capability table, status, `getAgentScope`) ✔ (Tasks 12–17)
  - `MultiplexClient` implemented + tested (registry, scope routing, fan-out/merge, write routing, composite gateway, conflicts, capability union, `__source` pass-through, status+scope rollup with `members[]`) ✔ (Tasks 18–28)
  - react: `DooverProvider`/`useDooverClient` typed `DataClient`; hooks gain `sources` + source-dimensioned keys; `useClientStatus`; unchanged for `DooverClient` ✔ (Tasks 29–32)
  - exports added to `src/index.ts` and `src/react/index.ts` ✔ (Tasks 5, 17, 28, 30, 33)
  - changelog / version bump to `0.5.0-alpha.1` ✔ (Task 34)

- [ ] **Step 4: Commit any final tidy-ups**

```bash
git add -A && git commit -m "chore: final tidy-up for DataClient/MultiplexClient feature" || echo "nothing to commit"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** every section of the spec maps to tasks — `DataClient` interface → 4; capability model → 1, 2; `getCapabilities` behaviour → 8 (cloud), 12 (local), 20 (multiplex union); unsupported-call → 2, 12, 22–24; `LocalAgentClient` → 12–17 (capability table in Phase 3 intro; ⚠ TBD resolved per locked decision #2); `MultiplexClient` registry/activation → 19; source scoping on calls/hooks → 22 (`sources` bag), 31 (hooks); read fan-out/merge table → 22 (core), 24 (non-core); write routing → 23, 24; conflicts → 25; composite gateway → 26; `getCapabilities`/`supports` union → 20; status & scope → 21, 27; react compat → 29–32; `__source` provenance shape + who-stamps → 3, 6, 8 (DooverClient), 13–17 (LocalAgentClient), 22/28 (multiplex pass-through), 10 (gateway); testing requirements → embedded as the per-task tests + 9, 11, 35; open decision points → resolved in the plan header + spec file's "Locked decisions"; deliverables checklist → Task 35 Step 3.
- **Known simplifications vs. the spec draft (deliberate, recorded):** `Capability` collapses `users.read`/`users.write` → `users.me` and folds `putChannel` under `channels.create` (matches the real subclient methods — spec sanctions "finalise against the actual method lists"). `MultiplexGateway.on/off` binds against the member set at call time (no re-bind on `change`) — fine for the existing hooks which use `subscribeToChannel`. `__source` on `Blob` returns: left untagged (locked decision #4). `via.request` for REST is `{ args: [...] }` (the wrapped subclient method's positional args, FormData/Blob/long-strings summarised) — carries the agentId/channelName/params the spec asks for.
- **Type-name consistency:** `ProvenanceStamper` (Task 6) — methods `stampRest` / `stampGatewayEvent`; `ClientStatusTracker` (Task 7) — `getStatus` / `onChange` / `notifyScopeChanged` / `dispose`; `MultiplexClient` (Task 19) — `registerSource` / `setActiveSources` / `enableSource` / `disableSource` / `removeSource` / `getActiveSources` / `getRegisteredSources` / `getLastConflicts`, events `"change"` / `"conflict"`; `routedWrite` (Task 23) used by core writes (Task 22) and non-core writes (Task 24) and rpc (Task 24); `membersForAgent` / `membersForAgentWithCapability` / `candidates` / `splitSourcesOption` / `assertSomeMemberSupports` / `isNotFound` / `requiredMessagesCapability` all defined in Tasks 21–22 and reused consistently; query-key helpers gain an optional trailing `sources?: string[]` param producing the `"src","*"` default (Task 31).

