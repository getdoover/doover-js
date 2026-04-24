import { expect } from "chai";
import { afterEach, beforeEach, describe, it } from "mocha";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import sinon from "sinon";
import React from "react";

import { DooverClient } from "../client/doover-client";
import {
  DooverProvider,
  channelAggregateQueryKey,
  getSharedQueryClient,
  resetSharedQueryClient,
  useAgentChannel,
  useAgentConnections,
  useChannelMessages,
  useConnectionState,
  useDooverClient,
  useSendMessage,
  useSendRpc,
  useUpdateAggregate,
} from "../react";
import { createFetchMock, createJsonResponse, installSessionStorageMock, MockWebSocket } from "./helpers";
import { generateSnowflakeIdAtTime } from "../utils/snowflake";

function makeClient() {
  const fetchMock = createFetchMock((url) => {
    if (url.endsWith("/wss_connections")) {
      return createJsonResponse([{ address: "x", agent_id: "a1" }]);
    }
    return createJsonResponse({});
  });
  const client = new DooverClient({
    dataRestUrl: "https://api.example.com",
    controlApiUrl: "https://control.example.com",
    dataWssUrl: "wss://ws.example.com",
    fetchImpl: fetchMock as typeof fetch,
    webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    disableBrowserLifecycleHooks: true,
  });
  return { client, fetchMock };
}

function wrapper(client: DooverClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <DooverProvider client={client}>{children}</DooverProvider>
      </QueryClientProvider>
    );
  };
}

