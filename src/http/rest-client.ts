import { DooverApiError } from "./errors";

export interface DooverClientConfig {
  dataRestUrl: string;
  controlApiUrl: string;
  dataWssUrl: string;
  organisationId?: string | null;
  sharing?: "internal" | "external" | "none";
  impersonateUserStorageKey?: string;
  fetchImpl?: typeof fetch;
  webSocketImpl?: typeof WebSocket;
}

export interface RequestOptions {
  baseUrl?: string;
  path: string;
  method?: string;
  query?: QueryParams;
  body?: BodyInit | object | null;
  headers?: HeadersInit;
}

type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>;

type QueryParams = Record<string, QueryValue> | object;

export class RestClient {
  readonly config: Required<
    Pick<
      DooverClientConfig,
      "dataRestUrl" | "controlApiUrl" | "dataWssUrl" | "sharing" | "impersonateUserStorageKey"
    >
  > &
    Pick<DooverClientConfig, "organisationId" | "fetchImpl" | "webSocketImpl">;

  constructor(config: DooverClientConfig) {
    this.config = {
      ...config,
      sharing: config.sharing ?? "internal",
      organisationId: config.organisationId ?? null,
      impersonateUserStorageKey:
        config.impersonateUserStorageKey ?? "impersonate_user_id",
    };
  }

  async request<T>(options: RequestOptions): Promise<T> {
    const method = options.method ?? "GET";
    const url = this.buildUrl(options.baseUrl ?? this.config.dataRestUrl, options.path, options.query);
    const headers = new Headers(options.headers);
    const body = this.normalizeBody(options.body, headers);

    headers.set("X-Doover-Sharing", this.config.sharing);
    if (this.config.organisationId) {
      headers.set("X-Doover-Organisation", this.config.organisationId);
    }
    const impersonated = this.getImpersonatedUserId();
    if (impersonated) {
      headers.set("X-Doover-Assume", impersonated);
    }

    const fetchImpl = this.config.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
      method,
      headers,
      body,
      credentials: "include",
    });

    const payload = await this.parseResponse(response);
    if (!response.ok) {
      throw new DooverApiError({
        status: response.status,
        body: payload,
        url,
        method,
        message:
          typeof payload === "object" &&
          payload !== null &&
          "message" in payload &&
          typeof (payload as { message?: unknown }).message === "string"
            ? (payload as { message: string }).message
            : undefined,
      });
    }

    return payload as T;
  }

  get<T>(path: string, query?: RequestOptions["query"], baseUrl?: string) {
    return this.request<T>({ path, query, baseUrl });
  }

  post<T>(
    path: string,
    body?: RequestOptions["body"],
    query?: RequestOptions["query"],
    baseUrl?: string,
  ) {
    return this.request<T>({ path, body, query, method: "POST", baseUrl });
  }

  put<T>(
    path: string,
    body?: RequestOptions["body"],
    query?: RequestOptions["query"],
    baseUrl?: string,
  ) {
    return this.request<T>({ path, body, query, method: "PUT", baseUrl });
  }

  patch<T>(
    path: string,
    body?: RequestOptions["body"],
    query?: RequestOptions["query"],
    baseUrl?: string,
  ) {
    return this.request<T>({ path, body, query, method: "PATCH", baseUrl });
  }

  delete<T>(path: string, query?: RequestOptions["query"], baseUrl?: string) {
    return this.request<T>({ path, query, method: "DELETE", baseUrl });
  }

  private buildUrl(baseUrl: string, path: string, query?: RequestOptions["query"]) {
    const normalizedBase = baseUrl.replace(/\/+$/, "");
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const finalUrl = new URL(`${normalizedBase}${normalizedPath}`);
    if (query) {
      for (const [key, value] of Object.entries(query as Record<string, QueryValue>)) {
        if (value === undefined || value === null) {
          continue;
        }
        if (Array.isArray(value)) {
          value.forEach((item) => finalUrl.searchParams.append(key, String(item)));
        } else {
          finalUrl.searchParams.set(key, String(value));
        }
      }
    }
    return finalUrl.toString();
  }

  private normalizeBody(body: RequestOptions["body"], headers: Headers) {
    if (body === undefined || body === null) {
      return undefined;
    }
    if (
      typeof FormData !== "undefined" &&
      body instanceof FormData
    ) {
      return body;
    }
    if (typeof body === "string" || body instanceof Blob || ArrayBuffer.isView(body)) {
      return body as BodyInit;
    }
    headers.set("Content-Type", "application/json");
    return JSON.stringify(body);
  }

  private async parseResponse(response: Response) {
    if (response.status === 204) {
      return undefined;
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    if (
      contentType.includes("application/octet-stream") ||
      contentType.includes("application/pdf")
    ) {
      return response.blob();
    }
    const text = await response.text();
    if (!text) {
      return undefined;
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private getImpersonatedUserId() {
    if (typeof sessionStorage === "undefined") {
      return null;
    }
    return sessionStorage.getItem(this.config.impersonateUserStorageKey);
  }
}
