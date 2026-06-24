import { DooverApiError } from "../http/errors";
import type { RestClient } from "../http/rest-client";

export type RefineRecord = Record<string, unknown> & { id?: string | number };
export type RefineMeta = Record<string, unknown> | undefined;

export interface RefinePagination {
  currentPage?: number;
  pageSize?: number;
}

export interface RefineSorter {
  field: string;
  order?: "asc" | "desc";
}

export interface RefineCrudFilter {
  field: string;
  operator: string;
  value: unknown;
}

export interface RefineGetListParams {
  resource: string;
  pagination?: RefinePagination;
  sorters?: RefineSorter[];
  filters?: RefineCrudFilter[];
  meta?: RefineMeta;
}

export interface RefineOneParams {
  resource: string;
  id: string | number;
  meta?: RefineMeta;
}

export interface RefineMutationParams {
  resource: string;
  id?: string | number;
  variables?: unknown;
  meta?: RefineMeta;
}

export interface RefineCustomParams {
  url: string;
  method: string;
  headers?: Record<string, string>;
  payload?: unknown;
  meta?: RefineMeta;
}

export interface RefineDataProviderLike {
  getOne: (params: RefineOneParams) => Promise<{ data: unknown }>;
  getList: <TData extends RefineRecord = RefineRecord>(
    params: RefineGetListParams,
  ) => Promise<{ data: TData[]; total: number }>;
  create: (params: RefineMutationParams) => Promise<{ data: unknown }>;
  update: (params: RefineMutationParams & { id: string | number }) => Promise<{ data: unknown }>;
  deleteOne: (params: RefineOneParams) => Promise<{ data: unknown }>;
  custom: (params: RefineCustomParams) => Promise<{ data: unknown }>;
  getApiUrl: () => string;
}

export interface CreateRefineDataProviderOptions {
  baseUrl?: string;
}

interface PaginatedList<TData> {
  count: number;
  results: TData[];
}

interface RefineHttpError extends Error {
  statusCode: number;
  errors: unknown;
  responseJson: unknown;
}

export function createRefineDataProvider(
  rest: RestClient,
  options: CreateRefineDataProviderOptions = {},
): RefineDataProviderLike {
  const baseUrl = options.baseUrl ?? rest.config.controlApiUrl;

  return {
    getOne: async ({ resource, id, meta }) => {
      const data = await requestForRefine(() => rest.request({
        path: `/${getApiPath(resource, meta)}/${id}/`,
        headers: getMetaHeaders(meta),
        baseUrl,
      }));
      return { data };
    },

    getList: async <TData extends RefineRecord = RefineRecord>({
      resource,
      pagination,
      sorters,
      filters,
      meta,
    }: RefineGetListParams) => {
      const data = await requestForRefine(() => rest.request<PaginatedList<TData>>({
        path: `/${getApiPath(resource, meta)}/`,
        query: buildListQuery({ pagination, sorters, filters, meta }),
        headers: getMetaHeaders(meta),
        baseUrl,
      }));
      return {
        data: data.results,
        total: data.count,
      };
    },

    create: async ({ resource, variables, meta }) => {
      const mergedMeta = isRecord(variables) ? { ...meta, ...variables } : meta;
      const data = await requestForRefine(() => rest.request({
        path: `/${getApiPath(resource, mergedMeta)}/`,
        method: "POST",
        body: prepareVariables(variables, meta) as BodyInit | object | null | undefined,
        headers: getMetaHeaders(meta),
        baseUrl,
      }));
      return { data };
    },

    update: async ({ resource, id, variables, meta }) => {
      const data = await requestForRefine(() => rest.request({
        path: `/${getApiPath(resource, meta)}/${id}/`,
        method: "PATCH",
        body: prepareVariables(variables, meta) as BodyInit | object | null | undefined,
        headers: getMetaHeaders(meta),
        baseUrl,
      }));
      return { data };
    },

    deleteOne: async ({ resource, id, meta }) => {
      const data = await requestForRefine(() => rest.request({
        path: `/${getApiPath(resource, meta)}/${id}/`,
        method: "DELETE",
        headers: getMetaHeaders(meta),
        baseUrl,
      }));
      return { data: data ?? null };
    },

    custom: async ({ url, method, headers, payload, meta }) => {
      const { path, query } = splitCustomUrl(url);
      const data = await requestForRefine(() => rest.request({
        path,
        method,
        headers: { ...headers, ...getMetaHeaders(meta) },
        body: payload == null ? undefined : payload,
        query,
        baseUrl,
      }));
      return { data };
    },

    getApiUrl: () => baseUrl,
  };
}

async function requestForRefine<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    throw normalizeRefineError(error);
  }
}

function normalizeRefineError(error: unknown): unknown {
  if (!(error instanceof DooverApiError)) return error;

  const message = extractErrorMessage(error.body) ?? error.message;
  const refineError = error as DooverApiError & RefineHttpError;
  refineError.message = message;
  refineError.statusCode = error.status;
  refineError.errors = normalizeErrorBody(error.body);
  refineError.responseJson = error.body;
  return refineError;
}

function normalizeErrorBody(body: unknown): unknown {
  if (isRecord(body) && "errors" in body && body.errors !== undefined) {
    return body.errors;
  }
  return body;
}

