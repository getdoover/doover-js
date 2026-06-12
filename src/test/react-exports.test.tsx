import { expect } from "chai";
import { describe, it } from "mocha";
import * as r from "../react";

describe("react exports", () => {
  it("exports useClientStatus and the key helpers", () => {
    expect(r.useClientStatus).to.be.a("function");
    expect(r.useOfflineStatus).to.be.a("function");
    expect(r.channelAggregateQueryKey).to.be.a("function");
    expect(r.useConnectionState).to.be.a("function"); // still exported (soft-deprecated)
  });
});
