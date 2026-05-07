import { expect } from "chai";
import { ChannelsApi } from "../apis/channels-api";
import type { RestClient } from "../http/rest-client";

interface RecordedCall {
  method: "get" | "post" | "put" | "patch" | "delete" | "request";
  args: unknown[];
}

export function makeRestStub(): RestClient & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const stub = {
    calls,
    get: (...args: unknown[]) => {
      calls.push({ method: "get", args });
      return Promise.resolve(undefined as unknown);
    },
    post: (...args: unknown[]) => {
      calls.push({ method: "post", args });
      return Promise.resolve(undefined as unknown);
    },
    put: (...args: unknown[]) => {
      calls.push({ method: "put", args });
      return Promise.resolve(undefined as unknown);
    },
    patch: (...args: unknown[]) => {
      calls.push({ method: "patch", args });
      return Promise.resolve(undefined as unknown);
    },
    delete: (...args: unknown[]) => {
      calls.push({ method: "delete", args });
      return Promise.resolve(undefined as unknown);
    },
    request: (...args: unknown[]) => {
      calls.push({ method: "request", args });
      return Promise.resolve(undefined as unknown);
    },
  };
  return stub as unknown as RestClient & { calls: RecordedCall[] };
}

describe("ChannelsApi overloads", () => {
  it("getChannel positional and identifier-object produce identical requests", async () => {
    const restA = makeRestStub();
    const restB = makeRestStub();
    const apiA = new ChannelsApi(restA);
    const apiB = new ChannelsApi(restB);
    await apiA.getChannel("a1", "c1", { include_aggregate: true });
    await apiB.getChannel({ agentId: "a1", channelName: "c1" }, { include_aggregate: true });
    expect(restA.calls).to.deep.equal(restB.calls);
  });

  it("listChannels positional and identifier-object produce identical requests", async () => {
    const restA = makeRestStub();
    const restB = makeRestStub();
    const apiA = new ChannelsApi(restA);
    const apiB = new ChannelsApi(restB);
    await apiA.listChannels("a1", { include_archived: true });
    await apiB.listChannels({ agentId: "a1" }, { include_archived: true });
    expect(restA.calls).to.deep.equal(restB.calls);
  });

  it("archiveChannel posts to /archive", async () => {
    const rest = makeRestStub();
    const api = new ChannelsApi(rest);
    await api.archiveChannel("a1", "c1");
    expect(rest.calls).to.deep.equal([
      { method: "post", args: ["/agents/a1/channels/c1/archive", {}] },
    ]);
  });

  it("unarchiveChannel posts to /unarchive", async () => {
    const rest = makeRestStub();
    const api = new ChannelsApi(rest);
    await api.unarchiveChannel({ agentId: "a1", channelName: "c1" });
    expect(rest.calls).to.deep.equal([
      { method: "post", args: ["/agents/a1/channels/c1/unarchive", {}] },
    ]);
  });
});