function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body === "string") return body;
  if (Array.isArray(body)) {
    for (const item of body) {
      const message = extractErrorMessage(item);
      if (message) return message;
    }
    return undefined;
  }
  if (!isRecord(body)) return undefined;

  for (const key of ["message", "detail", "error"] as const) {
    const value = body[key];
    if (typeof value === "string") return value;
  }

  for (const value of Object.values(body)) {
    const message = extractErrorMessage(value);
    if (message) return message;
  }
  return undefined;
}

function getMetaHeaders(meta?: RefineMeta): Record<string, string> | undefined {
  if (!meta?.organisation) return undefined;
  return { "X-Doover-Organisation": String(idValue(meta.organisation)) };
}

export function getApiPath(resource: string, meta?: RefineMeta): string {
  const apiPath = meta?.api_path;
  if (apiPath !== undefined) {
    const paths = typeof apiPath === "string" ? [apiPath] : apiPath;
    if (Array.isArray(paths)) {
      for (const path of paths) {
        if (typeof path !== "string") continue;
        try {
          return fillApiPath(path, meta);
        } catch (err) {
          if (paths.length === 1) throw err;
        }
      }
    }
  }
  return resource;
}

function fillApiPath(path: string, meta?: RefineMeta): string {
  let apiPath = path;
  const matches = [...apiPath.matchAll(/:([^/]+)/g)].map((m) => m[1]);
  for (const match of matches) {
    const value = lookupPathParam(match, meta);
    if (value === undefined) {
      throw new Error(`Missing value for ${match} in meta`);
    }
    apiPath = apiPath.replace(`:${match}`, String(value));
  }
  return apiPath;
}

function lookupPathParam(match: string, meta?: RefineMeta): unknown {
  if (!meta) return undefined;
  if (match in meta && meta[match] !== undefined) return idValue(meta[match]);
  const withoutId = match.replace(/id$/i, "");
  if (withoutId in meta && meta[withoutId] !== undefined) {
    return idValue(meta[withoutId]);
  }
  return undefined;
}

function idValue(value: unknown): unknown {
  return isRecord(value) && "id" in value ? value.id : value;
}

function buildListQuery({
  pagination,
  sorters,
  filters,
  meta,
}: {
  pagination?: RefinePagination;
  sorters?: RefineSorter[];
  filters?: RefineCrudFilter[];
  meta?: RefineMeta;
}): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = {};

  if (pagination) {
    query.page = pagination.currentPage ?? 1;
    if (pagination.pageSize) query.per_page = pagination.pageSize;
  }

  if (sorters && sorters.length > 0) {
    query.ordering = `${sorters[0].order === "desc" ? "-" : ""}${sorters[0].field}`;
  }

  let hasArchivedFilter = false;
  for (const filter of filters ?? []) {
    if (!filter.field || !filter.operator) continue;
    if (filter.operator === "contains" && filter.field === "search") {
      query.search = String(filter.value ?? "");
      continue;
    }
    if (filter.field === "archived" || filter.field === "device_archived") {
      hasArchivedFilter = hasArchivedFilter || filter.field === "archived";
      if (filter.operator === "eq" || filter.operator === "in") {
        query[filter.field] =
          filter.value === "__all__" ? "" : String(filter.value ?? "");
      }
      continue;
    }
    if (filter.operator === "contains") {
      query[`${filter.field}__icontains`] = String(filter.value ?? "");
    } else if (filter.operator === "containss") {
      query[`${filter.field}__contains`] = String(filter.value ?? "");
    } else if (filter.operator === "eq" || filter.operator === "in") {
      query[filter.field] = String(filter.value ?? "");
    }
  }

  if (meta?.canArchive === true && !hasArchivedFilter) {
    query.archived = "false";
  }

  return query;
}

function prepareVariables(variables: unknown, meta?: RefineMeta): unknown {
  if (!isRecord(variables)) return variables;
  const next: Record<string, unknown> = { ...variables };
  const renameFields = isRecord(meta?.renameFields) ? meta.renameFields : null;

  if (renameFields) {
    for (const [from, to] of Object.entries(renameFields)) {
      if (typeof to !== "string") continue;
      const value = next[from];
      const mapped = Array.isArray(value)
        ? value.map((item) => idValue(item))
        : idValue(value);
      next[from] = mapped;
      next[to] = mapped;
    }
  }

  if (Object.values(next).some(isFileLike)) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(next)) {
      if (value == null) continue;
      if (isFileLike(value)) {
        formData.append(key, value);
      } else if (typeof value === "object") {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, String(value));
      }
    }
    return formData;
  }

  return next;
}

function splitCustomUrl(url: string): {
  path: string;
  query: Record<string, string | string[]> | undefined;
} {
  const [rawPath, rawQuery] = url.replace(/^\//, "").split("?", 2);
  const path = `/${rawPath.replace(/\/?$/, "/")}`;
  if (!rawQuery) return { path, query: undefined };

  const params = new URLSearchParams(rawQuery);
  const query: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    query[key] = values.length > 1 ? values : values[0] ?? "";
  }
  return { path, query };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileLike(value: unknown): value is Blob {
  return typeof File !== "undefined" && value instanceof File;
}
