# doover-js read-only offline cache — design exploration

**Date:** 2026-06-10
**Repo:** `doover-js`
**Status:** Planning / design exploration — no implementation yet

## Background

The first offline goal is deliberately modest: when a user opens a Doover client while offline, they should see useful last-known channel data. This is not offline-first sync, not offline writes, and not a queued-command system. If the client is offline, commands, RPC, and mutations should fail locally and visibly rather than being sent later.

The current `doover-js` shape is a good starting point:

- `DooverClient`, `LocalAgentClient`, and `MultiplexClient` all implement the structural `DataClient` contract.
- Resource reads are exposed through domain APIs: `agents`, `channels`, `messages`, `aggregates`, plus non-core APIs.
- React integration hangs off `DooverProvider`, `useDooverClient()`, and React Query hooks.
- Query keys are already domain-shaped for aggregates/messages and source-dimensioned for multiplex reads.
- Gateway events patch React Query caches for live aggregate/message updates.
- Attachments are modeled as metadata on aggregates/messages plus explicit blob fetches through `getAggregateAttachment` and `getMessageAttachment`.
- Writes/RPC are centralized through API methods and React mutation hooks.

That suggests the offline cache should be domain-aware and DataClient-aware, not a generic HTTP cache bolted onto `fetch`.

## Goals

- Add a read-only offline cache foundation for Doover data, starting with the native customer app but reusable by browser and future clients.
- Preserve Doover data-model boundaries: agents/list discovery, channels, channel aggregates, channel messages, aggregate attachments, and message attachments.
- Preserve and expose cache freshness: every cached record should carry cache write time and, where available, server freshness such as aggregate `last_updated` or message `timestamp`.
- Scope cached data so one user cannot see another user's cached data, while allowing a user to switch organisations and later reuse that organisation's cached state.
- Make retention configurable, with a suggested default of 7 days.
- Let callers opt specific reads/channels into caching and configure depth/attachment policies for different channel types.
- Express camera thumbnail caching as a policy over generic attachment metadata, not as camera-specific code.
- Hydrate existing React Query hooks from durable cached data where practical.
- Prevent offline mutations/RPC/one-shot commands from being sent or queued.
- Keep persistence backend choices outside `doover-js` by introducing a storage-adapter concept, without freezing the exact adapter interface in this document.

## Non-goals for v1

- Offline writes, optimistic writes, merge/conflict resolution, or retry queues.
- Full durable persistence of the whole React Query cache.
- Caching every endpoint in `DataClient`.
- Replaying missed gateway events.
- Cache encryption design, except to leave room for adapters to provide encrypted storage.
- A final storage adapter interface.
- App-specific screen state. The cache is designed around Doover resources, not native app screens.
- Full media/video attachment caching by default.
- Treating camera data as a special domain in core `doover-js`.

## Recommended Direction

Introduce an optional, domain-aware offline cache layer around `DataClient`, backed by a pluggable storage adapter and governed by per-resource/per-channel cache policies.

The most promising shape is an `OfflineDataClient`-style decorator or companion service that:

1. Wraps a normal `DataClient`.
2. Intercepts supported read methods at the domain API level.
3. Stores successful online read results using stable Doover cache keys.
4. Serves cached reads when the network/client is offline or when configured to prefer cache.
5. Blocks writes/RPC/gateway commands while offline.
6. Emits metadata so React consumers can distinguish fresh online data, stale cached data, and missing cached data.

This should be paired with React helpers that hydrate React Query from the offline cache before or alongside normal query execution. The existing hooks can then evolve minimally: they should continue to ask the `DataClient` for data, but gain access to offline metadata either through query result metadata wrappers, companion hooks, or typed returned fields.

Do not start with a generic `RestClient` HTTP cache. `RestClient` knows URL/method/body, but it does not know that `/agents/:id/channels/:name/messages?limit=3` is a message window whose attachments should be retained by a channel policy, or that `getMultiAgentAggregates("tag_values", field_name=...)` can seed per-agent aggregate caches. Domain-aware caching is more work, but it preserves Doover semantics.

## Where Responsibility Should Live

