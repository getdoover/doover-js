import { expect } from "chai";
import { afterEach, beforeEach, describe, it } from "mocha";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

import { DooverClient } from "../client/doover-client";
import {
  DooverProvider,
  MULTI_AGENT_MAX_WINDOW_MS,
  useMultiAgentChannelMessages,
} from "../react";
import { createJsonResponse, installSessionStorageMock, MockWebSocket } from "./helpers";
import sinon from "sinon";

/**
 * Fetch mock for the multi-agent messages endpoint. `pagesByRound` supplies
 * one canned response per call, in order, so a test can hand back
 * `next_cursors` on early rounds and drain on the last one.
 */
function makeClient(pagesByRound: Array<{ results: unknown[]; next_cursors?: Record<string, string> }>) {
  let round = 0;
  const calls: Array<Record<string, string[]>> = [];
  const fetchMock = sinon.stub().callsFake(async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/messages")) {
      const parsed = new URL(url);
      calls.push({
        agent_id: parsed.searchParams.getAll("agent_id"),
        agent_before: parsed.searchParams.getAll("agent_before"),
        before: parsed.searchParams.getAll("before"),
        after: parsed.searchParams.getAll("after"),
      });
      const page = pagesByRound[Math.min(round, pagesByRound.length - 1)];
      round += 1;
      return createJsonResponse(page);
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
  return { client, calls };
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

function msg(id: string, agentId: string) {
  return { id, channel: { agent_id: agentId, name: "tag_values" }, data: {} };
}

describe("useMultiAgentChannelMessages autoPaginate", () => {
  beforeEach(() => {
    installSessionStorageMock();
    MockWebSocket.reset();
  });
  afterEach(() => {
    sinon.restore();
  });

  it("walks back per-agent via next_cursors until the window drains", async () => {
    const { client, calls } = makeClient([
      // round 1: a1 hit its limit (cursor returned), a2 drained already
      { results: [msg("100", "a1"), msg("99", "a2")], next_cursors: { a1: "90" } },
      // round 2: a1 drains
      { results: [msg("89", "a1")], next_cursors: {} },
    ]);
    const { result } = renderHook(
      () =>
        useMultiAgentChannelMessages("tag_values", ["a1", "a2"], {
          after: "1",
          agentMessageLimit: 2,
          autoPaginate: true,
          liveUpdates: false,
        }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.messages).to.have.length(3));
    expect(result.current.hasNextPage).to.equal(false);
    // Second request must resume ONLY a1, using its own cursor as agent_before.
    expect(calls).to.have.length(2);
    expect(calls[1].agent_id).to.deep.equal(["a1"]);
    expect(calls[1].agent_before).to.deep.equal(["90"]);
  });

  it("does not paginate when autoPaginate is off", async () => {
    const { client, calls } = makeClient([
      { results: [msg("100", "a1")], next_cursors: { a1: "90" } },
    ]);
    const { result } = renderHook(
      () =>
        useMultiAgentChannelMessages("tag_values", ["a1"], {
          agentMessageLimit: 1,
          liveUpdates: false,
        }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.messages).to.have.length(1));
    // hasNextPage is exposed, but nothing auto-fetches the second page.
    expect(result.current.hasNextPage).to.equal(true);
    expect(calls).to.have.length(1);
  });

  it("dedupes messages that repeat across pages", async () => {
    const { client } = makeClient([
      { results: [msg("100", "a1")], next_cursors: { a1: "100" } },
      // overlaps the previous page's id 100 (legacy-style re-return)
      { results: [msg("100", "a1"), msg("90", "a1")], next_cursors: {} },
    ]);
    const { result } = renderHook(
      () =>
        useMultiAgentChannelMessages("tag_values", ["a1"], {
          after: "1",
          agentMessageLimit: 1,
          autoPaginate: true,
          liveUpdates: false,
        }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.messages).to.have.length(2));
    expect(result.current.hasNextPage).to.equal(false);
    expect(result.current.messages.map((m) => m.id)).to.deep.equal(["100", "90"]);
  });
});

describe("useMultiAgentChannelMessages over ranges wider than one request", () => {
  beforeEach(() => {
    installSessionStorageMock();
    MockWebSocket.reset();
  });
  afterEach(() => {
    sinon.restore();
  });

  const DAY_MS = 24 * 60 * 60 * 1000;
  const span = (ms: number) => BigInt(ms) << 22n;
  const before = span(400 * DAY_MS);
  const window = span(MULTI_AGENT_MAX_WINDOW_MS);

  it("reads the range a window at a time, newest first, down to `after`", async () => {
    const after = before - span(20 * DAY_MS);
    const { client, calls } = makeClient([{ results: [], next_cursors: {} }]);
    const { result } = renderHook(
      () =>
        useMultiAgentChannelMessages("dv-audit", ["a1"], {
          after: after.toString(),
          initialBefore: before.toString(),
          autoPaginate: true,
          liveUpdates: false,
        }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).to.equal(true);
      expect(result.current.isFetching).to.equal(false);
      expect(result.current.hasNextPage).to.equal(false);
    });
    expect(calls.map(({ before: b, after: a }) => [b[0], a[0]])).to.deep.equal([
      [before.toString(), (before - window).toString()],
      [(before - window).toString(), (before - 2n * window).toString()],
      // The last window stops at the range's own bound.
      [(before - 2n * window).toString(), after.toString()],
    ]);
  });

  it("finishes a window's per-agent cursors before stepping back", async () => {
    const after = before - span(10 * DAY_MS);
    const { client, calls } = makeClient([
      { results: [msg("100", "a1")], next_cursors: { a1: "100" } },
      { results: [msg("90", "a1")], next_cursors: {} },
      { results: [], next_cursors: {} },
    ]);
    const { result } = renderHook(
      () =>
        useMultiAgentChannelMessages("dv-audit", ["a1", "a2"], {
          after: after.toString(),
          initialBefore: before.toString(),
          agentMessageLimit: 1,
          autoPaginate: true,
          liveUpdates: false,
        }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).to.equal(true);
      expect(result.current.isFetching).to.equal(false);
      expect(result.current.hasNextPage).to.equal(false);
    });
    expect(calls).to.have.length(3);
    // Resuming a1 inside the first window keeps that window's bounds.
    expect(calls[1].agent_id).to.deep.equal(["a1"]);
    expect(calls[1].agent_before).to.deep.equal(["100"]);
    expect(calls[1].after).to.deep.equal([(before - window).toString()]);
    // The next window asks every agent again.
    expect(calls[2].agent_id).to.deep.equal(["a1", "a2"]);
    expect(calls[2].agent_before).to.deep.equal([]);
    expect(calls[2].before).to.deep.equal([(before - window).toString()]);
    expect(calls[2].after).to.deep.equal([after.toString()]);
    expect(result.current.messages.map((m) => m.id)).to.deep.equal(["100", "90"]);
  });

  it("sends a range within one request as it always has", async () => {
    const after = before - span(DAY_MS);
    const { client, calls } = makeClient([{ results: [], next_cursors: {} }]);
    const { result } = renderHook(
      () =>
        useMultiAgentChannelMessages("dv-audit", ["a1"], {
          after: after.toString(),
          initialBefore: before.toString(),
          liveUpdates: false,
        }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(result.current.isSuccess).to.equal(true));
    expect(result.current.hasNextPage).to.equal(false);
    expect(calls).to.have.length(1);
    expect(calls[0].before).to.deep.equal([before.toString()]);
    expect(calls[0].after).to.deep.equal([after.toString()]);
  });
});
