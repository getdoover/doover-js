import type { RestClient } from "../http/rest-client";
import type {
  CreateEndpointRequest,
  CreateNotificationSubscriptionRequest,
  NotificationDataResponse,
  NotificationEndpoint,
  NotificationEndpointSummariesResponse,
  NotificationEndpointsResponse,
  NotificationSubscribersResponse,
  NotificationSubscriptionCreateResponse,
  NotificationSubscriptionsResponse,
  UpdateEndpointRequest,
  UpdateMeWebPushEndpointRequest,
  UpdateNotificationSubscriptionRequest,
} from "../types/openapi";
import { resolveAgentArgs } from "./_args";

export class NotificationsApi {
  constructor(private readonly rest: RestClient) {}

  getAgentNotifications(agentId: string): Promise<NotificationDataResponse>;
  getAgentNotifications(identifier: { agentId: string }): Promise<NotificationDataResponse>;
  getAgentNotifications(...args: unknown[]): Promise<NotificationDataResponse> {
    const { agentId } = resolveAgentArgs<undefined>(args);
    return this._getAgentNotifications(agentId);
  }
  private _getAgentNotifications(agentId: string) {
    return this.rest.get<NotificationDataResponse>(`/agents/${agentId}/notifications`);
  }

  getAgentNotificationEndpoints(agentId: string, name?: string): Promise<NotificationEndpointsResponse>;
  getAgentNotificationEndpoints(identifier: { agentId: string }, name?: string): Promise<NotificationEndpointsResponse>;
  getAgentNotificationEndpoints(...args: unknown[]): Promise<NotificationEndpointsResponse> {
    if (typeof args[0] === "string") {
      return this._getAgentNotificationEndpoints(args[0], args[1] as string | undefined);
    }
    const id = args[0] as { agentId: string };
    return this._getAgentNotificationEndpoints(id.agentId, args[1] as string | undefined);
  }
  private _getAgentNotificationEndpoints(agentId: string, name?: string) {
    return this.rest.get<NotificationEndpointsResponse>(
      `/agents/${agentId}/notifications/endpoints`,
      { name },
    );
  }

  /**
   * Delivery readiness for each endpoint, without addresses or credentials.
   * Readable with either notification-read or manage-subscriptions rights, so
   * a delegated subscription manager can list endpoints it can't otherwise see.
   */
  getAgentNotificationEndpointSummaries(agentId: string): Promise<NotificationEndpointSummariesResponse>;
  getAgentNotificationEndpointSummaries(identifier: { agentId: string }): Promise<NotificationEndpointSummariesResponse>;
  getAgentNotificationEndpointSummaries(...args: unknown[]): Promise<NotificationEndpointSummariesResponse> {
    const { agentId } = resolveAgentArgs<undefined>(args);
    return this._getAgentNotificationEndpointSummaries(agentId);
  }
  private _getAgentNotificationEndpointSummaries(agentId: string) {
    return this.rest.get<NotificationEndpointSummariesResponse>(
      `/agents/${agentId}/notifications/endpoints/summary`,
    );
  }

  createNotificationEndpoint(agentId: string, body: CreateEndpointRequest): Promise<NotificationEndpoint>;
  createNotificationEndpoint(identifier: { agentId: string }, body: CreateEndpointRequest): Promise<NotificationEndpoint>;
  createNotificationEndpoint(...args: unknown[]): Promise<NotificationEndpoint> {
    if (typeof args[0] === "string") {
      return this._createNotificationEndpoint(args[0], args[1] as CreateEndpointRequest);
    }
    const id = args[0] as { agentId: string };
    return this._createNotificationEndpoint(id.agentId, args[1] as CreateEndpointRequest);
  }
  private _createNotificationEndpoint(agentId: string, body: CreateEndpointRequest) {
    return this.rest.post<NotificationEndpoint>(
      `/agents/${agentId}/notifications/endpoints`,
      body,
    );
  }

  updateNotificationEndpoint(agentId: string, endpointId: string, body: UpdateEndpointRequest): Promise<NotificationEndpoint>;
  updateNotificationEndpoint(identifier: { agentId: string }, endpointId: string, body: UpdateEndpointRequest): Promise<NotificationEndpoint>;
  updateNotificationEndpoint(...args: unknown[]): Promise<NotificationEndpoint> {
    if (typeof args[0] === "string") {
      return this._updateNotificationEndpoint(
        args[0],
        args[1] as string,
        args[2] as UpdateEndpointRequest,
      );
    }
    const id = args[0] as { agentId: string };
    return this._updateNotificationEndpoint(
      id.agentId,
      args[1] as string,
      args[2] as UpdateEndpointRequest,
    );
  }
  private _updateNotificationEndpoint(agentId: string, endpointId: string, body: UpdateEndpointRequest) {
    return this.rest.patch<NotificationEndpoint>(
      `/agents/${agentId}/notifications/endpoints/${endpointId}`,
      body,
    );
  }

