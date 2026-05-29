import { expect } from "chai";
import { ChannelsApi } from "../apis/channels-api";
import { MessagesApi } from "../apis/messages-api";
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
      return Promise.resolve([] as unknown);
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

describe("MessagesApi overloads + defaults", () => {
  it("listMessages positional and identifier-object produce identical requests", async () => {
    const restA = makeRestStub();
    const restB = makeRestStub();
    const apiA = new MessagesApi(restA);
    const apiB = new MessagesApi(restB);
    const before = "185536526405337088";
    await apiA.listMessages("a1", "c1", { limit: 5, order: "desc", before });
    await apiB.listMessages(
      { agentId: "a1", channelName: "c1" },
      { limit: 5, order: "desc", before },
    );
    expect(restA.calls).to.deep.equal(restB.calls);
  });

  it("listMessages defaults limit to 10 when omitted", async () => {
    const rest = makeRestStub();
    const api = new MessagesApi(rest);
    await api.listMessages("a1", "c1");
    expect(rest.calls).to.have.lengthOf(1);
    const params = rest.calls[0]!.args[1] as { limit?: number; before?: string };
    expect(params.limit).to.equal(10);
    expect(params.before, "before should be set to a snowflake id").to.be.a("string");
  });

  it("listMessages with order='asc' reverses the response array", async () => {
    const rest = makeRestStub();
    rest.get = ((..._args: unknown[]) =>
      Promise.resolve([
        { id: "3", data: {}, attachments: [], author_id: "a", channel: { agent_id: "a1", name: "c1" } },
        { id: "2", data: {}, attachments: [], author_id: "a", channel: { agent_id: "a1", name: "c1" } },
        { id: "1", data: {}, attachments: [], author_id: "a", channel: { agent_id: "a1", name: "c1" } },
      ])) as unknown as RestClient["get"];
    const api = new MessagesApi(rest);
    const result = await api.listMessages("a1", "c1", { order: "asc", limit: 3 });
    expect(result.map((m) => m.id)).to.deep.equal(["1", "2", "3"]);
  });

  it("listMessages with order='desc' (default) preserves server order", async () => {
    const rest = makeRestStub();
    rest.get = ((..._args: unknown[]) =>
      Promise.resolve([
        { id: "3", data: {}, attachments: [], author_id: "a", channel: { agent_id: "a1", name: "c1" } },
        { id: "2", data: {}, attachments: [], author_id: "a", channel: { agent_id: "a1", name: "c1" } },
      ])) as unknown as RestClient["get"];
    const api = new MessagesApi(rest);
    const result = await api.listMessages("a1", "c1", { limit: 2 });
    expect(result.map((m) => m.id)).to.deep.equal(["3", "2"]);
  });

  it("getTimeseries strips order before sending to server", async () => {
    const rest = makeRestStub();
    const api = new MessagesApi(rest);
    await api.getTimeseries("a1", "c1", { limit: 5, order: "asc" } as never);
    expect(rest.calls).to.have.lengthOf(1);
    const wireParams = rest.calls[0]!.args[1] as Record<string, unknown>;
    expect(wireParams.order).to.equal(undefined);
    expect(wireParams.limit).to.equal(5);
  });

  it("getTimeseries forwards paginate to the server", async () => {
    const rest = makeRestStub();
    const api = new MessagesApi(rest);
    await api.getTimeseries("a1", "c1", { limit: 1500, paginate: true });
    const wireParams = rest.calls[0]!.args[1] as Record<string, unknown>;
    expect(wireParams.paginate).to.equal(true);
    expect(wireParams.limit).to.equal(1500);
  });
});

import { AggregatesApi } from "../apis/aggregates-api";

describe("AggregatesApi overloads", () => {
  it("getAggregate positional and identifier-object produce identical requests", async () => {
    const restA = makeRestStub();
    const restB = makeRestStub();
    const apiA = new AggregatesApi(restA);
    const apiB = new AggregatesApi(restB);
    await apiA.getAggregate("a1", "c1");
    await apiB.getAggregate({ agentId: "a1", channelName: "c1" });
    expect(restA.calls).to.deep.equal(restB.calls);
  });

  it("patchAggregate identifier form passes through body and params", async () => {
    const rest = makeRestStub();
    const api = new AggregatesApi(rest);
    await api.patchAggregate(
      { agentId: "a1", channelName: "c1" },
      { x: 1 },
      { suppress_response: true },
    );
    expect(rest.calls).to.deep.equal([
      {
        method: "patch",
        args: ["/agents/a1/channels/c1/aggregate", { x: 1 }, { suppress_response: true }],
      },
    ]);
  });
});

import { AlarmsApi } from "../apis/alarms-api";

describe("AlarmsApi overloads", () => {
  it("listAlarms positional and identifier-object produce identical requests", async () => {
    const restA = makeRestStub();
    const restB = makeRestStub();
    const apiA = new AlarmsApi(restA);
    const apiB = new AlarmsApi(restB);
    await apiA.listAlarms("a1", "c1");
    await apiB.listAlarms({ agentId: "a1", channelName: "c1" });
    expect(restA.calls).to.deep.equal(restB.calls);
  });

  it("getAlarm via identifier hits expected path", async () => {
    const rest = makeRestStub();
    const api = new AlarmsApi(rest);
    await api.getAlarm({ agentId: "a1", channelName: "c1" }, "alm1");
    expect(rest.calls).to.deep.equal([
      { method: "get", args: ["/agents/a1/channels/c1/alarms/alm1"] },
    ]);
  });
});

