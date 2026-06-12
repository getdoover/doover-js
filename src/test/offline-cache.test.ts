import { expect } from "chai";
import { describe, it } from "mocha";

import { DooverClient } from "../client/doover-client";
import {
  MemoryOfflineStorageAdapter,
  OfflineDataClient,
} from "../client/offline-cache";
import {
  REQUEST_OPTIONS_SYMBOL,
  requestOptions,
} from "../client/request-options";
import { DooverOfflineError } from "../client/errors";
import { generateSnowflakeIdAtTime } from "../utils/snowflake";
import { MockWebSocket, createBlobResponse, createFetchMock, createJsonResponse } from "./helpers";

function makeOnlineClient(fetchImpl: typeof fetch) {
  return new DooverClient({
    dataRestUrl: "https://api.example.com",
    controlApiUrl: "https://control.example.com",
    dataWssUrl: "wss://ws.example.com",
    fetchImpl,
    webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    disableBrowserLifecycleHooks: true,
  });
}

describe("requestOptions", () => {
  it("marks a request-options bag explicitly", () => {
    const options = requestOptions({
      sources: ["cloud"],
      cache: { policy: "tag-values-history" },
    });
    expect(options[REQUEST_OPTIONS_SYMBOL]).to.equal(true);
    expect(options.sources).to.deep.equal(["cloud"]);
  });
});

