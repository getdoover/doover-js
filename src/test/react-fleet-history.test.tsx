import { expect } from "chai";
import { afterEach, beforeEach, describe, it } from "mocha";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import sinon from "sinon";

import { DooverClient } from "../client/doover-client";
import {
  DooverProvider,
  useMultiAgentConnectionHistory,
  useMultiAgentMessageCounts,
} from "../react";
import { createJsonResponse, installSessionStorageMock, MockWebSocket } from "./helpers";

function makeClient() {
  const urls: string[] = [];
  const fetchMock = sinon.stub().callsFake(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(url);
    if (url.includes("/connection_history")) {
      return createJsonResponse({
        start: 0,
        end: 3_600_000,
        agents: [
          { id: "a1", state_at_start: "Sleeping", state_at_end: "Online", uptime: 1, truncated: false },
          { id: "a2", state_at_start: "Offline", state_at_end: "Offline", uptime: 0, truncated: false },
        ],
        events: [{ t: 1_800_000, agent_id: "a1", state: "Online" }],
        count: 1,
        next: null,
      });
    }
    if (url.includes("/messages/counts")) {
      return createJsonResponse({
        start: 0,
        end: 86_400_000,
        agents: [{ id: "a1", days: [{ start: 0, count: 4 }] }],
        totals: [{ start: 0, count: 4 }],
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
  return { client, urls };
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

describe("fleet history hooks", () => {
  beforeEach(() => {
    installSessionStorageMock();
    MockWebSocket.reset();
  });
  afterEach(() => {
    sinon.restore();
  });

  it("useMultiAgentConnectionHistory keys agents by id and forwards the window", async () => {
    const { client, urls } = makeClient();
    const { result } = renderHook(
      () => useMultiAgentConnectionHistory(["a2", "a1"], { after: "5", minGapMs: 0 }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.query.isSuccess).to.equal(true));
    expect(result.current.agentsById.a1.state_at_start).to.equal("Sleeping");
    const first = result.current.history?.events[0];
    expect([first?.t, first?.agent_id, first?.state]).to.deep.equal([1_800_000, "a1", "Online"]);
    expect(urls[0]).to.equal(
      "https://api.example.com/agents/connection_history?agent_id=a2&agent_id=a1&limit=5000&after=5&min_gap_ms=0",
    );
  });

  it("useMultiAgentConnectionHistory stays idle with no agents", () => {
    const { client, urls } = makeClient();
    const { result } = renderHook(() => useMultiAgentConnectionHistory([]), { wrapper: wrapper(client) });
    expect(result.current.query.fetchStatus).to.equal("idle");
    expect(urls).to.have.length(0);
  });

  it("useMultiAgentMessageCounts exposes totals and per-agent days", async () => {
    const { client, urls } = makeClient();
    const { result } = renderHook(
      () => useMultiAgentMessageCounts("tag_values", ["a1"], { before: "9" }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(result.current.query.isSuccess).to.equal(true));
    // Response objects carry `__source` provenance stamps, so compare fields.
    expect(result.current.counts?.totals.map((d) => [d.start, d.count])).to.deep.equal([[0, 4]]);
    expect(result.current.daysByAgent.a1.map((d) => d.count)).to.deep.equal([4]);
    expect(urls[0]).to.equal(
      "https://api.example.com/agents/channels/tag_values/messages/counts?agent_id=a1&before=9",
    );
  });

  it("keeps the last window on show while the next one loads, when asked to", async () => {
    const { client } = makeClient();
    const { result, rerender } = renderHook(
      ({ before }: { before: string }) =>
        useMultiAgentMessageCounts("tag_values", ["a1"], { before, keepPreviousData: true, gcTime: 60_000 }),
      { wrapper: wrapper(client), initialProps: { before: "9" } },
    );
    await waitFor(() => expect(result.current.query.isSuccess).to.equal(true));
    expect(result.current.query.isPlaceholderData).to.equal(false);
    rerender({ before: "10" });
    // The old window's counts, flagged as standing in for the new one's.
    expect(result.current.query.isPlaceholderData).to.equal(true);
    expect(result.current.daysByAgent.a1.map((d) => d.count)).to.deep.equal([4]);
    await waitFor(() => expect(result.current.query.isPlaceholderData).to.equal(false));
  });
});