  deleteNotificationEndpoint(agentId: string, endpointId: string): Promise<unknown>;
  deleteNotificationEndpoint(identifier: { agentId: string }, endpointId: string): Promise<unknown>;
  deleteNotificationEndpoint(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._deleteNotificationEndpoint(args[0], args[1] as string);
    }
    const id = args[0] as { agentId: string };
    return this._deleteNotificationEndpoint(id.agentId, args[1] as string);
  }
  private _deleteNotificationEndpoint(agentId: string, endpointId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/notifications/endpoints/${endpointId}`,
    );
  }

  testNotificationEndpoint(agentId: string, endpointId: string): Promise<unknown>;
  testNotificationEndpoint(identifier: { agentId: string }, endpointId: string): Promise<unknown>;
  testNotificationEndpoint(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._testNotificationEndpoint(args[0], args[1] as string);
    }
    const id = args[0] as { agentId: string };
    return this._testNotificationEndpoint(id.agentId, args[1] as string);
  }
  private _testNotificationEndpoint(agentId: string, endpointId: string) {
    return this.rest.post<unknown>(
      `/agents/${agentId}/notifications/endpoints/${endpointId}/test`,
      {},
    );
  }

  getAgentNotificationSubscriptions(agentId: string, subscribed_to?: string): Promise<NotificationSubscriptionsResponse>;
  getAgentNotificationSubscriptions(identifier: { agentId: string }, subscribed_to?: string): Promise<NotificationSubscriptionsResponse>;
  getAgentNotificationSubscriptions(...args: unknown[]): Promise<NotificationSubscriptionsResponse> {
    if (typeof args[0] === "string") {
      return this._getAgentNotificationSubscriptions(args[0], args[1] as string | undefined);
    }
    const id = args[0] as { agentId: string };
    return this._getAgentNotificationSubscriptions(id.agentId, args[1] as string | undefined);
  }
  private _getAgentNotificationSubscriptions(agentId: string, subscribed_to?: string) {
    return this.rest.get<NotificationSubscriptionsResponse>(
      `/agents/${agentId}/notifications/subscriptions`,
      { subscribed_to },
    );
  }

  createNotificationSubscription(agentId: string, body: CreateNotificationSubscriptionRequest): Promise<NotificationSubscriptionCreateResponse>;
  createNotificationSubscription(identifier: { agentId: string }, body: CreateNotificationSubscriptionRequest): Promise<NotificationSubscriptionCreateResponse>;
  createNotificationSubscription(...args: unknown[]): Promise<NotificationSubscriptionCreateResponse> {
    if (typeof args[0] === "string") {
      return this._createNotificationSubscription(args[0], args[1] as CreateNotificationSubscriptionRequest);
    }
    const id = args[0] as { agentId: string };
    return this._createNotificationSubscription(id.agentId, args[1] as CreateNotificationSubscriptionRequest);
  }
  private _createNotificationSubscription(agentId: string, body: CreateNotificationSubscriptionRequest) {
    return this.rest.post<NotificationSubscriptionCreateResponse>(
      `/agents/${agentId}/notifications/subscriptions`,
      body,
    );
  }

  getAgentDefaultNotificationSubscriptions(agentId: string, subscribed_to?: string): Promise<NotificationSubscriptionsResponse>;
  getAgentDefaultNotificationSubscriptions(identifier: { agentId: string }, subscribed_to?: string): Promise<NotificationSubscriptionsResponse>;
  getAgentDefaultNotificationSubscriptions(...args: unknown[]): Promise<NotificationSubscriptionsResponse> {
    if (typeof args[0] === "string") {
      return this._getAgentDefaultNotificationSubscriptions(args[0], args[1] as string | undefined);
    }
    const id = args[0] as { agentId: string };
    return this._getAgentDefaultNotificationSubscriptions(id.agentId, args[1] as string | undefined);
  }
  private _getAgentDefaultNotificationSubscriptions(agentId: string, subscribed_to?: string) {
    return this.rest.get<NotificationSubscriptionsResponse>(
      `/agents/${agentId}/notifications/subscriptions/default`,
      { subscribed_to },
    );
  }

  /**
   * Update every default subscription this subscriber holds on `subscribedTo`
   * at once. Omitted fields keep their current value.
   */
  updateDefaultNotificationSubscription(agentId: string, subscribedTo: string, body: UpdateNotificationSubscriptionRequest): Promise<unknown>;
  updateDefaultNotificationSubscription(identifier: { agentId: string }, subscribedTo: string, body: UpdateNotificationSubscriptionRequest): Promise<unknown>;
  updateDefaultNotificationSubscription(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._updateDefaultNotificationSubscription(
        args[0],
        args[1] as string,
        args[2] as UpdateNotificationSubscriptionRequest,
      );
    }
    const id = args[0] as { agentId: string };
    return this._updateDefaultNotificationSubscription(
      id.agentId,
      args[1] as string,
      args[2] as UpdateNotificationSubscriptionRequest,
    );
  }
  private _updateDefaultNotificationSubscription(agentId: string, subscribedTo: string, body: UpdateNotificationSubscriptionRequest) {
    return this.rest.patch<unknown>(
      `/agents/${agentId}/notifications/subscriptions/default/${subscribedTo}`,
      body,
    );
  }

  deleteDefaultNotificationSubscription(agentId: string, subscribedTo: string): Promise<unknown>;
  deleteDefaultNotificationSubscription(identifier: { agentId: string }, subscribedTo: string): Promise<unknown>;
  deleteDefaultNotificationSubscription(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._deleteDefaultNotificationSubscription(args[0], args[1] as string);
    }
    const id = args[0] as { agentId: string };
    return this._deleteDefaultNotificationSubscription(id.agentId, args[1] as string);
  }
  private _deleteDefaultNotificationSubscription(agentId: string, subscribedTo: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/notifications/subscriptions/default/${subscribedTo}`,
    );
  }

  updateNotificationSubscription(agentId: string, subscriptionId: string, body: UpdateNotificationSubscriptionRequest): Promise<unknown>;
  updateNotificationSubscription(identifier: { agentId: string }, subscriptionId: string, body: UpdateNotificationSubscriptionRequest): Promise<unknown>;
  updateNotificationSubscription(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._updateNotificationSubscription(
        args[0],
        args[1] as string,
        args[2] as UpdateNotificationSubscriptionRequest,
      );
    }
    const id = args[0] as { agentId: string };
    return this._updateNotificationSubscription(
      id.agentId,
      args[1] as string,
      args[2] as UpdateNotificationSubscriptionRequest,
    );
  }
  private _updateNotificationSubscription(agentId: string, subscriptionId: string, body: UpdateNotificationSubscriptionRequest) {
    return this.rest.patch<unknown>(
      `/agents/${agentId}/notifications/subscriptions/${subscriptionId}`,
      body,
    );
  }

  deleteNotificationSubscription(agentId: string, subscriptionId: string): Promise<unknown>;
  deleteNotificationSubscription(identifier: { agentId: string }, subscriptionId: string): Promise<unknown>;
  deleteNotificationSubscription(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      return this._deleteNotificationSubscription(args[0], args[1] as string);
    }
    const id = args[0] as { agentId: string };
    return this._deleteNotificationSubscription(id.agentId, args[1] as string);
  }
  private _deleteNotificationSubscription(agentId: string, subscriptionId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/notifications/subscriptions/${subscriptionId}`,
    );
  }

  getAgentNotificationSubscribers(agentId: string): Promise<NotificationSubscribersResponse>;
  getAgentNotificationSubscribers(identifier: { agentId: string }): Promise<NotificationSubscribersResponse>;
  getAgentNotificationSubscribers(...args: unknown[]): Promise<NotificationSubscribersResponse> {
    const { agentId } = resolveAgentArgs<undefined>(args);
    return this._getAgentNotificationSubscribers(agentId);
  }
  private _getAgentNotificationSubscribers(agentId: string) {
    return this.rest.get<NotificationSubscribersResponse>(
      `/agents/${agentId}/notifications/subscribers`,
    );
  }

  updateMeWebPushEndpoint(body: UpdateMeWebPushEndpointRequest) {
    return this.rest.post<unknown>(
      "/agents/me/notifications/update_web_push",
      body,
    );
  }

  getWebPushPublicKey() {
    return this.rest.get<{ key: string }>("/notifications/webpush-public-key");
  }
}