import { ConnectionsApi } from "../apis/connections-api";

describe("ConnectionsApi overloads", () => {
  it("getAgentConnections positional and identifier-object produce identical requests", async () => {
    const restA = makeRestStub();
    const restB = makeRestStub();
    const apiA = new ConnectionsApi(restA);
    const apiB = new ConnectionsApi(restB);
    await apiA.getAgentConnections("a1");
    await apiB.getAgentConnections({ agentId: "a1" });
    expect(restA.calls).to.deep.equal(restB.calls);
  });

  it("getChannelSubscriptions identifier form hits expected path", async () => {
    const rest = makeRestStub();
    const api = new ConnectionsApi(rest);
    await api.getChannelSubscriptions({ agentId: "a1", channelName: "c1" });
    expect(rest.calls).to.deep.equal([
      { method: "get", args: ["/agents/a1/channels/c1/subscriptions"] },
    ]);
  });
});

import { NotificationsApi } from "../apis/notifications-api";

describe("NotificationsApi overloads", () => {
  it("getAgentNotifications positional and identifier-object produce identical requests", async () => {
    const restA = makeRestStub();
    const restB = makeRestStub();
    const apiA = new NotificationsApi(restA);
    const apiB = new NotificationsApi(restB);
    await apiA.getAgentNotifications("a1");
    await apiB.getAgentNotifications({ agentId: "a1" });
    expect(restA.calls).to.deep.equal(restB.calls);
  });

  it("updateNotificationEndpoint identifier form preserves endpointId and body", async () => {
    const rest = makeRestStub();
    const api = new NotificationsApi(rest);
    await api.updateNotificationEndpoint(
      { agentId: "a1" },
      "ep1",
      { name: "x" } as never,
    );
    expect(rest.calls).to.deep.equal([
      {
        method: "patch",
        args: ["/agents/a1/notifications/endpoints/ep1", { name: "x" }],
      },
    ]);
  });
});

import { PermissionsApi } from "../apis/permissions-api";

describe("PermissionsApi overloads", () => {
  it("getAgentPermission positional and identifier-object produce identical requests", async () => {
    const restA = makeRestStub();
    const restB = makeRestStub();
    const apiA = new PermissionsApi(restA);
    const apiB = new PermissionsApi(restB);
    await apiA.getAgentPermission("a1");
    await apiB.getAgentPermission({ agentId: "a1" });
    expect(restA.calls).to.deep.equal(restB.calls);
  });
});

import { ProcessorsApi } from "../apis/processors-api";

describe("ProcessorsApi overloads", () => {
  it("createProcessorSchedule identifier form hits expected path", async () => {
    const rest = makeRestStub();
    const api = new ProcessorsApi(rest);
    await api.createProcessorSchedule({ agentId: "a1" }, "sch1", { foo: "bar" } as never);
    expect(rest.calls).to.deep.equal([
      {
        method: "put",
        args: ["/agents/a1/processors/schedules/sch1", { foo: "bar" }],
      },
    ]);
  });
});

import { AgentsApi } from "../apis/agents-api";

describe("AgentsApi listAgents", () => {
  it("calls /agents/ on controlApiUrl with omitSharingHeader", async () => {
    const rest = makeRestStub();
    const api = new AgentsApi(rest, "https://control.example.com");
    rest.request = ((...args: unknown[]) => {
      rest.calls.push({ method: "request", args });
      return Promise.resolve({ agents: [] });
    }) as unknown as RestClient["request"];
    await api.listAgents({ includeArchived: true });
    expect(rest.calls).to.have.lengthOf(1);
    expect(rest.calls[0]!.method).to.equal("request");
    const req = rest.calls[0]!.args[0] as {
      path: string;
      baseUrl?: string;
      omitSharingHeader: boolean;
      query?: Record<string, boolean>;
    };
    expect(req.path).to.equal("/agents/");
    expect(req.baseUrl).to.equal("https://control.example.com");
    expect(req.omitSharingHeader).to.equal(true);
    expect(req.query).to.deep.equal({ "include-archived": true });
  });

  it("normalises agent entries and merges organisations/users when requested", async () => {
    const rest = makeRestStub();
    rest.request = ((..._args: unknown[]) =>
      Promise.resolve({
        agents: [
          { id: "a1", name: "Agent One", type: "device" },
        ],
        organisations: [{ id: "o1", name: "Org One" }],
        users: [{ id: "u1", name: "User One" }],
      })) as unknown as RestClient["request"];
    const api = new AgentsApi(rest);
    const result = await api.listAgents({
      includeOrganisations: true,
      includeUsers: true,
      mergeIncludedAsAgents: true,
    });
    expect(result.results).to.have.lengthOf(3);
    expect(result.count).to.equal(3);
    const ids = (result.results ?? []).map((a) => a.id).sort();
    expect(ids).to.deep.equal(["a1", "o1", "u1"]);
    const types = (result.results ?? []).map((a) => a.type).sort();
    expect(types).to.deep.equal(["device", "organisation", "user"]);
  });
});