describe("react bindings", () => {
  beforeEach(() => {
    installSessionStorageMock();
    MockWebSocket.reset();
    Object.defineProperty(globalThis, "WebSocket", {
      value: MockWebSocket,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it("useDooverClient returns the injected client", () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useDooverClient(), {
      wrapper: wrapper(client),
    });
    expect(result.current).to.equal(client);
  });

  it("useDooverClient throws outside of a provider", () => {
    // Suppress React's expected error-boundary log for the unmounted throw.
    sinon.stub(console, "error");
    expect(() => renderHook(() => useDooverClient())).to.throw(
      /DooverProvider/,
    );
  });

  it("useConnectionState reports connecting initially and flips to open on Ready", async () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useConnectionState(), {
      wrapper: wrapper(client),
    });

    expect(result.current.status).to.equal("connecting");
    expect(result.current.lastOpenedAt).to.equal(null);

    // Drive the gateway through a real connect.
    await act(async () => {
      await client.gateway.connect();
    });
    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.open();
      ws.receive({ op: 0, t: "Hello", d: {} });
      ws.receive({
        op: 0,
        t: "Ready",
        d: { session_id: "s1", session_token: "t1", subscriptions: [] },
      });
    });

    await waitFor(() => {
      expect(result.current.status).to.equal("open");
      expect(result.current.lastOpenedAt).to.be.a("number");
    });
  });

  it("useAgentConnections fetches via ConnectionsApi", async () => {
    const { client, fetchMock } = makeClient();
    const { result } = renderHook(() => useAgentConnections("a1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => {
      expect(result.current.isSuccess).to.equal(true);
    });
    expect(result.current.data).to.deep.equal([{ address: "x", agent_id: "a1" }]);
    expect(fetchMock.getCall(0).args[0]).to.equal(
      "https://api.example.com/agents/a1/wss_connections",
    );
  });

  it("useAgentConnections stays disabled when agentId is undefined", () => {
    const { client, fetchMock } = makeClient();
    const { result } = renderHook(() => useAgentConnections(undefined), {
      wrapper: wrapper(client),
    });
    expect(result.current.fetchStatus).to.equal("idle");
    expect(fetchMock.callCount).to.equal(0);
  });

  it("useAgentChannel fetches the aggregate and patches cache on gateway events", async () => {
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith("/channels/ui_state")) {
        return createJsonResponse({
          name: "ui_state",
          owner_id: "a1",
          is_private: false,
          aggregate: { data: { x: 1 }, attachments: [] },
        });
      }
      return createJsonResponse({});
    });
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
    });

    const Wrapper = wrapper(client);
    const { result } = renderHook(() => useAgentChannel("a1", "ui_state"), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).to.equal(true));
    expect(result.current.data).to.deep.equal({ x: 1 });
    expect(result.current.attachments).to.deep.equal([]);

    // Drive a live aggregate update.
    await act(async () => {
      const ws = MockWebSocket.instances[0];
      ws.open();
      ws.receive({ op: 0, t: "Hello", d: {} });
      ws.receive({
        op: 0,
        t: "Ready",
        d: { session_id: "s1", session_token: "t1", subscriptions: [] },
      });
      ws.receive({
        op: 0,
        t: "AggregateUpdate",
        d: {
          author_id: "u1",
          channel: { agent_id: "a1", name: "ui_state" },
          aggregate: { data: { x: 2 }, attachments: [] },
          request_data: {},
          organisation_id: "org-1",
        },
      });
    });

    await waitFor(() =>
      expect(result.current.data).to.deep.equal({ x: 2 }),
    );
  });

  it("useSendMessage posts via MessagesApi", async () => {
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith("/messages")) {
        return createJsonResponse({
          id: generateSnowflakeIdAtTime(new Date("2026-01-01T00:00:00.000Z")),
          author_id: "u1",
          channel: { agent_id: "a1", name: "notes" },
          data: { text: "hi" },
          attachments: [],
        });
      }
      return createJsonResponse({});
    });
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
    });

    const { result } = renderHook(
      () => useSendMessage({ agentId: "a1", channelName: "notes" }),
      { wrapper: wrapper(client) },
    );

    let mutationResult: { data: unknown } | undefined;
    await act(async () => {
      mutationResult = await result.current.mutateAsync({ text: "hi" });
    });

    expect(mutationResult?.data).to.deep.equal({ text: "hi" });
  });

  it("useUpdateAggregate patches and writes back to the channel aggregate cache", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({ data: { y: 2 }, attachments: [] }),
    );
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <DooverProvider client={client}>{children}</DooverProvider>
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(
      () => useUpdateAggregate({ agentId: "a1", channelName: "ui_cmds" }),
      { wrapper: Wrapper },
    );

    await act(async () => {
      await result.current.mutateAsync({ y: 2 });
    });

    const cached = queryClient.getQueryData(
      channelAggregateQueryKey("a1", "ui_cmds"),
    );
    expect(cached).to.deep.equal({ data: { y: 2 }, attachments: [] });
  });

  it("useChannelMessages paginates and prepends on live messageCreate", async () => {
    const oldId = generateSnowflakeIdAtTime(new Date("2025-12-31T23:59:00.000Z"));
    const newId = generateSnowflakeIdAtTime(new Date("2026-01-01T00:00:01.000Z"));
    const liveId = generateSnowflakeIdAtTime(new Date("2026-01-01T00:00:02.000Z"));

    const fetchMock = createFetchMock(() =>
      createJsonResponse([
        {
          id: newId,
          author_id: "u1",
          channel: { agent_id: "a1", name: "notes" },
          data: { v: 2 },
          attachments: [],
        },
        {
          id: oldId,
          author_id: "u1",
          channel: { agent_id: "a1", name: "notes" },
          data: { v: 1 },
          attachments: [],
        },
      ]),
    );
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
    });

    const { result } = renderHook(
      () =>
        useChannelMessages({ agentId: "a1", channelName: "notes" }, { limit: 10 }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).to.equal(true));
    expect(result.current.messages.map((m) => m.id)).to.deep.equal([
      oldId,
      newId,
    ]);

    // Gateway MessageCreate — should append to the first (newest) page.
    await act(async () => {
      const ws = MockWebSocket.instances[0];
      ws.open();
      ws.receive({ op: 0, t: "Hello", d: {} });
      ws.receive({
        op: 0,
        t: "Ready",
        d: { session_id: "s1", session_token: "t1", subscriptions: [] },
      });
      ws.receive({
        op: 0,
        t: "MessageCreate",
        d: {
          id: liveId,
          author_id: "u1",
          channel: { agent_id: "a1", name: "notes" },
          data: { v: 3 },
          attachments: [],
        },
      });
    });

    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).to.deep.equal([
        oldId,
        newId,
        liveId,
      ]),
    );
  });

  it("getSharedQueryClient returns the same QueryClient across callers", () => {
    resetSharedQueryClient();
    const a = getSharedQueryClient();
    const b = getSharedQueryClient();
    expect(a).to.equal(b);
    resetSharedQueryClient();
    const c = getSharedQueryClient();
    expect(c).to.not.equal(a);
    resetSharedQueryClient();
  });

  it("useSendRpc tracks status history and resolves via sendRPC", async () => {
    const rpcId = generateSnowflakeIdAtTime(new Date("2026-01-01T00:00:00.000Z"));
    const fetchMock = createFetchMock((url) => {
      if (url.endsWith("/messages")) {
        return createJsonResponse({
          id: rpcId,
          author_id: "u1",
          channel: { agent_id: "a1", name: "ui_cmds" },
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
    const client = new DooverClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      fetchImpl: fetchMock as typeof fetch,
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
      disableBrowserLifecycleHooks: true,
    });

    const { result } = renderHook(
      () =>
        useSendRpc<object, { pong: true }>(
          { agentId: "a1", channelName: "ui_cmds" },
          { method: "ping" },
        ),
      { wrapper: wrapper(client) },
    );

    // Kick off the mutation.
    const pending = act(async () => {
      const promise = result.current.mutateAsync({ commandId: "c1", request: {} });
      // Give the mutation a tick to register the command in state before we
      // drive the gateway, so onStatus updates land against a known command.
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
          channel: { agent_id: "a1", name: "ui_cmds" },
          author_id: "u1",
          message: {
            id: rpcId,
            author_id: "u1",
            channel: { agent_id: "a1", name: "ui_cmds" },
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
      return promise;
    });

    const response = await pending;
    expect(response).to.deep.equal({ pong: true });
    expect(result.current.getStatus("c1")?.code).to.equal("success");
    expect(result.current.isPending("c1")).to.equal(false);
  });
});

// Keep `render` imported so tsc doesn't drop it; we use renderHook everywhere.
void render;
