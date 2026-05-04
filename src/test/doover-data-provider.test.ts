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
    expect(fetchMock.getCall(1).args[0]).to.equal("https://control.example.com/agents/");
    expect((fetchMock.getCall(0).args[1]?.headers as Headers).get("X-Doover-Sharing")).to.equal("internal");
    expect((fetchMock.getCall(1).args[1]?.headers as Headers).get("X-Doover-Sharing")).to.equal(null);
  });

  it("getAgents forwards include-archived/include-organisations/include-users query keys", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({ agents: [], organisations: [], users: [] }),
    );
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    await provider.getAgents({
      includeArchived: true,
      includeOrganisations: true,
      includeUsers: true,
    });

    const url = fetchMock.getCall(0).args[0] as string;
    expect(url.startsWith("https://control.example.com/agents/?")).to.equal(true);
    expect(url).to.include("include-archived=true");
    expect(url).to.include("include-organisations=true");
    expect(url).to.include("include-users=true");
  });

  it("getAgents preserves raw organisations/users without merging by default", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({
        agents: [
          {
            id: "a1",
            name: "agent-1",
            display_name: "Agent 1",
            type: "device",
            organisation: "Org 1",
            group: "g",
            archived: false,
            fa_icon: "fa-solid fa-robot",
            fixed_location: { latitude: 1, longitude: 2 },
            extra_config: {},
          },
        ],
        organisations: [{ id: "o1", name: "Org 1" }],
        users: [{ id: "u1", username: "alice" }],
      }),
    );
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const result = await provider.getAgents({
      includeOrganisations: true,
      includeUsers: true,
    });

    expect(result.agents).to.have.lengthOf(1);
    expect(result.agents?.[0].id).to.equal("a1");
    expect(result.organisations).to.deep.equal([{ id: "o1", name: "Org 1" }]);
    expect(result.users).to.deep.equal([{ id: "u1", username: "alice" }]);
    expect(result.results).to.equal(undefined);
    expect(result.count).to.equal(undefined);
  });

  it("getAgents merges normalized organisations and users when mergeIncludedAsAgents is true", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({
        agents: [
          {
            id: "a1",
            name: "agent-1",
            display_name: "Agent 1",
            type: "device",
            organisation: "Org 1",
            group: "g",
            archived: false,
            fa_icon: "fa-solid fa-robot",
            fixed_location: { latitude: 1, longitude: 2 },
            extra_config: { foo: "bar" },
          },
        ],
        organisations: [
          {
            id: "o1",
            name: "Org One",
            archived: false,
            root_group: { name: "root" },
            extra_config: { level: "premium" },
          },
        ],
        users: [
          {
            id: "u1",
            username: "alice",
            email: "alice@example.com",
            first_name: "Alice",
            last_name: "Anderson",
            custom_data: { theme: "dark" },
          },
        ],
      }),
    );
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const result = await provider.getAgents({
      includeOrganisations: true,
      includeUsers: true,
      mergeIncludedAsAgents: true,
    });

    expect(result.agents).to.have.lengthOf(3);
    expect(result.results).to.equal(result.agents);
    expect(result.count).to.equal(3);

    const [agent, organisation, user] = result.agents!;
    expect(agent.id).to.equal("a1");
    expect(agent.type).to.equal("device");

    expect(organisation).to.deep.equal({
      id: "o1",
      organisation: "Org One",
      name: "Org One",
      display_name: "Org One",
      archived: false,
      group: "root",
      fa_icon: "fa-solid fa-building",
      type: "organisation",
      fixed_location: { latitude: 0, longitude: 0 },
      extra_config: { level: "premium" },
    });

    expect(user).to.deep.equal({
      id: "u1",
      organisation: "",
      name: "alice",
      display_name: "Alice Anderson",
      archived: false,
      group: "",
      fa_icon: "fa-solid fa-user",
      type: "user",
      fixed_location: { latitude: 0, longitude: 0 },
      extra_config: { theme: "dark" },
    });
  });

  it("getAgents merge respects includeOrganisations/includeUsers flags", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({
        agents: [
          {
            id: "a1",
            name: "a1",
            display_name: "a1",
            type: "device",
            organisation: "o",
            group: "g",
            archived: false,
            fa_icon: "fa-solid fa-robot",
            fixed_location: { latitude: 0, longitude: 0 },
            extra_config: {},
          },
        ],
        organisations: [{ id: "o1", name: "Org 1" }],
        users: [{ id: "u1", username: "alice" }],
      }),
    );
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const result = await provider.getAgents({
      includeOrganisations: false,
      includeUsers: true,
      mergeIncludedAsAgents: true,
    });

    expect(result.agents).to.have.lengthOf(2);
    expect(result.agents?.map((entry) => entry.type)).to.deep.equal([
      "device",
      "user",
    ]);
    expect(result.count).to.equal(2);
  });

  it("getAgents user display_name falls back through full name, username, email, id", async () => {
    let payload: object = {};
    const fetchMock = createFetchMock(() => createJsonResponse(payload));
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    payload = {
      agents: [],
      users: [
        {
          id: "u-full",
          username: "alice",
          email: "alice@example.com",
          first_name: "Alice",
          last_name: "Anderson",
        },
        { id: "u-username", username: "bob", email: "bob@example.com" },
        { id: "u-email", email: "carol@example.com" },
        { id: "u-id-only" },
      ],
    };
    const result = await provider.getAgents({
      includeUsers: true,
      mergeIncludedAsAgents: true,
    });
    const merged = result.agents ?? [];
    expect(merged.map((entry) => entry.display_name)).to.deep.equal([
      "Alice Anderson",
      "bob",
      "carol@example.com",
      "u-id-only",
    ]);
    expect(merged.map((entry) => entry.name)).to.deep.equal([
      "alice",
      "bob",
      "carol@example.com",
      "u-id-only",
    ]);
  });

  it("getAgents fills agent defaults when fa_icon, fixed_location, or extra_config are missing/null", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({
        agents: [
          {
            id: "a1",
            name: "a1",
            display_name: "a1",
            type: "device",
            organisation: "o",
            group: "g",
            archived: false,
            fa_icon: null,
            fixed_location: null,
            extra_config: null,
          },
          {
            id: "a2",
            name: "a2",
            display_name: "a2",
            type: "device",
            organisation: "o",
            group: "g",
            archived: false,
            // fa_icon, fixed_location, extra_config all missing
          },
        ],
      }),
    );
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const result = await provider.getAgents();
    const [withNulls, withMissing] = result.agents ?? [];

    expect(withNulls.fa_icon).to.equal("fa-solid fa-robot");
    expect(withNulls.fixed_location).to.deep.equal({ latitude: 0, longitude: 0 });
    expect(withNulls.extra_config).to.deep.equal({});

    expect(withMissing.fa_icon).to.equal("fa-solid fa-robot");
    expect(withMissing.fixed_location).to.deep.equal({ latitude: 0, longitude: 0 });
    expect(withMissing.extra_config).to.deep.equal({});
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

  it("forwards listMessages options (limit, after, field_name)", async () => {
    const fetchMock = createFetchMock(() => createJsonResponse([]));
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    await provider.getMessages(
      { agentId: "a1", channelName: "c1" },
      { before: "b1", after: "a1", limit: 50, field_name: ["x", "y"] },
    );

    const url = fetchMock.getCall(0).args[0] as string;
    expect(url).to.include("before=b1");
    expect(url).to.include("after=a1");
    expect(url).to.include("limit=50");
    expect(url).to.include("field_name=x");
    expect(url).to.include("field_name=y");
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

  it("sendRPC posts an rpc message, correlates the response by id, and resolves on success", async () => {
    const rpcId = generateSnowflakeIdAtTime(new Date("2026-01-01T00:00:00.000Z"));
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith("/messages")) {
        return createJsonResponse({
          id: rpcId,
          author_id: "u1",
          channel: { agent_id: "a1", name: "c1" },
          data: {
            type: "rpc",
            method: "ping",
            request: {},
            status: { code: "sent" },
            response: {},
          },
          attachments: [],
        });
      }
      return createJsonResponse({});
    });
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const statuses: string[] = [];
    const promise = provider.sendRPC<object, { pong: true }>(
      { agentId: "a1", channelName: "c1" },
      { method: "ping", request: {} },
      { onStatus: (status) => statuses.push(status.code) },
    );

    // Let subscribe + POST resolve.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.receive({ op: 0, t: "Hello", d: {} });
    ws.receive({
      op: 0,
      t: "Ready",
      d: { session_id: "s1", session_token: "t1", subscriptions: [] },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    // Progress updates.
    ws.receive({
      op: 0,
      t: "MessageUpdate",
      d: {
        channel: { agent_id: "a1", name: "c1" },
        author_id: "u1",
        message: {
          id: rpcId,
          author_id: "u1",
          channel: { agent_id: "a1", name: "c1" },
          data: {
            type: "rpc",
            method: "ping",
            request: {},
            status: { code: "acknowledged", message: { timestamp: 1 } },
            response: {},
          },
          attachments: [],
        },
        request_data: { status: { code: "acknowledged", message: { timestamp: 1 } } },
      },
    });
    ws.receive({
      op: 0,
      t: "MessageUpdate",
      d: {
        channel: { agent_id: "a1", name: "c1" },
        author_id: "u1",
        message: {
          id: rpcId,
          author_id: "u1",
          channel: { agent_id: "a1", name: "c1" },
          data: {
            type: "rpc",
            method: "ping",
            request: {},
            status: { code: "success" },
            response: { pong: true },
          },
          attachments: [],
        },
        request_data: { status: { code: "success" }, response: { pong: true } },
      },
    });

    await expect(promise).to.eventually.deep.equal({ pong: true });
    expect(statuses).to.deep.equal(["acknowledged", "success"]);
  });

  it("sendRPC rejects with the status message on error", async () => {
    const rpcId = generateSnowflakeIdAtTime(new Date("2026-01-01T00:00:00.000Z"));
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith("/messages")) {
        return createJsonResponse({
          id: rpcId,
          author_id: "u1",
          channel: { agent_id: "a1", name: "c1" },
          data: {
            type: "rpc",
            method: "ping",
            request: {},
            status: { code: "sent" },
            response: {},
          },
          attachments: [],
        });
      }
      return createJsonResponse({});
    });
    const provider = new DooverDataProvider({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const promise = provider.sendRPC(
      { agentId: "a1", channelName: "c1" },
      { method: "ping", request: {} },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.receive({ op: 0, t: "Hello", d: {} });
    ws.receive({
      op: 0,
      t: "Ready",
      d: { session_id: "s1", session_token: "t1", subscriptions: [] },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    ws.receive({
      op: 0,
      t: "MessageUpdate",
      d: {
        channel: { agent_id: "a1", name: "c1" },
        author_id: "u1",
        message: {
          id: rpcId,
          author_id: "u1",
          channel: { agent_id: "a1", name: "c1" },
          data: {
            type: "rpc",
            method: "ping",
            request: {},
            status: { code: "error", message: "boom" },
            response: {},
          },
          attachments: [],
        },
        request_data: { status: { code: "error", message: "boom" } },
      },
    });

    await expect(promise).to.eventually.be.rejectedWith("boom");
  });
});
