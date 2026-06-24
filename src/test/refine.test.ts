import { expect } from "chai";
import { describe, it } from "mocha";

import { createRefineDataProvider, getApiPath } from "../refine";
import { RestClient } from "../http/rest-client";
import { createFetchMock, createJsonResponse } from "./helpers";

describe("createRefineDataProvider", () => {
  it("builds list requests with api_path, pagination, sorters, filters and organisation header", async () => {
    const fetchMock = createFetchMock(() =>
      createJsonResponse({ count: 1, results: [{ id: "1", name: "Device" }] }),
    );
    const rest = new RestClient({
      dataRestUrl: "https://data.example.com/api",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://data.example.com/gateway",
      organisationId: "org-1",
      fetchImpl: fetchMock as typeof fetch,
    });
    const provider = createRefineDataProvider(rest);

    const result = await provider.getList({
      resource: "devices",
      pagination: { currentPage: 2, pageSize: 25 },
      sorters: [{ field: "name", order: "desc" }],
      filters: [
        { field: "search", operator: "contains", value: "pump" },
        { field: "archived", operator: "eq", value: false },
      ],
      meta: { api_path: "organisations/:organisationId/devices", organisationId: "org-2" },
    });

    expect(result).to.deep.equal({
      data: [{ id: "1", name: "Device" }],
      total: 1,
    });
    expect(fetchMock.callCount).to.equal(1);
    const [url, init] = fetchMock.getCall(0).args;
    expect(url).to.equal(
      "https://control.example.com/organisations/org-2/devices/?page=2&per_page=25&ordering=-name&search=pump&archived=false",
    );
    expect((init?.headers as Headers).get("X-Doover-Organisation")).to.equal("org-1");

    const explicit = await provider.getList({
      resource: "devices",
      meta: { organisation: "org-3" },
    });
    expect(explicit.total).to.equal(1);
    expect(
      (fetchMock.getCall(1).args[1]?.headers as Headers).get(
        "X-Doover-Organisation",
      ),
    ).to.equal("org-3");
  });

  it("renames object fields and sends JSON mutations through RestClient", async () => {
    const fetchMock = createFetchMock((_url, init) =>
      createJsonResponse(JSON.parse(String(init?.body))),
    );
    const rest = new RestClient({
      dataRestUrl: "https://data.example.com/api",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://data.example.com/gateway",
      fetchImpl: fetchMock as typeof fetch,
    });
    const provider = createRefineDataProvider(rest);

    const result = await provider.update({
      resource: "devices",
      id: "device-1",
      variables: { group: { id: "group-1", name: "Group" } },
      meta: { renameFields: { group: "group_id" } },
    });

    expect(result.data).to.deep.equal({
      group: "group-1",
      group_id: "group-1",
    });
  });

  it("normalizes API validation responses into Refine HttpError fields", async () => {
    const body = {
      deployment_config: {
        port: ["This field is required."],
      },
    };
    const fetchMock = createFetchMock(() => createJsonResponse(body, { status: 400 }));
    const rest = new RestClient({
      dataRestUrl: "https://data.example.com/api",
      controlApiUrl: "https://control.example.com",
      dataWssUrl: "wss://data.example.com/gateway",
      fetchImpl: fetchMock as typeof fetch,
    });
    const provider = createRefineDataProvider(rest);

    let error: unknown;
    try {
      await provider.update({
        resource: "app-installs",
        id: "install-1",
        variables: { deployment_config: {} },
      });
    } catch (err) {
      error = err;
    }

    expect(error).to.include({
      statusCode: 400,
      message: "This field is required.",
    });
    expect(error).to.have.nested.property(
      "errors.deployment_config.port.0",
      "This field is required.",
    );
  });
});

describe("getApiPath", () => {
  it("falls back across api_path candidates", () => {
    expect(
      getApiPath("domains", {
        api_path: ["organisations/:organisationId/domains", "organisations/domains"],
      }),
    ).to.equal("organisations/domains");
  });
});
