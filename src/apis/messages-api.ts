import type { RestClient } from "../http/rest-client";
import type {
  CreateMessageRequest,
  DataSeries,
  MessageStructure,
  UpdateMessageRequest,
} from "../types/openapi";
import { addTimestampToMessage, generateSnowflakeIdAtTime } from "../utils/snowflake";
import { resolveChannelArgs } from "./_args";
import type { DooverRequestOptions } from "../client/request-options";

export interface ListMessagesParams {
  before?: string;
  after?: string;
  limit?: number;
  field_name?: string[];
  /**
   * Result order. `"desc"` (default) returns the server's native newest-first
   * order; `"asc"` reverses the array client-side so the oldest message is at
   * index 0.
   */
  order?: "asc" | "desc";
  /**
   * Opt into paginated timeseries responses (`getTimeseries` only). When true
   * the server returns a `next` cursor alongside `{ results, count }`; pass it
   * back as `before` to page through results.
   */
  paginate?: boolean;
}

export interface MessageMutationParams {
  suppress_response?: boolean;
  clear_attachments?: boolean;
}

export type MessageBody = CreateMessageRequest | UpdateMessageRequest | FormData;

interface ResolvedListMessagesQuery {
  before?: string;
  after?: string;
  limit: number;
  field_name?: string[];
}

function resolveListMessagesParams(params?: ListMessagesParams): {
  query: ResolvedListMessagesQuery;
  order: "asc" | "desc";
} {
  const order = params?.order ?? "desc";
  const query: ResolvedListMessagesQuery = {
    before: params?.before ?? generateSnowflakeIdAtTime(new Date()),
    limit: params?.limit ?? 10,
  };
  if (params?.after !== undefined) query.after = params.after;
  if (params?.field_name !== undefined) query.field_name = params.field_name;
  return { query, order };
}

export class MessagesApi {
  constructor(private readonly rest: RestClient) {}

  listMessages(
    agentId: string,
    channelName: string,
    params?: ListMessagesParams,
  ): Promise<MessageStructure[]>;
  listMessages(
    agentId: string,
    channelName: string,
    params: ListMessagesParams,
    requestOptions: DooverRequestOptions,
  ): Promise<MessageStructure[]>;
  listMessages(
    identifier: { agentId: string; channelName: string },
    params?: ListMessagesParams,
  ): Promise<MessageStructure[]>;
  listMessages(
    identifier: { agentId: string; channelName: string },
    params: ListMessagesParams,
    requestOptions: DooverRequestOptions,
  ): Promise<MessageStructure[]>;
  async listMessages(...args: unknown[]): Promise<MessageStructure[]> {
    const { agentId, channelName, options } = resolveChannelArgs<ListMessagesParams>(args);
    return this._listMessages(agentId, channelName, options);
  }
  private async _listMessages(
    agentId: string,
    channelName: string,
    params?: ListMessagesParams,
  ): Promise<MessageStructure[]> {
    const { query, order } = resolveListMessagesParams(params);
    const response = await this.rest.get<Array<Omit<MessageStructure, "timestamp">>>(
      `/agents/${agentId}/channels/${channelName}/messages`,
      query,
    );
    const stamped = response.map(addTimestampToMessage);
    return order === "asc" ? [...stamped].reverse() : stamped;
  }

