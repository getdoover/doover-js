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

  createProcessorSchedule(
    agentId: string,
    scheduleId: string,
    body: PutScheduleRequest,
  ): Promise<unknown>;
  createProcessorSchedule(
    identifier: { agentId: string },
    scheduleId: string,
    body: PutScheduleRequest,
  ): Promise<unknown>;
  createProcessorSchedule(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._createProcessorSchedule(
        args[0],
        args[1] as string,
        args[2] as PutScheduleRequest,
      );
    }
    const id = args[0] as { agentId: string };
    return this._createProcessorSchedule(
      id.agentId,
      args[1] as string,
      args[2] as PutScheduleRequest,
    );
  }
  private _createProcessorSchedule(
    agentId: string,
    scheduleId: string,
    body: PutScheduleRequest,
  ) {
    return this.rest.put<unknown>(
      `/agents/${agentId}/processors/schedules/${scheduleId}`,
      body,
    );
  }

  deleteProcessorSchedule(agentId: string, scheduleId: string): Promise<unknown>;
  deleteProcessorSchedule(
    identifier: { agentId: string },
    scheduleId: string,
  ): Promise<unknown>;
  deleteProcessorSchedule(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._deleteProcessorSchedule(args[0], args[1] as string);
    }
    const id = args[0] as { agentId: string };
    return this._deleteProcessorSchedule(id.agentId, args[1] as string);
  }
  private _deleteProcessorSchedule(agentId: string, scheduleId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/processors/schedules/${scheduleId}`,
    );
  }

  regenerateScheduleToken(agentId: string, scheduleId: string): Promise<unknown>;
  regenerateScheduleToken(
    identifier: { agentId: string },
    scheduleId: string,
  ): Promise<unknown>;
  regenerateScheduleToken(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._regenerateScheduleToken(args[0], args[1] as string);
    }
    const id = args[0] as { agentId: string };
    return this._regenerateScheduleToken(id.agentId, args[1] as string);
  }
  private _regenerateScheduleToken(agentId: string, scheduleId: string) {
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
  ): Promise<unknown>;
  createProcessorSubscription(
    identifier: { agentId: string },
    subscriptionId: string,
    body: PutSubscriptionRequest,
  ): Promise<unknown>;
  createProcessorSubscription(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._createProcessorSubscription(
        args[0],
        args[1] as string,
        args[2] as PutSubscriptionRequest,
      );
    }
    const id = args[0] as { agentId: string };
    return this._createProcessorSubscription(
      id.agentId,
      args[1] as string,
      args[2] as PutSubscriptionRequest,
    );
  }
  private _createProcessorSubscription(
    agentId: string,
    subscriptionId: string,
    body: PutSubscriptionRequest,
  ) {
    return this.rest.put<unknown>(
      `/agents/${agentId}/processors/subscriptions/${subscriptionId}`,
      body,
    );
  }

  deleteProcessorSubscription(agentId: string, subscriptionId: string): Promise<unknown>;
  deleteProcessorSubscription(
    identifier: { agentId: string },
    subscriptionId: string,
  ): Promise<unknown>;
  deleteProcessorSubscription(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._deleteProcessorSubscription(args[0], args[1] as string);
    }
    const id = args[0] as { agentId: string };
    return this._deleteProcessorSubscription(id.agentId, args[1] as string);
  }
  private _deleteProcessorSubscription(agentId: string, subscriptionId: string) {
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

  createIngestionEndpoint(
    agentId: string,
    ingestionId: string,
    body: CreateIngestionRequest,
  ): Promise<unknown>;
  createIngestionEndpoint(
    identifier: { agentId: string },
    ingestionId: string,
    body: CreateIngestionRequest,
  ): Promise<unknown>;
  createIngestionEndpoint(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._createIngestionEndpoint(
        args[0],
        args[1] as string,
        args[2] as CreateIngestionRequest,
      );
    }
    const id = args[0] as { agentId: string };
    return this._createIngestionEndpoint(
      id.agentId,
      args[1] as string,
      args[2] as CreateIngestionRequest,
    );
  }
  private _createIngestionEndpoint(
    agentId: string,
    ingestionId: string,
    body: CreateIngestionRequest,
  ) {
    return this.rest.put<unknown>(
      `/agents/${agentId}/processors/ingestions/${ingestionId}`,
      body,
    );
  }

  deleteIngestionEndpoint(agentId: string, ingestionId: string): Promise<unknown>;
  deleteIngestionEndpoint(
    identifier: { agentId: string },
    ingestionId: string,
  ): Promise<unknown>;
  deleteIngestionEndpoint(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._deleteIngestionEndpoint(args[0], args[1] as string);
    }
    const id = args[0] as { agentId: string };
    return this._deleteIngestionEndpoint(id.agentId, args[1] as string);
  }
  private _deleteIngestionEndpoint(agentId: string, ingestionId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/processors/ingestions/${ingestionId}`,
    );
  }

  invokeIngestionEndpoint(
    agentId: string,
    ingestionId: string,
    body: unknown,
    params?: { wait?: boolean; json_response?: boolean },
  ): Promise<unknown>;
  invokeIngestionEndpoint(
    identifier: { agentId: string },
    ingestionId: string,
    body: unknown,
    params?: { wait?: boolean; json_response?: boolean },
  ): Promise<unknown>;
  invokeIngestionEndpoint(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._invokeIngestionEndpoint(
        args[0],
        args[1] as string,
        args[2],
        args[3] as { wait?: boolean; json_response?: boolean } | undefined,
      );
    }
    const id = args[0] as { agentId: string };
    return this._invokeIngestionEndpoint(
      id.agentId,
      args[1] as string,
      args[2],
      args[3] as { wait?: boolean; json_response?: boolean } | undefined,
    );
  }
  private _invokeIngestionEndpoint(
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
