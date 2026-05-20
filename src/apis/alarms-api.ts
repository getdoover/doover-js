import type { RestClient } from "../http/rest-client";
import type { Alarm, CreateAlarmRequest, PatchAlarmRequest } from "../types/openapi";
import { resolveChannelArgs } from "./_args";

export class AlarmsApi {
  constructor(private readonly rest: RestClient) {}

  listAlarms(agentId: string, channelName: string): Promise<Alarm[]>;
  listAlarms(identifier: { agentId: string; channelName: string }): Promise<Alarm[]>;
  listAlarms(...args: unknown[]): Promise<Alarm[]> {
    const { agentId, channelName } = resolveChannelArgs<undefined>(args);
    return this._listAlarms(agentId, channelName);
  }
  private _listAlarms(agentId: string, channelName: string) {
    return this.rest.get<Alarm[]>(`/agents/${agentId}/channels/${channelName}/alarms`);
  }

  createAlarm(
    agentId: string,
    channelName: string,
    body: CreateAlarmRequest,
  ): Promise<Alarm>;
  createAlarm(
    identifier: { agentId: string; channelName: string },
    body: CreateAlarmRequest,
  ): Promise<Alarm>;
  createAlarm(...args: unknown[]): Promise<Alarm> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, body] = args as [string, string, CreateAlarmRequest];
      return this._createAlarm(agentId, channelName, body);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._createAlarm(id.agentId, id.channelName, args[1] as CreateAlarmRequest);
  }
  private _createAlarm(agentId: string, channelName: string, body: CreateAlarmRequest) {
    return this.rest.post<Alarm>(`/agents/${agentId}/channels/${channelName}/alarms`, body);
  }

  getAlarm(agentId: string, channelName: string, alarmId: string): Promise<Alarm>;
  getAlarm(
    identifier: { agentId: string; channelName: string },
    alarmId: string,
  ): Promise<Alarm>;
  getAlarm(...args: unknown[]): Promise<Alarm> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, alarmId] = args as [string, string, string];
      return this._getAlarm(agentId, channelName, alarmId);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._getAlarm(id.agentId, id.channelName, args[1] as string);
  }
  private _getAlarm(agentId: string, channelName: string, alarmId: string) {
    return this.rest.get<Alarm>(
      `/agents/${agentId}/channels/${channelName}/alarms/${alarmId}`,
    );
  }

  putAlarm(
    agentId: string,
    channelName: string,
    alarmId: string,
    body: CreateAlarmRequest,
  ): Promise<Alarm>;
  putAlarm(
    identifier: { agentId: string; channelName: string },
    alarmId: string,
    body: CreateAlarmRequest,
  ): Promise<Alarm>;
  putAlarm(...args: unknown[]): Promise<Alarm> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, alarmId, body] = args as [
        string, string, string, CreateAlarmRequest,
      ];
      return this._putAlarm(agentId, channelName, alarmId, body);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._putAlarm(
      id.agentId,
      id.channelName,
      args[1] as string,
      args[2] as CreateAlarmRequest,
    );
  }
  private _putAlarm(
    agentId: string,
    channelName: string,
    alarmId: string,
    body: CreateAlarmRequest,
  ) {
    return this.rest.put<Alarm>(
      `/agents/${agentId}/channels/${channelName}/alarms/${alarmId}`,
      body,
    );
  }

  patchAlarm(
    agentId: string,
    channelName: string,
    alarmId: string,
    body: PatchAlarmRequest,
  ): Promise<Alarm>;
  patchAlarm(
    identifier: { agentId: string; channelName: string },
    alarmId: string,
    body: PatchAlarmRequest,
  ): Promise<Alarm>;
  patchAlarm(...args: unknown[]): Promise<Alarm> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, alarmId, body] = args as [
        string, string, string, PatchAlarmRequest,
      ];
      return this._patchAlarm(agentId, channelName, alarmId, body);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._patchAlarm(
      id.agentId,
      id.channelName,
      args[1] as string,
      args[2] as PatchAlarmRequest,
    );
  }
  private _patchAlarm(
    agentId: string,
    channelName: string,
    alarmId: string,
    body: PatchAlarmRequest,
  ) {
    return this.rest.patch<Alarm>(
      `/agents/${agentId}/channels/${channelName}/alarms/${alarmId}`,
      body,
    );
  }

  deleteAlarm(
    agentId: string,
    channelName: string,
    alarmId: string,
  ): Promise<unknown>;
  deleteAlarm(
    identifier: { agentId: string; channelName: string },
    alarmId: string,
  ): Promise<unknown>;
  deleteAlarm(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, alarmId] = args as [string, string, string];
      return this._deleteAlarm(agentId, channelName, alarmId);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._deleteAlarm(id.agentId, id.channelName, args[1] as string);
  }
  private _deleteAlarm(agentId: string, channelName: string, alarmId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/channels/${channelName}/alarms/${alarmId}`,
    );
  }
}