### Preferred: DataClient decorator plus shared offline cache service

`doover-js` should own the domain model, cache key conventions, policy evaluation, expiry checks, and React Query hydration helpers. The app should own the storage implementation and lifecycle wiring.

Conceptually:

```text
customer-site native app
  └─ provides storage adapter, user/org identity, online signal
     └─ doover-js offline cache layer
        └─ wraps DooverClient / MultiplexClient / LocalAgentClient
           └─ existing APIs, gateway, hooks
```

Pros:

- Reusable across native, browser, and future clients.
- Keeps cache policy close to Doover resources.
- Can work with `DooverClient`, `MultiplexClient`, and later clients.
- Avoids app code duplicating cache-key and attachment policy logic.

Cons:

- Adds a new public concept in `doover-js`.
- Requires careful typing so cached data metadata does not break existing API contracts.
- Needs explicit lifecycle events for logout/user change.

### Alternative: React Query persistence only

Use TanStack Query persistence and let each app choose a persister.

Pros:

- Fastest route for React-only consumers.
- Minimal new domain code.
- Good for simple JSON query results.

Cons:

- React-only; does not help non-React consumers.
- Poor fit for attachment blobs and attachment retention policy.
- Query keys are UI/hook-oriented, not necessarily the canonical durable data model.
- Harder to enforce user/org scoping consistently.
- Does not naturally cache reads done outside hooks.

### Alternative: RestClient HTTP cache

Cache successful GET responses and blobs by URL.

Pros:

- Centralized and transparent.
- Covers endpoints without per-API work.

Cons:

- URL cache keys are not expressive enough for policy decisions.
- Does not understand channel/message/aggregate relationships.
- Attachment policy becomes brittle path parsing.
- Multi-agent reads cannot naturally seed per-agent records.
- Harder to expose useful stale/offline state to React hooks.

Recommendation: use the DataClient/domain layer as the primary design. React Query persistence can still be an optimization later, but not the foundation.

## Cache Data Model

Separate durable records by Doover resource type. Store JSON records separately from binary attachment objects.

Suggested record families:

- `agents.list`: the agents endpoint response needed to discover/navigate available agents and organisations.
- `channels.list`: channel lists per agent and list options.
- `channels.get`: individual channel metadata, optionally including embedded aggregate.
- `aggregates.get`: channel aggregate payload and attachment metadata.
- `messages.window`: message result windows for channel reads.
- `messages.byId`: individual message payloads.
- `attachments.blob`: cached attachment binary plus metadata.
- `policies.channel`: effective cache policy overrides set by app/custom endpoints.
- `meta`: schema version, client version, retention settings, last sweep time.

Avoid making the durable store a literal copy of React Query's cache. React Query keys should map into this domain model, but the durable model should survive hook changes.

## Cache Keys

Use explicit structured keys rather than URL strings.

Every key should include:

- cache namespace/version
- authenticated user scope
- organisation scope
- source scope
- resource kind
- resource identifier
- query shape/options that materially change the result

Example shapes:

```ts
[
  "doover-offline",
  "v1",
  { userId, orgId, sourceId },
  "agent",
  agentId,
  "channel",
  channelName,
  "aggregate",
  { fields }
]
```

```ts
[
  "doover-offline",
  "v1",
  { userId, orgId, sourceId },
  "agent",
  agentId,
  "channel",
  channelName,
  "messages",
  {
    fields,
    after,
    order,
    window: "latest",
    limit
  }
]
```

For attachments:

```ts
[
  "doover-offline",
  "v1",
  { userId, orgId, sourceId },
  "attachment",
  {
    ownerKind: "message",
    agentId,
    channelName,
    messageId,
    attachmentId,
    variant
  }
]
```

`sourceId` matters because `MultiplexClient` can read from cloud/local members. For plain cloud clients this can be `"cloud"`. For local agents it should use the existing source id. For multiplex reads with explicit `sources`, cached records should either be stored per resolved source result or include a deterministic source-set dimension. Prefer storing normalized per-source/per-agent records where possible, then composing query responses from records.

## User and Organisation Scoping

Cache scope should prevent leakage but preserve useful org switching.

