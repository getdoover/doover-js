import { expect, use } from "chai";
import chaiAsPromised from "chai-as-promised";
import { beforeEach, describe, it } from "mocha";
import sinon from "sinon";

import { DooverValidationError } from "../http/errors";
import { DooverDataProvider } from "../viewer/doover-data-provider";
import { generateSnowflakeIdAtTime } from "../utils/snowflake";
import { createFetchMock, createJsonResponse, installSessionStorageMock, MockWebSocket } from "./helpers";

use(chaiAsPromised);

describe("DooverDataProvider", () => {
  beforeEach(() => {
    installSessionStorageMock();
    MockWebSocket.reset();
    Object.defineProperty(globalThis, "WebSocket", {
      value: MockWebSocket,
      configurable: true,
      writable: true,
    });
  });

  it("calls control endpoints for getMe and getAgents", async () => {
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith("/users/me")) {
        return createJsonResponse({ id: "u1" });
      }
      return createJsonResponse({ agents: [] });
    });
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    await expect(provider.getMe()).to.eventually.deep.equal({ id: "u1" });
    await expect(provider.getAgents()).to.eventually.deep.equal({ agents: [] });
    expect(fetchMock.getCall(0).args[0]).to.equal("https://control.example.com/users/me");
    expect(fetchMock.getCall(1).args[0]).to.equal("https://control.example.com/agents");
    expect((fetchMock.getCall(0).args[1]?.headers as Headers).get("X-Doover-Sharing")).to.equal("internal");
    expect((fetchMock.getCall(1).args[1]?.headers as Headers).get("X-Doover-Sharing")).to.equal(null);
  });

  it("returns undefined for missing identifiers where expected", async () => {
    const fetchMock = createFetchMock();
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    await expect(provider.getChannels({})).to.eventually.equal(undefined);
    await expect(provider.getChannel({ agentId: "a1" })).to.eventually.equal(undefined);
    await expect(provider.getAggregate({ channelName: "c1" })).to.eventually.equal(undefined);
    await expect(provider.getMessages({})).to.eventually.equal(undefined);
    expect(fetchMock.callCount).to.equal(0);
  });

  it("creates channels with public and private options", async () => {
    const fetchMock = createFetchMock(() => createJsonResponse({ name: "c1", owner_id: "a1", is_private: false }));
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    await provider.createChannel({ agentId: "a1", channelName: "ignored" }, "c1");
    await provider.createChannel({ agentId: "a1" }, "c2", { is_private: true });

    const firstBody = JSON.parse(fetchMock.getCall(0).args[1]?.body as string);
    const secondBody = JSON.parse(fetchMock.getCall(1).args[1]?.body as string);

    expect(firstBody).to.deep.equal({ is_private: false });
    expect(secondBody).to.deep.equal({ is_private: true });
  });

  it("fetches messages with the compatibility limit and reverses them", async () => {
    const oldId = generateSnowflakeIdAtTime(new Date("2026-01-01T00:00:00.000Z"));
    const newId = generateSnowflakeIdAtTime(new Date("2026-01-01T00:00:10.000Z"));
    const fetchMock = createFetchMock(() =>
      createJsonResponse([
        {
          id: newId,
          author_id: "u1",
          channel: { agent_id: "a1", name: "c1" },
          data: { v: 2 },
          attachments: [],
        },
        {
          id: oldId,
          author_id: "u1",
          channel: { agent_id: "a1", name: "c1" },
          data: { v: 1 },
          attachments: [],
        },
      ]),
    );
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const messages = await provider.getMessages({ agentId: "a1", channelName: "c1" }, "cursor");

    expect(messages?.map((message) => message.id)).to.deep.equal([oldId, newId]);
    expect(fetchMock.getCall(0).args[0]).to.equal(
      "https://api.example.com/agents/a1/channels/c1/messages?before=cursor&limit=10",
    );
  });

  it("prefers channel aggregate data and falls back to the aggregate endpoint", async () => {
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith("/channels/c1")) {
        return createJsonResponse({ name: "c1", owner_id: "a1", is_private: false, aggregate: { data: { x: 1 }, attachments: [] } });
      }
      return createJsonResponse({ data: { y: 2 }, attachments: [] });
    });
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    await expect(
      provider.getAggregate({ agentId: "a1", channelName: "c1" }),
    ).to.eventually.deep.equal({ data: { x: 1 }, attachments: [] });

    const fallbackFetch = createFetchMock((url) => {
      if (url.endsWith("/channels/c1")) {
        return createJsonResponse({ name: "c1", owner_id: "a1", is_private: false });
      }
      return createJsonResponse({ data: { y: 2 }, attachments: [] });
    });
    const fallbackProvider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fallbackFetch as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    await expect(
      fallbackProvider.getAggregate({ agentId: "a1", channelName: "c1" }),
    ).to.eventually.deep.equal({ data: { y: 2 }, attachments: [] });
  });

  it("maps websocket events to subscription callbacks and unsubscribes when the last listener is removed", async () => {
    const fetchMock = createFetchMock(() => createJsonResponse({}));
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const onMessage = sinon.spy();
    const onAggregate = sinon.spy();
    await provider.subscribeToChannel({ agentId: "a1", channelName: "c1" }, onMessage, onAggregate);

    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.receive({ op: 0, t: "Hello", d: {} });
    ws.receive({
      op: 0,
      t: "Ready",
      d: { session_id: "s1", session_token: "t1", subscriptions: [] },
    });

    const id = generateSnowflakeIdAtTime(new Date("2026-01-01T00:00:00.000Z"));
    ws.receive({
      op: 0,
      t: "MessageCreate",
      d: {
        id,
        author_id: "u1",
        channel: { agent_id: "a1", name: "c1" },
        data: {},
        attachments: [],
      },
    });
    ws.receive({
      op: 0,
      t: "ChannelSync",
      d: {
        channel: { agent_id: "a1", name: "c1" },
        aggregate: { data: { x: 1 }, attachments: [] },
      },
    });
    ws.receive({
      op: 0,
      t: "AggregateUpdate",
      d: {
        author_id: "u1",
        channel: { agent_id: "a1", name: "c1" },
        aggregate: { data: { x: 2 }, attachments: [] },
        request_data: { data: {}, attachments: [] },
        organisation_id: "org-1",
      },
    });

    expect(
      onMessage.calledWithMatch(
        { agentId: "a1", channelName: "c1" },
        sinon.match({ id }),
      ),
    ).to.equal(true);
    expect(onAggregate.callCount).to.equal(2);

    await provider.unsubscribeFromChannel({ agentId: "a1", channelName: "c1" }, onMessage);
    expect(JSON.parse(ws.sent[ws.sent.length - 1] as string)).to.deep.include({ op: 13 });
  });

  it("throws validation errors for required channel operations", async () => {
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: createFetchMock() as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    expect(() => provider.createChannel({}, "c1")).to.throw(DooverValidationError);
    expect(() => provider.archiveChannel({ agentId: "a1" })).to.throw(DooverValidationError);
    await expect(
      provider.unsubscribeFromChannel({ agentId: "a1", channelName: "c1" }, sinon.spy()),
    ).to.be.rejectedWith(DooverValidationError);
  });

  it("returns the compatibility agent info shim and path parsing result", async () => {
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: createFetchMock() as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    await expect(provider.getAgentInfo("a1")).to.eventually.deep.equal({
      id: "a1",
      name: "a1",
      display_name: "a1",
      type: "device",
      fa_icon: "fa-solid fa-robot",
      organisation: "Organisation",
      group: "group",
      archived: false,
      fixed_location: { latitude: 0, longitude: 0 },
      extra_config: {},
    });

    expect(
      provider.getIdentifierFromPath("/a1/c1/path/to/value", new URLSearchParams()),
    ).to.deep.equal({
      identifier: { agentId: "a1", channelName: "c1" },
      aggregatePath: "path/to/value",
    });
  });
});
