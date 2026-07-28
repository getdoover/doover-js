import { expect } from "chai";
import { describe, it } from "mocha";

import { AggregatesApi } from "../apis/aggregates-api";
import { MessagesApi } from "../apis/messages-api";
import { RestClient } from "../http/rest-client";
import {
  MAX_BATCH_ITEMS,
  chunkBatchItems,
  mergeBatchResponses,
  type BatchAggregateUpdateItem,
} from "../types/batch";
import { createFetchMock, createJsonResponse } from "./helpers";

interface CapturedRequest {
  url: string;
  method?: string;
  body: { items: Array<Record<string, unknown>> };
}

/**
 * Rest client whose fetch mock records every request and replies with a
 * well-formed batch response echoing the submitted items as successes.
 */
function setupBatchRest(
  overrides?: (captured: CapturedRequest) => unknown,
) {
  const requests: CapturedRequest[] = [];
  const fetchMock = createFetchMock((url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as CapturedRequest["body"];
    const captured = { url, method: init?.method, body };
    requests.push(captured);
    const override = overrides?.(captured);
    if (override) return createJsonResponse(override);
    const items = body.items.map((item) => ({
      agent_id: item.agent_id,
      channel_name: item.channel_name,
      success: true,
    }));
    return createJsonResponse({
      items,
      count: items.length,
      succeeded: items.length,
      failed: 0,
    });
  });
  const rest = new RestClient({
    dataRestUrl: "https://api.example.com",
    controlApiUrl: "https://control.example.com",
    dataWssUrl: "wss://ws.example.com",
    fetchImpl: fetchMock as typeof fetch,
  });
  return { rest, requests };
}

function aggregateItems(count: number): BatchAggregateUpdateItem[] {
  return Array.from({ length: count }, (_, i) => ({
    agent_id: `agent-${i}`,
    channel_name: "dv-ui-sub",
    data: { group_open: { "u1:s1": 1 } },
  }));
}

describe("batch helpers", () => {
  it("chunks to the server ceiling and preserves order", () => {
    const chunks = chunkBatchItems([1, 2, 3, 4, 5], 2);
    expect(chunks).to.deep.equal([[1, 2], [3, 4], [5]]);
  });

  it("returns no chunks for an empty list", () => {
    expect(chunkBatchItems([])).to.deep.equal([]);
  });

  it("rejects a nonsensical chunk size rather than looping forever", () => {
    expect(() => chunkBatchItems([1], 0)).to.throw(RangeError);
  });

  it("recomputes counts when merging responses", () => {
    const merged = mergeBatchResponses([
      {
        items: [{ agent_id: "a", channel_name: "c", success: true }],
        count: 1,
        succeeded: 1,
        failed: 0,
      },
      {
        items: [
          { agent_id: "b", channel_name: "c", success: false, error: "boom" },
        ],
        count: 1,
        succeeded: 1, // deliberately wrong: merge must not trust these
        failed: 0,
      },
    ]);
    expect(merged.count).to.equal(2);
    expect(merged.succeeded).to.equal(1);
    expect(merged.failed).to.equal(1);
    expect(merged.items.map((i) => i.agent_id)).to.deep.equal(["a", "b"]);
  });
});

describe("AggregatesApi.batchPatchAggregates", () => {
  it("PATCHes /agents/aggregates with an items envelope", async () => {
    const { rest, requests } = setupBatchRest();
    const api = new AggregatesApi(rest);

    const response = await api.batchPatchAggregates(aggregateItems(2));

    expect(requests).to.have.length(1);
    expect(requests[0].url).to.equal("https://api.example.com/agents/aggregates");
    expect(requests[0].method).to.equal("PATCH");
    expect(requests[0].body.items).to.have.length(2);
    expect(requests[0].body.items[0]).to.deep.equal({
      agent_id: "agent-0",
      channel_name: "dv-ui-sub",
      data: { group_open: { "u1:s1": 1 } },
    });
    expect(response.count).to.equal(2);
    expect(response.succeeded).to.equal(2);
  });

  it("issues no request at all for an empty batch", async () => {
    const { rest, requests } = setupBatchRest();
    const api = new AggregatesApi(rest);

    const response = await api.batchPatchAggregates([]);

    expect(requests).to.have.length(0);
    expect(response).to.deep.equal({ items: [], count: 0, succeeded: 0, failed: 0 });
  });

  it("splits oversized batches and merges the responses in order", async () => {
    const { rest, requests } = setupBatchRest();
    const api = new AggregatesApi(rest);
    const total = MAX_BATCH_ITEMS + 5;

    const response = await api.batchPatchAggregates(aggregateItems(total));

    expect(requests).to.have.length(2);
    expect(requests[0].body.items).to.have.length(MAX_BATCH_ITEMS);
    expect(requests[1].body.items).to.have.length(5);
    expect(response.count).to.equal(total);
    expect(response.items[0].agent_id).to.equal("agent-0");
    expect(response.items[total - 1].agent_id).to.equal(`agent-${total - 1}`);
  });

  it("surfaces partial failure without throwing", async () => {
    const { rest } = setupBatchRest(() => ({
      items: [
        { agent_id: "agent-0", channel_name: "dv-ui-sub", success: true },
        {
          agent_id: "agent-1",
          channel_name: "dv-ui-sub",
          success: false,
          error: "permission denied",
        },
      ],
      count: 2,
      succeeded: 1,
      failed: 1,
    }));
    const api = new AggregatesApi(rest);

    const response = await api.batchPatchAggregates(aggregateItems(2));

    expect(response.failed).to.equal(1);
    expect(response.items[1].error).to.equal("permission denied");
  });
});

describe("MessagesApi batch mutations", () => {
  it("POSTs creates to /agents/messages", async () => {
    const { rest, requests } = setupBatchRest();
    const api = new MessagesApi(rest);

    await api.batchPostMessages([
      { agent_id: "a1", channel_name: "activity", message_id: "m1", data: { event: "opened" } },
    ]);

    expect(requests[0].url).to.equal("https://api.example.com/agents/messages");
    expect(requests[0].method).to.equal("POST");
    expect(requests[0].body.items[0].message_id).to.equal("m1");
  });

  it("uses the matching verb for patch, put and delete", async () => {
    const { rest, requests } = setupBatchRest();
    const api = new MessagesApi(rest);
    const items = [{ agent_id: "a1", channel_name: "c1", message_id: "m1", data: {} }];

    await api.batchPatchMessages(items);
    await api.batchPutMessages(items);
    await api.batchDeleteMessages([{ agent_id: "a1", channel_name: "c1", message_id: "m1" }]);

    expect(requests.map((r) => r.method)).to.deep.equal(["PATCH", "PUT", "DELETE"]);
    // DELETE must carry a body — the reason these bypass `rest.delete`.
    expect(requests[2].body.items).to.have.length(1);
  });

  it("chunks message batches too", async () => {
    const { rest, requests } = setupBatchRest();
    const api = new MessagesApi(rest);
    const items = Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => ({
      agent_id: `a${i}`,
      channel_name: "c1",
      message_id: `m${i}`,
      data: {},
    }));

    const response = await api.batchPatchMessages(items);

    expect(requests).to.have.length(2);
    expect(response.count).to.equal(MAX_BATCH_ITEMS + 1);
  });

  it("issues no request for an empty message batch", async () => {
    const { rest, requests } = setupBatchRest();
    const api = new MessagesApi(rest);

    const response = await api.batchDeleteMessages([]);

    expect(requests).to.have.length(0);
    expect(response.count).to.equal(0);
  });
});