  postMessage(
    agentId: string,
    channelName: string,
    body: MessageBody,
  ): Promise<MessageStructure>;
  postMessage(
    identifier: { agentId: string; channelName: string },
    body: MessageBody,
  ): Promise<MessageStructure>;
  async postMessage(...args: unknown[]): Promise<MessageStructure> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, body] = args as [string, string, MessageBody];
      return this._postMessage(agentId, channelName, body);
    }
    const id = args[0] as { agentId: string; channelName: string };
    const body = args[1] as MessageBody;
    return this._postMessage(id.agentId, id.channelName, body);
  }
  private async _postMessage(agentId: string, channelName: string, body: MessageBody) {
    const response = await this.rest.post<Omit<MessageStructure, "timestamp">>(
      `/agents/${agentId}/channels/${channelName}/messages`,
      body,
    );
    return addTimestampToMessage(response);
  }

  getTimeseries(
    agentId: string,
    channelName: string,
    params: ListMessagesParams,
  ): Promise<DataSeries>;
  getTimeseries(
    identifier: { agentId: string; channelName: string },
    params: ListMessagesParams,
  ): Promise<DataSeries>;
  getTimeseries(...args: unknown[]): Promise<DataSeries> {
    const { agentId, channelName, options } = resolveChannelArgs<ListMessagesParams>(args);
    return this._getTimeseries(agentId, channelName, options as ListMessagesParams);
  }
  private _getTimeseries(agentId: string, channelName: string, params: ListMessagesParams) {
    const { order: _order, ...rest } = params;
    return this.rest.get<DataSeries>(
      `/agents/${agentId}/channels/${channelName}/messages/timeseries`,
      rest,
    );
  }

  getMessage(
    agentId: string,
    channelName: string,
    messageId: string,
  ): Promise<MessageStructure>;
  getMessage(
    identifier: { agentId: string; channelName: string },
    messageId: string,
  ): Promise<MessageStructure>;
  async getMessage(...args: unknown[]): Promise<MessageStructure> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, messageId] = args as [string, string, string];
      return this._getMessage(agentId, channelName, messageId);
    }
    const id = args[0] as { agentId: string; channelName: string };
    const messageId = args[1] as string;
    return this._getMessage(id.agentId, id.channelName, messageId);
  }
  private async _getMessage(agentId: string, channelName: string, messageId: string) {
    const response = await this.rest.get<Omit<MessageStructure, "timestamp">>(
      `/agents/${agentId}/channels/${channelName}/messages/${messageId}`,
    );
    return addTimestampToMessage(response);
  }

  putMessage(
    agentId: string,
    channelName: string,
    messageId: string,
    body: MessageBody,
    params?: MessageMutationParams,
  ): Promise<unknown>;
  putMessage(
    identifier: { agentId: string; channelName: string },
    messageId: string,
    body: MessageBody,
    params?: MessageMutationParams,
  ): Promise<unknown>;
  putMessage(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, messageId, body, params] = args as [
        string, string, string, MessageBody, MessageMutationParams | undefined,
      ];
      return this._putMessage(agentId, channelName, messageId, body, params);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._putMessage(
      id.agentId,
      id.channelName,
      args[1] as string,
      args[2] as MessageBody,
      args[3] as MessageMutationParams | undefined,
    );
  }
  private _putMessage(
    agentId: string,
    channelName: string,
    messageId: string,
    body: MessageBody,
    params?: MessageMutationParams,
  ) {
    return this.rest.put<unknown>(
      `/agents/${agentId}/channels/${channelName}/messages/${messageId}`,
      body,
      params,
    );
  }

  patchMessage(
    agentId: string,
    channelName: string,
    messageId: string,
    body: MessageBody,
    params?: MessageMutationParams,
  ): Promise<unknown>;
  patchMessage(
    identifier: { agentId: string; channelName: string },
    messageId: string,
    body: MessageBody,
    params?: MessageMutationParams,
  ): Promise<unknown>;
  patchMessage(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, messageId, body, params] = args as [
        string, string, string, MessageBody, MessageMutationParams | undefined,
      ];
      return this._patchMessage(agentId, channelName, messageId, body, params);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._patchMessage(
      id.agentId,
      id.channelName,
      args[1] as string,
      args[2] as MessageBody,
      args[3] as MessageMutationParams | undefined,
    );
  }
  private _patchMessage(
    agentId: string,
    channelName: string,
    messageId: string,
    body: MessageBody,
    params?: MessageMutationParams,
  ) {
    return this.rest.patch<unknown>(
      `/agents/${agentId}/channels/${channelName}/messages/${messageId}`,
      body,
      params,
    );
  }

  deleteMessage(
    agentId: string,
    channelName: string,
    messageId: string,
  ): Promise<unknown>;
  deleteMessage(
    identifier: { agentId: string; channelName: string },
    messageId: string,
  ): Promise<unknown>;
  deleteMessage(...args: unknown[]): Promise<unknown> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, messageId] = args as [string, string, string];
      return this._deleteMessage(agentId, channelName, messageId);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._deleteMessage(id.agentId, id.channelName, args[1] as string);
  }
  private _deleteMessage(agentId: string, channelName: string, messageId: string) {
    return this.rest.delete<unknown>(
      `/agents/${agentId}/channels/${channelName}/messages/${messageId}`,
    );
  }

  getMessageAttachment(
    agentId: string,
    channelName: string,
    messageId: string,
    attachmentId: string,
  ): Promise<Blob>;
  getMessageAttachment(
    identifier: { agentId: string; channelName: string },
    messageId: string,
    attachmentId: string,
  ): Promise<Blob>;
  getMessageAttachment(...args: unknown[]): Promise<Blob> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, messageId, attachmentId] = args as [
        string, string, string, string,
      ];
      return this._getMessageAttachment(agentId, channelName, messageId, attachmentId);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._getMessageAttachment(
      id.agentId,
      id.channelName,
      args[1] as string,
      args[2] as string,
    );
  }
  private _getMessageAttachment(
    agentId: string,
    channelName: string,
    messageId: string,
    attachmentId: string,
  ) {
    return this.rest.get<Blob>(
      `/agents/${agentId}/channels/${channelName}/messages/${messageId}/attachments/${attachmentId}`,
    );
  }

  getInvocationLogs<TLog = unknown>(
    agentId: string,
    channelName: string,
    messageId: string,
  ): Promise<TLog[]>;
  getInvocationLogs<TLog = unknown>(
    identifier: { agentId: string; channelName: string },
    messageId: string,
  ): Promise<TLog[]>;
  getInvocationLogs<TLog = unknown>(...args: unknown[]): Promise<TLog[]> {
    if (typeof args[0] === "string") {
      const [agentId, channelName, messageId] = args as [string, string, string];
      return this._getInvocationLogs<TLog>(agentId, channelName, messageId);
    }
    const id = args[0] as { agentId: string; channelName: string };
    return this._getInvocationLogs<TLog>(id.agentId, id.channelName, args[1] as string);
  }
  private _getInvocationLogs<TLog = unknown>(
    agentId: string,
    channelName: string,
    messageId: string,
  ) {
    return this.rest.get<TLog[]>(
      `/agents/${agentId}/channels/${channelName}/messages/${messageId}/logs`,
    );
  }

  createMultipartPayload(
    jsonPayload: Record<string, unknown>,
    attachments: Array<Blob | File>,
  ) {
    const formData = new FormData();
    formData.set("json_payload", JSON.stringify(jsonPayload));
    attachments.forEach((attachment, index) => {
      formData.set(`attachment-${index}`, attachment);
    });
    return formData;
  }
}
