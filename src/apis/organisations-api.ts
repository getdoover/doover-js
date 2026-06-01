import type { RestClient } from "../http/rest-client";
import type {
  CustomerSite,
  Organisation,
  PaginatedResponse,
} from "../types/viewer";

export interface ListOrganisationsOptions {
  page?: number;
  perPage?: number;
  search?: string;
  archived?: boolean | "";
  ordering?: string;
  name?: string;
  name__contains?: string;
  name__icontains?: string;
  id?: string | number;
  [key: string]: string | number | boolean | "" | undefined;
}

export class OrganisationsApi {
  constructor(
    private readonly rest: RestClient,
    private readonly controlApiUrl?: string,
  ) {}

  listOrganisations(
    options?: ListOrganisationsOptions,
  ): Promise<PaginatedResponse<Organisation>> {
    return this.rest.get<PaginatedResponse<Organisation>>(
      "/organisations/",
      buildListQuery(options),
      this.controlApiUrl,
    );
  }

  getOrganisation(id: string): Promise<Organisation> {
    return this.rest.get<Organisation>(
      `/organisations/${id}/`,
      undefined,
      this.controlApiUrl,
    );
  }

  /**
   * Convert an organisation record from `/organisations/` into the smaller
   * customer-site bootstrap shape returned by `/site/`.
   */
  toCustomerSite(organisation: Organisation): CustomerSite {
    return {
      id: organisation.id,
      name: organisation.name,
      application_id: organisation.application_id,
      archived: organisation.archived,
      theme: organisation.theme ?? {},
    };
  }
}

function buildListQuery(options?: ListOrganisationsOptions) {
  if (!options) return undefined;
  const { page, perPage, ...rest } = options;
  const query: Record<string, string | number | boolean> = {};

  if (page !== undefined) query.page = page;
  if (perPage !== undefined) query.per_page = perPage;

  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined) continue;
    query[key] = value;
  }

  return query;
}
