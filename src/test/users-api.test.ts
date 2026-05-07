import { expect } from "chai";
import { UsersApi } from "../apis/users-api";
import { makeRestStub } from "./api-overloads.test";

describe("UsersApi", () => {
  it("getMe calls /users/me on controlApiUrl", async () => {
    const rest = makeRestStub();
    const api = new UsersApi(rest, "https://control.example.com");
    await api.getMe();
    expect(rest.calls).to.have.lengthOf(1);
    expect(rest.calls[0]!.method).to.equal("get");
    expect(rest.calls[0]!.args).to.deep.equal([
      "/users/me",
      undefined,
      "https://control.example.com",
    ]);
  });
});
