import { expect } from "chai";
import { afterEach, beforeEach, describe, it } from "mocha";
import sinon from "sinon";

import { GatewayClient } from "../gateway/gateway-client";
import { generateSnowflakeIdAtTime } from "../utils/snowflake";
import { MockWebSocket } from "./helpers";

describe("GatewayClient", () => {
  beforeEach(() => {
    MockWebSocket.reset();
    sinon.useFakeTimers(new Date("2026-01-01T00:00:00.000Z"));
    Object.defineProperty(globalThis, "WebSocket", {
      value: MockWebSocket,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  it("identifies on hello and resumes after a stored session", () => {
    const client = new GatewayClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    client.connect();
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.receive({ op: 0, t: "Hello", d: {} });
    expect(JSON.parse(ws.sent[0])).to.deep.include({ op: 10 });

    ws.receive({
      op: 0,
      t: "Ready",
      d: { session_id: "s1", session_token: "token", subscriptions: [] },
    });
    client.disconnect();

    client.connect();
    const ws2 = MockWebSocket.instances[1];
    ws2.open();
    ws2.receive({ op: 0, t: "Hello", d: {} });
    const resumePayload = JSON.parse(ws2.sent[0]);
    expect(resumePayload.op).to.equal(11);
    expect(resumePayload.d).to.deep.include({
      session_id: "s1",
      session_token: "token",
    });
  });

  it("dispatches websocket events and supports channel operations", () => {
    const client = new GatewayClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      organisationId: "org-1",
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const channelSync = sinon.spy();
    const messageCreate = sinon.spy();
    const messageUpdate = sinon.spy();
    const aggregateUpdate = sinon.spy();
    const alarmTrigger = sinon.spy();
    const oneShot = sinon.spy();
    const subscribed = sinon.spy();
    const unsubscribed = sinon.spy();
    const wssError = sinon.spy();

    client.on("channelSync", channelSync);
    client.on("messageCreate", messageCreate);
    client.on("messageUpdate", messageUpdate);
    client.on("aggregateUpdate", aggregateUpdate);
    client.on("alarmTrigger", alarmTrigger);
    client.on("oneShotMessage", oneShot);
    client.on("channelSubscription", subscribed);
    client.on("channelUnsubscription", unsubscribed);
    client.on("wssError", wssError);

    client.connect();
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.receive({ op: 0, t: "Hello", d: {} });
    ws.receive({
      op: 0,
      t: "Ready",
      d: { session_id: "s1", session_token: "token", subscriptions: [] },
    });

    client.subscribe({ agent_id: "a1", name: "c1" });
    client.syncChannel({ agent_id: "a1", name: "c1" });
    client.sendOneShotMessage({ agent_id: "a1", name: "c1" }, { hello: "world" });
    client.unsubscribe({ agent_id: "a1", name: "c1" });

    expect(ws.sent.map((message) => JSON.parse(message).op)).to.deep.equal([10, 12, 14, 15, 13]);

    const id = generateSnowflakeIdAtTime(new Date("2026-01-01T00:00:00.000Z"));
    ws.receive({
      op: 0,
      t: "ChannelSync",
      d: {
        channel: { agent_id: "a1", name: "c1" },
        aggregate: { data: {}, attachments: [] },
      },
    });
    ws.receive({
      op: 0,
      t: "MessageCreate",
      d: {
        id,
        author_id: "u1",
        channel: { agent_id: "a1", name: "c1" },
        data: {},
        attachments: [],
      },
    });
    ws.receive({
      op: 0,
      t: "MessageUpdate",
      d: {
        id,
        author_id: "u1",
        channel: { agent_id: "a1", name: "c1" },
        data: {},
        attachments: [],
        request_data: {},
      },
    });
    ws.receive({
      op: 0,
      t: "AggregateUpdate",
      d: {
        author_id: "u1",
        channel: { agent_id: "a1", name: "c1" },
        aggregate: { data: {}, attachments: [] },
        request_data: { data: {}, attachments: [] },
        organisation_id: "org-1",
      },
    });
    ws.receive({
      op: 0,
      t: "AlarmTrigger",
      d: {
        channel: { agent_id: "a1", name: "c1" },
        alarm: {
          id: "al1",
          name: "alarm",
          description: "",
          enabled: true,
          key: "temp",
          operator: "gt",
          value: 1,
          state: "Alarm",
          expiry_mins: null,
          entered_state_ts: 1,
        },
        old_state: "OK",
        new_state: "Alarm",
        aggregate: { data: {}, attachments: [] },
        request_data: { data: {}, attachments: [] },
        organisation_id: "org-1",
      },
    });
    ws.receive({
      op: 0,
      t: "OneShotMessage",
      d: {
        id: null,
        author_id: "u1",
        channel: { agent_id: "a1", name: "c1" },
        data: { hello: "world" },
      },
    });
    ws.receive({
      op: 0,
      t: "ChannelSubscription",
      d: {
        agent_id: "u1",
        channel: { agent_id: "a1", name: "c1" },
        session_id: "s2",
        default_session: true,
      },
    });
    ws.receive({
      op: 0,
      t: "ChannelUnsubscription",
      d: {
        agent_id: "u1",
        channel: { agent_id: "a1", name: "c1" },
        session_id: "s2",
        default_session: true,
      },
    });
    ws.receive({
      op: 0,
      t: "WSSErrorEvent",
      d: { message: "boom" },
    });

    expect(channelSync.calledOnce).to.equal(true);
    expect(messageCreate.calledWithMatch(sinon.match({ id, timestamp: sinon.match.number }))).to.equal(true);
    expect(messageUpdate.calledWithMatch(sinon.match({ id, timestamp: sinon.match.number }))).to.equal(true);
    expect(aggregateUpdate.calledOnce).to.equal(true);
    expect(alarmTrigger.calledOnce).to.equal(true);
    expect(oneShot.calledOnce).to.equal(true);
    expect(subscribed.calledOnce).to.equal(true);
    expect(unsubscribed.calledOnce).to.equal(true);
    expect(wssError.calledWith({ message: "boom" })).to.equal(true);
  });

  it("sends heartbeats, measures latency, and handles session cancellation", () => {
    const client = new GatewayClient({
      dataRestUrl: "https://api.example.com",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://ws.example.com",
      webSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    const ack = sinon.spy();
    const cancelled = sinon.spy();
    client.on("heartbeatAck", ack);
    client.on("sessionCancelled", cancelled);

    client.connect();
    const ws = MockWebSocket.instances[0];
    ws.open();
    ws.receive({ op: 0, t: "Hello", d: {} });
    ws.receive({
      op: 0,
      t: "Ready",
      d: { session_id: "s1", session_token: "token", subscriptions: [] },
    });

    sinon.clock.tick(20000);
    expect(JSON.parse(ws.sent[ws.sent.length - 1] as string)).to.deep.equal({ op: 1, d: {} });

    sinon.clock.tick(10);
    ws.receive({ op: 2, d: {} });
    expect(ack.calledWith(10)).to.equal(true);

    ws.receive({ op: 3, d: {} });
    expect(cancelled.calledOnce).to.equal(true);
    expect(client.getSession()).to.equal(null);
  });
});
