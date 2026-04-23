import { expect } from "chai";
import { describe, it } from "mocha";

import { AgentsApi } from "../apis/agents-api";
import { AggregatesApi } from "../apis/aggregates-api";
import { AlarmsApi } from "../apis/alarms-api";
import { ChannelsApi } from "../apis/channels-api";
import { ConnectionsApi } from "../apis/connections-api";
import { MessagesApi } from "../apis/messages-api";
import { NotificationsApi } from "../apis/notifications-api";
import { PermissionsApi } from "../apis/permissions-api";
import { ProcessorsApi } from "../apis/processors-api";
import { TurnApi } from "../apis/turn-api";
import { RestClient } from "../http/rest-client";
import { generateSnowflakeIdAtTime } from "../utils/snowflake";
import { createBlobResponse, createFetchMock, createJsonResponse } from "./helpers";

function setupRest(responseFactory?: Parameters<typeof createFetchMock>[0]) {
  const fetchMock = createFetchMock(responseFactory);
  const rest = new RestClient({
    dataRestUrl: "https://api.example.com",
    controlApiUrl: "https://control.example.com",
    dataWssUrl: "wss://ws.example.com",
    fetchImpl: fetchMock as typeof fetch,
  });
  return { rest, fetchMock };
}

describe("API clients", () => {
  it("covers agents batch methods", async () => {
    const id = generateSnowflakeIdAtTime(new Date("2026-01-01T00:00:00Z"));
    const { rest, fetchMock } = setupRest((url) => {
      if (url.includes("/messages")) {
        return createJsonResponse({
          results: [
            {
              id,
              author_id: "u",
              channel: { agent_id: "a1", name: "c1" },
              data: {},
              attachments: [],
            },
          ],
          count: 1,
        });
      }
      return createJsonResponse({
        results: [{ agent_id: "a1", data: {}, attachments: [] }],
        count: 1,
      });
    });
    const api = new AgentsApi(rest);

    const messages = await api.getMultiAgentMessages("c1", {
      agent_id: ["a1", "a2"],
      limit: 5,
    });
    const aggregates = await api.getMultiAgentAggregates("c1", {
      agent_id: ["a1"],
    });

    expect(messages.results[0].timestamp).to.be.greaterThan(0);
    expect(aggregates.results).to.have.length(1);
    expect(fetchMock.getCall(0).args[0]).to.equal(
      "https://api.example.com/agents/channels/c1/messages?agent_id=a1&agent_id=a2&limit=5",
    );
    expect(fetchMock.getCall(1).args[0]).to.equal(
      "https://api.example.com/agents/channels/c1/aggregates?agent_id=a1",
    );
  });

  it("covers channels methods", async () => {
    const { rest, fetchMock } = setupRest(() => createJsonResponse([]));
    const api = new ChannelsApi(rest);

    await api.listChannels("a1", { include_archived: true });
    await api.getChannel("a1", "c1", { include_aggregate: true });
    await api.createChannel("a1", "c1", { is_private: true });
    await api.putChannel("a1", "c1", { is_private: false });
    await api.listDataSeries("a1", { field_name: ["temp"] });

    expect(fetchMock.getCalls().map((call) => [call.args[0], (call.args[1] as RequestInit | undefined)?.method ?? "GET"])).to.deep.equal([
      ["https://api.example.com/agents/a1/channels?include_archived=true", "GET"],
      ["https://api.example.com/agents/a1/channels/c1?include_aggregate=true", "GET"],
      ["https://api.example.com/agents/a1/channels/c1", "POST"],
      ["https://api.example.com/agents/a1/channels/c1", "PUT"],
      ["https://api.example.com/agents/a1/data_series?field_name=temp", "GET"],
    ]);
  });

  it("covers messages methods and multipart helper", async () => {
    const id = generateSnowflakeIdAtTime(new Date("2026-01-01T00:00:00Z"));
    const { rest, fetchMock } = setupRest((url) => {
      if (url.includes("/attachments/")) {
        return createBlobResponse("data");
      }
      if (url.includes("/timeseries")) {
        return createJsonResponse({ count: 1, results: [{ value: 1, message_id: id }] });
      }
      if (url.endsWith(`/messages/${id}`)) {
        return createJsonResponse({
          id,
          author_id: "u",
          channel: { agent_id: "a1", name: "c1" },
          data: {},
          attachments: [],
        });
      }
      if (url.endsWith("/messages")) {
        return createJsonResponse({
          id,
          author_id: "u",
          channel: { agent_id: "a1", name: "c1" },
          data: {},
          attachments: [],
        });
      }
      return createJsonResponse([
        {
          id,
          author_id: "u",
          channel: { agent_id: "a1", name: "c1" },
          data: {},
          attachments: [],
        },
      ]);
    });
    const api = new MessagesApi(rest);

    const list = await api.listMessages("a1", "c1", { limit: 2 });
    const posted = await api.postMessage("a1", "c1", { data: { x: 1 } });
    const series = await api.getTimeseries("a1", "c1", { field_name: ["x"] });
    const message = await api.getMessage("a1", "c1", id);
    await api.putMessage("a1", "c1", id, { data: { x: 2 } }, { suppress_response: true });
    await api.patchMessage("a1", "c1", id, { data: { x: 3 } }, { clear_attachments: true });
    await api.deleteMessage("a1", "c1", id);
    const blob = await api.getMessageAttachment("a1", "c1", id, "att-1");
    const formData = api.createMultipartPayload({ data: { x: 1 } }, [new Blob(["a"])]);

    expect(list[0].timestamp).to.be.greaterThan(0);
    expect(posted.timestamp).to.be.greaterThan(0);
    expect(series.count).to.equal(1);
    expect(message.id).to.equal(id);
    expect(await blob.text()).to.equal("data");
    expect(formData.get("json_payload")).to.equal(JSON.stringify({ data: { x: 1 } }));
    expect(formData.get("attachment-0")).to.be.instanceOf(Blob);
  });

  it("covers aggregates and alarms methods", async () => {
    const { rest, fetchMock } = setupRest((url) => {
      if (url.includes("/attachments/")) {
        return createBlobResponse("agg");
      }
      if (url.includes("/alarms")) {
        return createJsonResponse({
          id: "alarm",
          name: "a",
          description: "",
          enabled: true,
          key: "x",
          operator: "gt",
          value: 1,
          state: "OK",
          expiry_mins: null,
          entered_state_ts: 1,
        });
      }
      return createJsonResponse({ data: {}, attachments: [] });
    });

    const aggregates = new AggregatesApi(rest);
    const alarms = new AlarmsApi(rest);

    await aggregates.getAggregate("a1", "c1");
    await aggregates.putAggregate("a1", "c1", { data: 1 }, { log_update: true });
    await aggregates.patchAggregate("a1", "c1", { data: 2 }, { clear_attachments: true });
    const aggregateBlob = await aggregates.getAggregateAttachment("a1", "c1", "att-1");

    await alarms.listAlarms("a1", "c1");
    await alarms.createAlarm("a1", "c1", { name: "a", key: "x", operator: "gt", value: 1 });
    await alarms.getAlarm("a1", "c1", "alarm");
    await alarms.putAlarm("a1", "c1", "alarm", { name: "a", key: "x", operator: "gt", value: 1 });
    await alarms.patchAlarm("a1", "c1", "alarm", { enabled: false });
    await alarms.deleteAlarm("a1", "c1", "alarm");

    expect(await aggregateBlob.text()).to.equal("agg");
    expect(fetchMock.callCount).to.equal(10);
  });

  it("covers connections and notifications methods", async () => {
    const { rest, fetchMock } = setupRest(() => createJsonResponse({ subscriptions: [], endpoints: [], subscribers: [] }));
    const connections = new ConnectionsApi(rest);
    const notifications = new NotificationsApi(rest);

    await connections.getAgentConnections("a1");
    await connections.getAgentConnectionHistory("a1", { default_connection: true });
    await connections.getAgentSubscriptionHistory("a1", { channel: "{\"agent_id\":\"a1\",\"name\":\"c1\"}" });
    await connections.getConnection("conn");
    await connections.getChannelSubscriptions("a1", "c1");
    await connections.syncConnection("a1");

    const syncCall = fetchMock
      .getCalls()
      .find((call) => (call.args[0] as string).endsWith("/agents/a1/connection_sync"));
    expect(syncCall).to.not.equal(undefined);
    expect((syncCall!.args[1] as RequestInit).method).to.equal("POST");

    await notifications.getAgentNotifications("a1");
    await notifications.getAgentNotificationEndpoints("a1", "browser");
    await notifications.createNotificationEndpoint("a1", {
      name: "browser",
      type: 3,
      extra_data: {},
      default: true,
    });
    await notifications.updateNotificationEndpoint("a1", "e1", { name: "browser-2" });
    await notifications.deleteNotificationEndpoint("a1", "e1");
    await notifications.testNotificationEndpoint("a1", "e1");
    await notifications.getAgentNotificationSubscriptions("a1", "a2");
    await notifications.createNotificationSubscription("a1", {
      subscribe_to: "a2",
      severity: 3,
      topic_filter: ["*"],
    });
    await notifications.getAgentDefaultNotificationSubscriptions("a1", "a2");
    await notifications.deleteDefaultNotificationSubscription("a1", "a2");
    await notifications.updateNotificationSubscription("a1", "s1", { severity: 4 });
    await notifications.deleteNotificationSubscription("a1", "s1");
    await notifications.getAgentNotificationSubscribers("a1");
    await notifications.updateMeWebPushEndpoint({
      old_endpoint: "old",
      endpoint: "new",
      key_p256dh: "p",
      key_auth: "a",
      expires_at: 1,
    });
    await notifications.getWebPushPublicKey();

    expect(fetchMock.callCount).to.equal(21);
  });

  it("covers permissions, processors, and turn methods", async () => {
    const { rest, fetchMock } = setupRest(() =>
      createJsonResponse({ db: { agent_id: "a1", is_superuser: false, resources: [] } }),
    );
    const permissions = new PermissionsApi(rest);
    const processors = new ProcessorsApi(rest);
    const turn = new TurnApi(rest);

    await permissions.getAgentPermission("a1");
    await permissions.getAgentPermissionDebug("a1");
    await permissions.syncPermissions({ agent_permissions: [] });

    await processors.createProcessorSchedule("a1", "sched", {
      app_key: "app",
      permissions: [],
    });
    await processors.deleteProcessorSchedule("a1", "sched");
    await processors.regenerateScheduleToken("a1", "sched");
    await processors.getScheduleInfo("sched");
    await processors.getScheduleInfoAlias("sched");
    await processors.createProcessorSubscription("a1", "sub", {
      subscription_arn: "arn",
      app_key: "app",
      permissions: [],
    });
    await processors.deleteProcessorSubscription("a1", "sub");
    await processors.getProcessorSubscriptionInfo("arn");
    await processors.getProcessorSubscriptionInfoAlias("arn");
    await processors.createIngestionEndpoint("a1", "ing", {
      lambda_arn: "arn",
      cidr_ranges: [],
      throttle_limit: 1,
      app_key: "app",
      permissions: [],
    });
    await processors.deleteIngestionEndpoint("a1", "ing");
    await processors.invokeIngestionEndpoint("a1", "ing", { hello: "world" }, { wait: true });

    await turn.createTurnToken({ role: "client", camera_name: "cam", device_id: "a1" });

    expect(fetchMock.callCount).to.equal(16);
  });
});
