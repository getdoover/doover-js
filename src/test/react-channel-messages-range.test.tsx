import { expect } from "chai";
import { afterEach, beforeEach, describe, it } from "mocha";
import { renderHook, waitFor } from "@testing-library/react";
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

/** Newest-first, as the bare REST route returns it. */
function messagesDesc(count: number, startMinutesAgo: number) {
  return Array.from({ length: count }, (_, i) => {
    const at = new Date(NOW - (startMinutesAgo + i) * 60_000);
    return {
      id: generateSnowflakeIdAtTime(at),
      data: { i },
      attachments: [],
      author_id: "author",
      channel: { agent_id: AGENT, name: CHANNEL },
    };
  });
}

function makeClient(page: unknown[]) {
  const calls: Array<{ before: string | null; limit: string | null }> = [];
  const fetchMock = sinon.stub().callsFake(async (input: string | URL | Request) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes("/messages")) {
      const parsed = new URL(url);
      calls.push({
        before: parsed.searchParams.get("before"),
        limit: parsed.searchParams.get("limit"),
      });
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

/** One QueryClient per test, shared by both hooks, as a real app would have. */
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

describe("useChannelMessages range cache", () => {
  beforeEach(() => {
    installSessionStorageMock();
    resetChannelRangeStores();
  });

  afterEach(() => {
    sinon.restore();
  });

  it("serves an anchored window from history already fetched, without refetching", async () => {
    const page = messagesDesc(30, 1); // 1..30 minutes ago
    const { client, calls } = makeClient(page);
    const qc = newQueryClient();

    const live = renderHook(
      () => useChannelMessages({ agentId: AGENT, channelName: CHANNEL }, { limit: 30 }),
      { wrapper: wrapper(client, qc) },
    );
    await waitFor(() => expect(live.result.current.messages).to.have.length(30));
    expect(calls).to.have.length(1);

    // Anchor inside the range just proven — a different chain, same store
    const anchor = generateSnowflakeIdAtTime(new Date(NOW - 10 * 60_000));
    const anchored = renderHook(
      () =>
        useChannelMessages({ agentId: AGENT, channelName: CHANNEL }, { limit: 5, anchor }),
      { wrapper: wrapper(client, qc) },
    );

    await waitFor(() => expect(anchored.result.current.messages).to.have.length(5));
    expect(calls, "anchoring over covered history should not hit the network").to.have.length(1);
    expect(
      anchored.result.current.messages.every((m) => BigInt(m.id) < BigInt(anchor)),
    ).to.equal(true);
  });

  it("fetches when the anchor lands outside anything proven", async () => {
    const page = messagesDesc(30, 1);
    const { client, calls } = makeClient(page);
    const qc = newQueryClient();

    const live = renderHook(
      () => useChannelMessages({ agentId: AGENT, channelName: CHANNEL }, { limit: 30 }),
      { wrapper: wrapper(client, qc) },
    );
    await waitFor(() => expect(live.result.current.messages).to.have.length(30));

    // A year back is nowhere near the covered range
    const anchor = generateSnowflakeIdAtTime(new Date(NOW - 365 * 24 * 60 * 60_000));
    renderHook(
      () =>
        useChannelMessages({ agentId: AGENT, channelName: CHANNEL }, { limit: 5, anchor }),
      { wrapper: wrapper(client, qc) },
    );

    await waitFor(() => expect(calls).to.have.length(2));
    expect(calls[1].before).to.equal(anchor);
  });

  it("keeps the unanchored key untouched, so existing consumers are unaffected", async () => {
    const page = messagesDesc(10, 1);
    const { client, calls } = makeClient(page);
    const qc = newQueryClient();

    const first = renderHook(
      () => useChannelMessages({ agentId: AGENT, channelName: CHANNEL }, { limit: 10 }),
      { wrapper: wrapper(client, qc) },
    );
    await waitFor(() => expect(first.result.current.messages).to.have.length(10));

    // Same options => same query key => React Query serves it, no second request
    const second = renderHook(
      () => useChannelMessages({ agentId: AGENT, channelName: CHANNEL }, { limit: 10 }),
      { wrapper: wrapper(client, qc) },
    );
    await waitFor(() => expect(second.result.current.messages).to.have.length(10));
    expect(calls).to.have.length(1);
  });
});
