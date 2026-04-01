import type { RestClient } from "../http/rest-client";
import type { Alarm, CreateAlarmRequest, PatchAlarmRequest } from "../types/openapi";

export class AlarmsApi {
  constructor(private readonly rest: RestClient) {}

  listAlarms(agentId: string, channelName: string) {
    return this.rest.get<Alarm[]>(`/agents/${agentId}/channels/${channelName}/alarms`);
  }

  createAlarm(agentId: string, channelName: string, body: CreateAlarmRequest) {
    return this.rest.post<Alarm>(`/agents/${agentId}/channels/${channelName}/alarms`, body);
  }

  getAlarm(agentId: string, channelName: string, alarmId: string) {
    return this.rest.get<Alarm>(
      `/agents/${agentId}/channels/${channelName}/alarms/${alarmId}`,
    );
  }

  putAlarm(
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
  ) {
    return this.rest.patch<Alarm>(
      `/agents/${agentId}/channels/${channelName}/alarms/${alarmId}`,
      body,
    );
  }

  deleteAlarm(agentId: string, channelName: string, alarmId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/channels/${channelName}/alarms/${alarmId}`,
    );
  }
}
