import type { Aggregate, Alarm, ChannelRef, JSONValue, MessageStructure } from "../types/common";

export interface WebSocketSubscription {
  channel: ChannelRef;
  organisation_id?: string | null;
  diff_only: boolean;
}

export interface WebSocketSession {
  session_id: string;
  session_token: string;
  subscriptions: WebSocketSubscription[];
}

export interface GatewayMessageBase {
  op: number;
  d: unknown;
  s?: number | null;
  t?: string;
}

export interface GatewayHello extends GatewayMessageBase {
  op: 0;
  t: "Hello";
  d: Record<string, never>;
}

export interface GatewayReady extends GatewayMessageBase {
  op: 0;
  t: "Ready";
  d: WebSocketSession;
}

export interface GatewayChannelSync extends GatewayMessageBase {
  op: 0;
  t: "ChannelSync";
  d: {
    channel: ChannelRef;
    aggregate: Aggregate;
  };
}

export interface GatewayMessageCreate extends GatewayMessageBase {
  op: 0;
  t: "MessageCreate";
  d: Omit<MessageStructure, "timestamp">;
}

export interface GatewayMessageUpdate extends GatewayMessageBase {
  op: 0;
  t: "MessageUpdate";
  d: Omit<MessageStructure, "timestamp"> & {
    request_data: JSONValue;
  };
}

export interface GatewayAggregateUpdate extends GatewayMessageBase {
  op: 0;
  t: "AggregateUpdate";
  d: {
    author_id: string;
    channel: ChannelRef;
    aggregate: Aggregate;
    request_data: Aggregate;
    organisation_id: string;
  };
}

export interface GatewayAlarmTrigger extends GatewayMessageBase {
  op: 0;
  t: "AlarmTrigger";
  d: {
    channel: ChannelRef;
    alarm: Alarm;
    old_state: Alarm["state"];
    new_state: Alarm["state"];
    aggregate: Aggregate;
    request_data: Aggregate;
    organisation_id: string;
  };
}

export interface GatewayOneShotMessage extends GatewayMessageBase {
  op: 0;
  t: "OneShotMessage";
  d: {
    id: string | null;
    author_id: string;
    channel: ChannelRef;
    data: JSONValue;
  };
}

export interface GatewayChannelSubscription extends GatewayMessageBase {
  op: 0;
  t: "ChannelSubscription";
  d: {
    agent_id: string;
    channel: ChannelRef;
    session_id: string;
    default_session: boolean;
  };
}

export interface GatewayChannelUnsubscription extends GatewayMessageBase {
  op: 0;
  t: "ChannelUnsubscription";
  d: {
    agent_id: string;
    channel: ChannelRef;
    session_id: string;
    default_session: boolean;
  };
}

export interface GatewayWSSErrorEvent extends GatewayMessageBase {
  op: 0;
  t: "WSSErrorEvent";
  d: {
    message: string;
  };
}

export interface GatewayHeartbeatAck extends GatewayMessageBase {
  op: 2;
  d: Record<string, never>;
}

export interface GatewaySessionCancelled extends GatewayMessageBase {
  op: 3;
  d: Record<string, never>;
}

export type GatewayInboundMessage =
  | GatewayHello
  | GatewayReady
  | GatewayChannelSync
  | GatewayMessageCreate
  | GatewayMessageUpdate
  | GatewayAggregateUpdate
  | GatewayAlarmTrigger
  | GatewayOneShotMessage
  | GatewayChannelSubscription
  | GatewayChannelUnsubscription
  | GatewayWSSErrorEvent
  | GatewayHeartbeatAck
  | GatewaySessionCancelled;

export interface GatewayListenerMap {
  ready: (event: GatewayReady["d"]) => void;
  channelSync: (event: GatewayChannelSync["d"]) => void;
  messageCreate: (event: MessageStructure) => void;
  messageUpdate: (event: GatewayMessageUpdate["d"] & { timestamp: number }) => void;
  aggregateUpdate: (event: GatewayAggregateUpdate["d"]) => void;
  alarmTrigger: (event: GatewayAlarmTrigger["d"]) => void;
  oneShotMessage: (event: GatewayOneShotMessage["d"]) => void;
  channelSubscription: (event: GatewayChannelSubscription["d"]) => void;
  channelUnsubscription: (event: GatewayChannelUnsubscription["d"]) => void;
  wssError: (event: GatewayWSSErrorEvent["d"]) => void;
  sessionCancelled: () => void;
  open: () => void;
  close: (event: CloseEvent) => void;
  heartbeatAck: (latencyMs: number | null) => void;
}