Recommended scope tuple:

```text
tenantScope = userId + organisationId + sourceId + sharingMode/assumeUser
```

Rules:

- Clear all durable cached data for the previous user on logout.
- Clear or quarantine when the authenticated user changes.
- Do not clear merely because the active organisation changes.
- Store organisation-specific data under that organisation's scope, so switching back can reuse it.
- Store global/user-level discovery data under a user/global scope only if it is genuinely not organisation-specific.
- Include impersonation/assumed-user identity in scope when `X-Doover-Assume` is active.

Open issue: `DooverClientConfig` currently carries `organisationId`, but user identity is only available through auth token claims or `users.getMe()`. v1 needs a reliable `userId` source before durable caching can be enabled. If identity cannot be established, the offline layer should refuse persistent caching or use a caller-provided scope.

## Freshness Metadata

Every durable record should carry metadata independent of the stored payload:

```ts
{
  cachedAt: number,
  lastAccessedAt: number,
  expiresAt: number | null,
  source: {
    sourceId: string,
    clientId: string
  },
  serverUpdatedAt?: number | null,
  schemaVersion: number,
  dooverJsVersion?: string,
  policyId?: string,
  queryKeyHash: string
}
```

Resource-specific freshness:

- Aggregates: preserve `aggregate.last_updated` as `serverUpdatedAt` and expose it unchanged to consumers.
- Messages: use each message `timestamp`; for a message window, also store `newestMessageTimestamp` and `oldestMessageTimestamp`.
- Channels/lists/agents: if the API does not expose server freshness, use `cachedAt` as the only reliable freshness value.
- Attachments: store `cachedAt`, `content_type`, `filename`, `size`, and any variant metadata.

Expiry:

- Default retention: 7 days.
- Retention should be configurable globally and overridable per policy/channel/resource.
- Expired records should not be used as normal cached data unless a caller explicitly allows expired fallback.
- A background or startup sweep should delete expired records opportunistically.

Schema compatibility:

- Include an offline cache schema version.
- On incompatible schema version, either clear affected records or ignore them until a migration path exists.
- Prefer small per-record versioning over one monolithic database version, because JSON records and blob records may evolve differently.

## Policy Model

Callers need to decide whether a request should populate offline cache and how much data to retain.

The policy should be expressed around Doover resources:

- channel aggregate policy
- channel message policy
- aggregate attachment policy
- message attachment policy
- list/discovery policy

Policy dimensions to support:

- cache enabled/disabled
- retention duration
- message depth: latest N, bounded `after`, or latest N per agent
- field projection awareness
- attachment inclusion rules
- attachment size/media-type rules
- thumbnail/variant preference
- max bytes per channel or per scope
- whether live gateway updates should update durable cache

Example policy intent, not final API:

```ts
{
  channel: { agentId, channelName: "camera" },
  messages: { mode: "latest", count: 3 },
  messageAttachments: {
    include: "metadata-and-selected-blobs",
    variants: ["thumbnail"],
    maxBytesPerAttachment: 200_000,
    contentTypes: ["image/jpeg", "image/png", "image/webp"]
  },
  aggregateAttachments: { include: "metadata-only" },
  retentionMs: 7 * 24 * 60 * 60 * 1000
}
```

For `tag_values`:

```ts
{
  channel: { channelName: "tag_values" },
  messages: { mode: "latest", count: 100 },
  messageAttachments: { include: "none" },
  retentionMs: 7 * 24 * 60 * 60 * 1000
}
```

The user asked for settings that can be specified both when getting data and through custom endpoints. That suggests two layers:

- Per-call cache options: used immediately for a read.
- Stored channel policies: persisted by the app or custom endpoint and consulted automatically on later reads/gateway updates.

For v1, `doover-js` should define the policy vocabulary and evaluation behavior, but custom endpoint transport can remain app-owned. A client app can fetch policy JSON from its endpoint and register it with the offline cache service.

## Attachment Caching

Attachments should be cached generically:

- Aggregate attachment metadata lives on `Aggregate.attachments`.
- Message attachment metadata lives on `MessageStructure.attachments`.
- Blob bodies are fetched through `getAggregateAttachment` and `getMessageAttachment`.

