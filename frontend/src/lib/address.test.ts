import { describe, expect, it } from "vitest";
import { shortAddress } from "./address";

// A real 56-character account id (the deploy admin in deployments/testnet.json).
const ACCOUNT = "GBPLJHDI6RPLS4EEJJTM7EVEV3UNTXLFAACWA63QSTHGLWH5RO3LQ75B";

describe("shortAddress", () => {
  it("keeps the first six and the last four characters", () => {
    expect(shortAddress(ACCOUNT)).toBe("GBPLJH…Q75B");
  });

  it("leaves a value too short to abbreviate unmodified", () => {
    // Abbreviating these would make both ends overlap and print a fragment that
    // looks like a different address.
    expect(shortAddress("GABCD")).toBe("GABCD");
    expect(shortAddress("GABCDEFGHI")).toBe("GABCDEFGHI");
    expect(shortAddress("GABCDEFGHIJ")).toBe("GABCDE…GHIJ");
  });
});
