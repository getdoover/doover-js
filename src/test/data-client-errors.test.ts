import { expect } from "chai";
import { describe, it } from "mocha";

import { AmbiguousWriteError, UnsupportedCapabilityError } from "../client/errors";
import { DooverApiError } from "../http/errors";

describe("DataClient errors", () => {
  it("UnsupportedCapabilityError carries the capability and clientId", () => {
    const err = new UnsupportedCapabilityError("messages.listHistorical", "local:1");
    expect(err).to.be.instanceOf(DooverApiError);
    expect(err.capability).to.equal("messages.listHistorical");
    expect(err.clientId).to.equal("local:1");
    expect(err.message).to.include("messages.listHistorical");
    expect(err.name).to.equal("UnsupportedCapabilityError");
  });

  it("AmbiguousWriteError lists candidate source ids", () => {
    const err = new AmbiguousWriteError("messages.post", ["cloud", "local:1"]);
    expect(err).to.be.instanceOf(DooverApiError);
    expect(err.candidateSourceIds).to.deep.equal(["cloud", "local:1"]);
    expect(err.message).to.include("cloud");
    expect(err.message).to.include("local:1");
  });
});
