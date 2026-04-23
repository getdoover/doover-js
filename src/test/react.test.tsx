import { expect } from "chai";
import { afterEach, beforeEach, describe, it } from "mocha";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import sinon from "sinon";
import React from "react";

import { DooverClient } from "../client/doover-client";
import {
  DooverProvider,
  useAgentConnections,
  useConnectionState,
  useDooverClient,
} from "../react";
import { createFetchMock, createJsonResponse, installSessionStorageMock, MockWebSocket } from "./helpers";

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
});

// Keep `render` imported so tsc doesn't drop it; we use renderHook everywhere.
void render;
