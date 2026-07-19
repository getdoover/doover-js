import { expect } from "chai";
import { afterEach, beforeEach, describe, it } from "mocha";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import sinon from "sinon";

import { DooverClient } from "../client/doover-client";
import { DooverProvider, useChannelMessages } from "../react";
import { resetChannelRangeStores } from "../react/messageRangeStore";
import { generateSnowflakeIdAtTime } from "../utils/snowflake";
import { createJsonResponse, installSessionStorageMock, MockWebSocket } from "./helpers";

const AGENT = "agent-1";
const CHANNEL = "camera_1";
const NOW = Date.now();

/** `COUNT` messages, one per minute, ascending by id (index 0 = oldest). */
const COUNT = 60;
const ALL = Array.from({ length: COUNT }, (_, i) => {
  const at = new Date(NOW - (COUNT - 1 - i) * 60_000);
  return {
    id: generateSnowflakeIdAtTime(at),
    data: { i },
    attachments: [],
    author_id: "author",
    channel: { agent_id: AGENT, name: CHANNEL },
  };
}).sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));

/**
 * Emulates the REST route's *native* ordering, which the SDK client then
 * reverses per `order`: `before` returns the newest N below the cursor,
 * newest-first; a bare `after` returns the oldest N above it, oldest-first.
 */
function serveNative(query: URLSearchParams) {
  const before = query.get("before");
  const after = query.get("after");
  const limit = Number(query.get("limit") ?? "10");

  if (before && !after) {
    const below = ALL.filter((m) => BigInt(m.id) < BigInt(before));
    return below.slice(Math.max(0, below.length - limit)).reverse(); // newest-first
  }
  if (after && !before) {
    const above = ALL.filter((m) => BigInt(m.id) > BigInt(after));
    return above.slice(0, limit); // oldest-first
  }
  // both bounds: newest-first within (after, before]
  const within = ALL.filter(
    (m) => BigInt(m.id) < BigInt(before!) && BigInt(m.id) > BigInt(after!),
  );
  return within.slice(Math.max(0, within.length - limit)).reverse();
}

function makeClient() {
  const calls: URLSearchParams[] = [];
  const fetchMock = sinon.stub().callsFake(async (input: string | URL | Request) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/messages")) {
      const q = new URL(url).searchParams;
      calls.push(q);
      return createJsonResponse(serveNative(q));
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

function wrapper(client: DooverClient, queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <DooverProvider client={client}>{children}</DooverProvider>
      </QueryClientProvider>
    );
  };
}

const newQueryClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

const idAtIndex = (i: number) => ALL[i].id;
const timeOfIndex = (i: number) => NOW - (COUNT - 1 - i) * 60_000;
/** A snowflake landing strictly between messages i and i+1 (30s after i). */
const anchorAfter = (i: number) =>
  generateSnowflakeIdAtTime(new Date(timeOfIndex(i) + 30_000));

describe("useChannelMessages forward pagination", () => {
  beforeEach(() => {
    installSessionStorageMock();
    resetChannelRangeStores();
  });

  afterEach(() => {
    sinon.restore();
  });

  it("pages forward from an anchor into newer messages", async () => {
    const { client } = makeClient();
    const qc = newQueryClient();
    // Anchor between index 29 and 30 — half the history is newer than it.
    const anchor = anchorAfter(29);

    const { result } = renderHook(
      () =>
        useChannelMessages({ agentId: AGENT, channelName: CHANNEL }, { limit: 10, anchor }),
      { wrapper: wrapper(client, qc) },
    );

    await waitFor(() => expect(result.current.messages).to.have.length(10));
    // The anchored page is the 10 newest *below* the anchor: indices 20..29.
    expect(result.current.messages.every((m) => BigInt(m.id) < BigInt(anchor))).to.equal(true);
    expect(result.current.hasPreviousPage).to.equal(true);

    await act(async () => {
      await result.current.fetchPreviousPage();
    });

    await waitFor(() =>
      expect(result.current.messages.some((m) => BigInt(m.id) > BigInt(anchor))).to.equal(true),
    );
    // Forward page brought in the messages immediately above the anchor (index 30+).
    expect(result.current.messages.map((m) => m.data as { i: number }).some((d) => d.i >= 30)).to.equal(true);
  });

  it("exposes no previous page for an unanchored (live) window", async () => {
    const { client } = makeClient();
    const qc = newQueryClient();

    const { result } = renderHook(
      () => useChannelMessages({ agentId: AGENT, channelName: CHANNEL }, { limit: 10 }),
      { wrapper: wrapper(client, qc) },
    );

    await waitFor(() => expect(result.current.messages).to.have.length(10));
    expect(result.current.hasPreviousPage).to.equal(false);
  });

  it("recovers messages above an anchor that has nothing below it, and terminates", async () => {
    const { client } = makeClient();
    const qc = newQueryClient();
    // Anchor older than every message: the initial before=anchor page is empty.
    const anchor = generateSnowflakeIdAtTime(new Date(NOW - COUNT * 10 * 60_000));

    const { result } = renderHook(
      () =>
        useChannelMessages({ agentId: AGENT, channelName: CHANNEL }, { limit: 10, anchor }),
      { wrapper: wrapper(client, qc) },
    );

    await waitFor(() => expect(result.current.isLoading).to.equal(false));
    expect(result.current.messages).to.have.length(0);
    // Empty below, but the walk still seeds from the anchor itself.
    expect(result.current.hasPreviousPage).to.equal(true);

    // Drain forward until exhausted — must terminate, never loop.
    for (let guard = 0; guard < 20 && result.current.hasPreviousPage; guard++) {
      await act(async () => {
        await result.current.fetchPreviousPage();
      });
    }

    expect(result.current.hasPreviousPage).to.equal(false);
    // Every message above the anchor is recovered (order is the consumer's job).
    const ids = result.current.messages.map((m) => m.id);
    expect(ids).to.have.length(COUNT);
    expect(ids).to.include(idAtIndex(0));
    expect(ids).to.include(idAtIndex(COUNT - 1));
  });
});