The cache should store metadata with the owning aggregate/message record even when blob bodies are not cached. Blob storage should be separate and referenced by owner/resource key.

Camera thumbnails should be represented as an attachment policy, not hard-coded camera behavior. The policy can select attachments by:

- owner kind: message or aggregate
- channel name/pattern
- message recency index
- content type
- filename pattern
- size limit
- variant hint, if the attachment URL or API eventually exposes thumbnail/full variants

Important current limitation: the `Attachment` type contains `url`, `content_type`, `filename`, and `size`, but no explicit attachment id or variant field. Existing attachment fetch APIs require `attachmentId`. Today callers likely infer that id from URL or server convention. A robust offline cache should either:

- introduce/derive a stable attachment identity helper in `doover-js`, or
- wait for attachment metadata to include explicit id/variant fields.

Without that, attachment blob caching is possible but brittle.

For camera-like channels, v1 should cache only selected image blobs that represent thumbnails/latest frames. It should not cache full video/media unless a policy explicitly opts in.

## React Query Hydration

Existing React hooks already have useful query keys:

- `channelAggregateQueryKey(agentId, channelName, sources)`
- `channelMessagesQueryKey(agentId, channelName, fields, sources)`
- `multiAgentAggregatesQueryKey(channelName, agentIds, fields, sources)`
- `multiAgentChannelMessagesQueryKey(channelName, agentIds, sources, { after, fields })`

Hydration should bridge durable records into those keys.

Recommended path:

1. On app/client startup, construct the offline cache with scope, storage, and policies.
2. Before rendering key offline-capable routes, hydrate relevant React Query entries from durable records.
3. When online reads succeed, write both React Query cache and durable cache.
4. Gateway `channelSync`, `aggregateUpdate`, and `messageCreate` should continue to patch React Query and, if policy permits, durable cache.
5. When offline, hooks should return cached data plus metadata indicating offline/stale state.

The existing hooks set `staleTime: Infinity`. That makes sense for live gateway-backed data, but offline state needs a separate concept of staleness. Do not rely solely on React Query's `isStale`; expose Doover offline metadata explicitly.

Possible consumer-facing shapes:

- Extend hook return values with `offline?: { source, cachedAt, serverUpdatedAt, isExpired, isOfflineFallback }`.
- Add companion hooks such as `useDooverOfflineStatus(queryKey)` or `useOfflineChannelAggregateMeta(identifier)`.
- Return wrapper objects from offline-aware APIs internally, while hooks unwrap payloads and expose metadata.

Recommendation: start with companion metadata or additive hook fields. Avoid changing the raw `DataClient` read return types in v1, because existing callers expect `Aggregate`, `MessageStructure[]`, etc.

## Online, Offline, and Stale State

`DataClientStatus` currently tracks gateway connection state, not full network reachability. Offline read caching needs a broader status model.

The offline layer should distinguish:

- online and fresh: network read succeeded recently
- online but stale: data exists but has not been refreshed within policy
- offline fallback: network unavailable and cached record used
- offline miss: network unavailable and no suitable cached record exists
- expired fallback: cached record is expired but caller explicitly allowed it

Expose this separately from gateway `connected`; a WebSocket can be disconnected while HTTP still works, and vice versa.

Native apps should be able to provide an online signal. Browser apps can default to `navigator.onLine` plus request failures, but should not depend on it as truth.

## Blocking Writes, RPC, and Commands Offline

When offline, do not send or queue:

- `messages.postMessage`
- `messages.putMessage`
- `messages.patchMessage`
- `messages.deleteMessage`
- `aggregates.putAggregate`
- `aggregates.patchAggregate`
- channel create/archive/unarchive
- non-core mutations
- `rpc.send`
- `gateway.sendOneShotMessage`
- likely `gateway.syncChannel`

Preferred behavior:

- Fail immediately with a typed error such as `DooverOfflineError`.
- Mark React mutations as errored, so UI can display "Unavailable offline".
- Do not alter durable cache as if the write succeeded.
- Do not enqueue anything for later replay.

