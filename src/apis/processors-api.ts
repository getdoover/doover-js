import type { RestClient } from "../http/rest-client";
import type {
  CreateIngestionRequest,
  PutScheduleRequest,
  PutSubscriptionRequest,
  ScheduleInfo,
  SubscriptionInfo,
} from "../types/openapi";

export class ProcessorsApi {
  constructor(private readonly rest: RestClient) {}

  createProcessorSchedule(agentId: string, scheduleId: string, body: PutScheduleRequest) {
    return this.rest.put<unknown>(
      `/agents/${agentId}/processors/schedules/${scheduleId}`,
      body,
    );
  }

  deleteProcessorSchedule(agentId: string, scheduleId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/processors/schedules/${scheduleId}`,
    );
  }

  regenerateScheduleToken(agentId: string, scheduleId: string) {
    return this.rest.post<unknown>(
      `/agents/${agentId}/processors/schedules/${scheduleId}/token`,
      {},
    );
  }

  getScheduleInfo(scheduleId: string) {
    return this.rest.get<ScheduleInfo>(`/processors/schedules/${scheduleId}`);
  }

  getScheduleInfoAlias(scheduleId: string) {
    return this.rest.get<ScheduleInfo>(`/processors/schedules/${scheduleId}/info`);
  }

  createProcessorSubscription(
    agentId: string,
    subscriptionId: string,
    body: PutSubscriptionRequest,
  ) {
    return this.rest.put<unknown>(
      `/agents/${agentId}/processors/subscriptions/${subscriptionId}`,
      body,
    );
  }

  deleteProcessorSubscription(agentId: string, subscriptionId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/processors/subscriptions/${subscriptionId}`,
    );
  }

  getProcessorSubscriptionInfo(subscriptionName: string) {
    return this.rest.get<SubscriptionInfo>(
      `/processors/subscriptions/${subscriptionName}`,
    );
  }

  getProcessorSubscriptionInfoAlias(subscriptionArn: string) {
    return this.rest.get<SubscriptionInfo>(
      `/processors/subscriptions/${subscriptionArn}/info`,
    );
  }

  createIngestionEndpoint(agentId: string, ingestionId: string, body: CreateIngestionRequest) {
    return this.rest.put<unknown>(
      `/agents/${agentId}/processors/ingestions/${ingestionId}`,
      body,
    );
  }

  deleteIngestionEndpoint(agentId: string, ingestionId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/processors/ingestions/${ingestionId}`,
    );
  }

  invokeIngestionEndpoint(
    agentId: string,
    ingestionId: string,
    body: unknown,
    params?: { wait?: boolean; json_response?: boolean },
  ) {
    return this.rest.post<unknown>(
      `/agents/${agentId}/processors/ingestions/${ingestionId}/invoke`,
      body as Record<string, unknown>,
      params,
    );
  }
}