describe("OfflineDataClient", () => {
  it("caches reads covered by a stored channel policy and serves them offline", async () => {
    let online = true;
    const messageId = generateSnowflakeIdAtTime(new Date("2026-06-10T00:00:00Z"));
    const fetchMock = createFetchMock((url) => {
      if (url.includes("/agents/a1/channels/tag_values/messages")) {
        return createJsonResponse([
          {
            id: messageId,
            data: { value: 42 },
            attachments: [],
            author_id: "u1",
            channel: { agent_id: "a1", name: "tag_values" },
          },
        ]);
      }
      return createJsonResponse({ ok: true });
    });
    const storage = new MemoryOfflineStorageAdapter();
    const client = new OfflineDataClient({
      client: makeOnlineClient(fetchMock as typeof fetch),
      storage,
      scope: { userId: "u1", organisationId: "org1", sourceId: "cloud" },
      isOnline: () => online,
    });
    client.setChannelPolicy({
      id: "tag-values-history",
      channel: { agentId: "a1", channelName: "tag_values" },
      messages: { mode: "latest", count: 100 },
    });

    const onlineMessages = await client.messages.listMessages(
      { agentId: "a1", channelName: "tag_values" },
      { limit: 100, order: "asc" },
    );
    expect(onlineMessages.map((message) => message.data)).to.deep.equal([{ value: 42 }]);

    online = false;
    const offlineMessages = await client.messages.listMessages(
      { agentId: "a1", channelName: "tag_values" },
      { limit: 100, order: "asc" },
    );
    expect(offlineMessages).to.deep.equal(onlineMessages);
    expect(fetchMock.callCount).to.equal(1);
  });

  it("supports per-call cache opt-in for discovery reads", async () => {
    let online = true;
    const fetchMock = createFetchMock((url) => {
      if (url.includes("/agents/")) {
        return createJsonResponse({
          agents: [
            {
              id: "a1",
              organisation: "org1",
              name: "pump",
              display_name: "Pump",
              archived: false,
              group: "",
              type: "device",
              fixed_location: { latitude: 0, longitude: 0 },
              extra_config: {},
            },
          ],
          count: 1,
        });
      }
      return createJsonResponse({ ok: true });
    });
    const client = new OfflineDataClient({
      client: makeOnlineClient(fetchMock as typeof fetch),
      storage: new MemoryOfflineStorageAdapter(),
      scope: { userId: "u1", organisationId: "org1", sourceId: "cloud" },
      isOnline: () => online,
    });

    const onlineAgents = await client.agents.listAgents(
      requestOptions({ cache: { mode: "read-through", policy: "agents" } }),
    );
    expect((onlineAgents.agents ?? []).map((agent) => agent.id)).to.deep.equal(["a1"]);

    online = false;
    const offlineAgents = await client.agents.listAgents(
      requestOptions({ cache: { mode: "read-through", policy: "agents" } }),
    );
    expect(offlineAgents).to.deep.equal(onlineAgents);
    expect(fetchMock.callCount).to.equal(1);
  });

  it("fails writes immediately while offline", async () => {
    const fetchMock = createFetchMock();
    const client = new OfflineDataClient({
      client: makeOnlineClient(fetchMock as typeof fetch),
      storage: new MemoryOfflineStorageAdapter(),
      scope: { userId: "u1", organisationId: "org1", sourceId: "cloud" },
      isOnline: () => false,
    });

    let error: unknown;
    try {
      await client.messages.postMessage(
        { agentId: "a1", channelName: "commands" },
        { data: { run: true } },
      );
    } catch (err) {
      error = err;
    }

    expect(error).to.be.instanceOf(DooverOfflineError);
    expect(fetchMock.callCount).to.equal(0);
  });

  it("honours cache: false even when a stored policy exists", async () => {
    let online = true;
    const fetchMock = createFetchMock((url) => {
      if (url.includes("/agents/a1/channels/tag_values/messages")) {
        return createJsonResponse([
          {
            id: generateSnowflakeIdAtTime(new Date("2026-06-10T00:00:00Z")),
            data: { value: 1 },
            attachments: [],
            author_id: "u1",
            channel: { agent_id: "a1", name: "tag_values" },
          },
        ]);
      }
      return createJsonResponse({ ok: true });
    });
    const client = new OfflineDataClient({
      client: makeOnlineClient(fetchMock as typeof fetch),
      storage: new MemoryOfflineStorageAdapter(),
      scope: { userId: "u1", organisationId: "org1", sourceId: "cloud" },
      isOnline: () => online,
    });
    client.setChannelPolicy({
      id: "tag-values-history",
      channel: { agentId: "a1", channelName: "tag_values" },
      messages: { mode: "latest", count: 100 },
    });

    await client.messages.listMessages(
      { agentId: "a1", channelName: "tag_values" },
      { limit: 100, order: "asc" },
      requestOptions({ cache: false }),
    );

    online = false;
    let error: unknown;
    try {
      await client.messages.listMessages(
        { agentId: "a1", channelName: "tag_values" },
        { limit: 100, order: "asc" },
        requestOptions({ cache: false }),
      );
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(DooverOfflineError);
  });

  it("tracks expired cached records and requires allowExpired to read them", async () => {
    let online = true;
    const fetchMock = createFetchMock((url) => {
      if (url.includes("/agents/")) return createJsonResponse({ agents: [], count: 0 });
      return createJsonResponse({ ok: true });
    });
    const client = new OfflineDataClient({
      client: makeOnlineClient(fetchMock as typeof fetch),
      storage: new MemoryOfflineStorageAdapter(),
      scope: { userId: "u1", organisationId: "org1", sourceId: "cloud" },
      isOnline: () => online,
    });

    await client.agents.listAgents(
      requestOptions({ cache: { mode: "read-through", retentionMs: 1 } }),
    );
    await new Promise((resolve) => setTimeout(resolve, 5));
    online = false;

    let error: unknown;
    try {
      await client.agents.listAgents(
        requestOptions({ cache: { mode: "read-through" } }),
      );
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(DooverOfflineError);
    expect(client.getOfflineStatus().state).to.equal("cache-miss");

    const expired = await client.agents.listAgents(
      requestOptions({ cache: { mode: "read-through", allowExpired: true } }),
    );
    expect(expired.agents).to.deep.equal([]);
    expect(client.getOfflineStatus().isExpired).to.equal(true);
  });

  it("persists gateway messages into latest-N cache according to channel policy", async () => {
    let online = true;
    const fetchMock = createFetchMock();
    const client = new OfflineDataClient({
      client: makeOnlineClient(fetchMock as typeof fetch),
      storage: new MemoryOfflineStorageAdapter(),
      scope: { userId: "u1", organisationId: "org1", sourceId: "cloud" },
      isOnline: () => online,
    });
    client.setChannelPolicy({
      id: "camera-latest",
      channel: { agentId: "a1", channelName: "camera" },
      messages: { mode: "latest", count: 2 },
    });

    client.gateway.subscribeToChannel(
      { agent_id: "a1", name: "camera" },
      {},
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.open();
    ws.receive({ op: 0, t: "Hello", d: {} });
    ws.receive({
      op: 0,
      t: "Ready",
      d: { session_id: "s1", session_token: "t1", subscriptions: [] },
    });
    for (const [idx, iso] of [
      "2026-06-10T00:00:00Z",
      "2026-06-10T00:01:00Z",
      "2026-06-10T00:02:00Z",
    ].entries()) {
      ws.receive({
        op: 0,
        t: "MessageCreate",
        d: {
          id: generateSnowflakeIdAtTime(new Date(iso)),
          data: { idx },
          attachments: [],
          author_id: "u1",
          channel: { agent_id: "a1", name: "camera" },
        },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    online = false;
    const messages = await client.messages.listMessages(
      { agentId: "a1", channelName: "camera" },
      { limit: 10, order: "asc" },
    );
    expect(messages.map((message) => message.data)).to.deep.equal([
      { idx: 1 },
      { idx: 2 },
    ]);
    expect(client.getOfflineStatus().state).to.equal("cache-fallback");
  });

  it("notifies offline status listeners when cached data is used", async () => {
    let online = true;
    const fetchMock = createFetchMock((url) => {
      if (url.includes("/agents/")) return createJsonResponse({ agents: [], count: 0 });
      return createJsonResponse({ ok: true });
    });
    const client = new OfflineDataClient({
      client: makeOnlineClient(fetchMock as typeof fetch),
      storage: new MemoryOfflineStorageAdapter(),
      scope: { userId: "u1", organisationId: "org1", sourceId: "cloud" },
      isOnline: () => online,
    });
    const seen: string[] = [];
    const off = client.onOfflineStatusChange((status) => seen.push(status.state));

    await client.agents.listAgents(
      requestOptions({ cache: { mode: "read-through" } }),
    );
    online = false;
    await client.agents.listAgents(
      requestOptions({ cache: { mode: "read-through" } }),
    );
    off();

    expect(seen).to.include("online");
    expect(seen).to.include("cache-fallback");
  });

  it("caches selected attachment blobs through the blob storage adapter", async () => {
    let online = true;
    const fetchMock = createFetchMock((url) => {
      if (url.includes("/attachments/thumb1")) {
        return createBlobResponse("thumbnail-bytes", {
          headers: { "content-type": "image/jpeg" },
        });
      }
      return createJsonResponse({ ok: true });
    });
    const client = new OfflineDataClient({
      client: makeOnlineClient(fetchMock as typeof fetch),
      storage: new MemoryOfflineStorageAdapter(),
      scope: { userId: "u1", organisationId: "org1", sourceId: "cloud" },
      isOnline: () => online,
    });
    client.setChannelPolicy({
      id: "camera-thumbnails",
      channel: { agentId: "a1", channelName: "camera" },
      messageAttachments: { include: "metadata-and-selected-blobs" },
    });

    const onlineBlob = await client.messages.getMessageAttachment(
      { agentId: "a1", channelName: "camera" },
      "m1",
      "thumb1",
    );
    expect(await onlineBlob.text()).to.equal("thumbnail-bytes");

    online = false;
    const offlineBlob = await client.messages.getMessageAttachment(
      { agentId: "a1", channelName: "camera" },
      "m1",
      "thumb1",
    );
    expect(await offlineBlob.text()).to.equal("thumbnail-bytes");
    expect(fetchMock.callCount).to.equal(1);
  });
});