The decorator layer can enforce this for API/RPC methods. Gateway one-shot behavior needs special handling because `GatewayClient.sendOneShotMessage` currently attempts to connect and returns if not connected; that is too quiet for offline command UX. An offline-aware gateway wrapper should fail explicitly.

## Storage Adapter Concept

`doover-js` should not hard-code IndexedDB, SQLite, AsyncStorage, filesystem, or secure storage. It should define the concepts it needs and let clients bind them.

Likely adapter responsibilities:

- read/write/delete JSON records by structured key/hash
- read/write/delete blob records
- list records by scope/resource prefix for sweeps and logout clearing
- transactional or batched writes where available
- report approximate storage usage if available
- clear all records for a user scope
- clear all records for a user+org scope
- optional encryption handled by adapter/app

Do not prescribe exact method names yet. During implementation design, validate against:

- native customer app persistence backend
- browser IndexedDB
- possible Node/file test adapter

The core should treat storage as asynchronous. Even browser IndexedDB and native stores are async, and sync localStorage is not a good blob/cache foundation.

## Applying Policies to Reads

Policy should be applied in two ways:

1. Stored channel policies are the normal path for app behavior.
2. Per-call request options provide explicit overrides for individual reads.

Stored policies let the native app, browser app, or a custom endpoint define durable behavior once per channel/resource. A normal read can then stay clean:

```ts
offlineCache.setChannelPolicy(
  { agentId, channelName: "tag_values" },
  {
    messages: { mode: "latest", count: 100 },
    messageAttachments: { include: "none" },
    retentionMs: 7 * 24 * 60 * 60 * 1000
  }
);

client.messages.listMessages(
  { agentId, channelName: "tag_values" },
  { limit: 100, field_name: ["value"] }
);
```

Per-call options should be available for one-off reads or call sites that need to override stored policy. They should let callers say:

- this read should be cached
- this read should use policy X
- this read should prefer cache/network
- this read should retain latest N messages
- attachments should be cached according to policy

The low-ceremony form should be a trailing request-options bag. This matches the existing `MultiplexClient` `{ sources }` convention and keeps call sites simple:

```ts
client.messages.listMessages(
  { agentId, channelName },
  { limit: 100, field_name: ["value"] },
  {
    sources: ["cloud"],
    cache: {
      mode: "read-through",
      policy: "tag-values-history"
    }
  }
)
```

For call sites that want the cross-cutting nature of the options to be explicit, expose a helper that produces the same tagged/options bag:

```ts
client.messages.listMessages(
  { agentId, channelName },
  { limit: 100, field_name: ["value"] },
  requestOptions({
    sources: ["cloud"],
    cache: {
      mode: "read-through",
      policy: "tag-values-history"
    }
  })
)
```

The helper can mark the bag internally, for example with a symbol, so overload resolution and runtime parsing can distinguish request options from endpoint params where necessary. Plain object trailing bags should remain supported for ergonomics, but the helper is the recommended style in ambiguous or shared-library code.

The request-options bag should carry both existing `sources` and new `cache` settings rather than adding separate trailing arguments. That keeps source selection, offline cache behavior, and future cross-cutting request metadata in one place.

Stored/custom endpoint policy flow:

1. App fetches policy config from custom endpoint while online.
2. App registers it with the offline cache service.
3. Offline cache service stores it under `policies.channel`.
4. Later reads and gateway updates consult the stored policy.

## Multi-Agent Reads

`agents.getMultiAgentAggregates` and `agents.getMultiAgentMessages` are important because customer app navigation may fetch the same channel across many agents.

Recommended behavior:

- Store normalized per-agent aggregate/message records as well as enough query-window metadata to rehydrate the exact multi-agent query.
- For multi-agent aggregates, seed individual `aggregates.get` records by agent/channel, mirroring what `useMultiAgentAggregates` already does for React Query.
- For multi-agent messages, preserve pagination metadata such as `next`, `next_cursors`, and agent limits if the cached response is meant to support offline pagination.
- v1 can keep offline pagination shallow: hydrate the latest cached window only, then report that older pages are unavailable offline unless already cached.

## Gateway Updates and Durable Cache

When online, gateway events should update durable cache if policy allows:

- `ChannelSync` / `AggregateUpdate`: update aggregate record, `serverUpdatedAt`, and React Query.
- `MessageCreate`: insert into message windows/by-id records, enforce latest-N retention, and evaluate attachment policy.
- `MessageUpdate`: update by-id record and any window containing that message.

Potential risk: durable writes on high-frequency channels can be expensive. Policies should allow disabling live durable writes or coalescing/debouncing them for noisy channels.

## Cache Clearing Policy

Required behavior:

- Logout: clear cache for the authenticated user, or all user-scoped cache if identity is unavailable.
- User change: clear or switch scopes so previous user's data is inaccessible. Prefer clearing previous user's records unless the app has a multi-account design.
- Organisation switch: do not clear globally. Switch active org scope; use cached records for the new org if present.
- Retention expiry: sweep expired records opportunistically.
- Manual clear: provide app-level hook to clear offline cache.

Native app should call the offline cache lifecycle methods from auth/session lifecycle. `doover-js` can expose helpers, but it probably cannot infer every app logout path safely.

## Recommended V1 Scope

Start narrow but with the right foundation:

- `agents.listAgents`
- `channels.listChannels`
- `channels.getChannel`
- `aggregates.getAggregate`
- `messages.listMessages`
- `messages.getMessage`
- `agents.getMultiAgentAggregates`
- `agents.getMultiAgentMessages`
- aggregate/message attachment metadata
- selected attachment blob caching through generic policies
- React hydration for existing aggregate/message hooks
- online/offline/cache metadata exposure
- offline blocking for writes/RPC/one-shot commands
- retention, schema versioning, logout/user-change clearing

Leave these for later:

- complete non-core API caching
- timeseries-specific cache beyond message-derived data
- full offline pagination
- cache migrations beyond clear-on-incompatible-version
- encrypted storage policy in core
- queued writes
- media/video caching
- service worker/browser HTTP-level caching

## Risks

- Attachment identity is under-specified in current types. Blob caching needs a stable id/variant story.
- User identity may not be available early enough to safely enable persistent caching without a caller-provided scope.
- Existing API overloads are already stretched by trailing `{ sources }`; adding a combined `{ sources, cache }` request-options bag needs careful parsing and typing, especially while preserving plain-object ergonomics and the explicit `requestOptions(...)` helper.
- React Query `staleTime: Infinity` can hide freshness problems unless offline metadata is explicit.
- High-frequency channels can cause heavy durable writes if gateway updates are persisted naively.
- Multi-agent and multiplex source merging can obscure where a cached record came from unless source scope is explicit.
- Policies fetched from custom endpoints need validation/versioning so stale policy config does not cause surprising retention.
- Cache size can grow quickly if attachment policies are too permissive.

## Open Questions

- What is the canonical user id source for cache scoping: token `sub`/Doover id, `users.getMe()`, or app-provided identity?
- Should logout clear only current user scope, or all offline cache on the device?
- Does organisation id in `DooverClientConfig` always reflect the data partition for channel resources?
- How should impersonation be represented in cache scope?
- Can attachment metadata expose explicit `id`, `variant`, and maybe thumbnail/full relationships?
- Should policy be configured entirely by app code, or should `doover-js` provide a standard endpoint fetch/register helper?
- Should offline cached reads return expired data by default with strong warnings, or treat expired records as misses?
- Should React hook offline metadata be additive fields or exposed through companion hooks?
- How should `MultiplexClient` cache merged cloud/local reads when both sources return the same resource?
- Should local agent caches be scoped under the cloud user/org when the app is authenticated, or under a separate local source identity?

## Summary Recommendation

Build the offline foundation as an optional domain-aware `DataClient` offline layer with pluggable async storage, structured scoped keys, explicit freshness metadata, and policy-driven resource/attachment retention. Use it to hydrate existing React Query hooks rather than persisting React Query wholesale. Keep v1 read-only, cache only the core channel/agent/message/aggregate surfaces, block all offline writes/RPC/commands with typed errors, and treat camera thumbnails as a generic attachment policy over latest message or aggregate attachments.
