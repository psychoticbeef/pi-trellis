import { describe, expect, it } from "vitest";
import packageExtension, { createTrellisExtension as packagedFactory } from "../extensions/index.js";
import sourceExtension, { createTrellisExtension as sourceFactory } from "../src/index.js";
import { createPiHarness } from "./harness.js";

describe("IT-4 TypeScript-Package-Entry lädt die Extension", () => {
  it("IT-4 re-exportiert die Extension ohne Build und registriert alle Commands", () => {
    expect(packageExtension).toBe(sourceExtension);
    expect(packagedFactory).toBe(sourceFactory);

    const harness = createPiHarness();
    packageExtension(harness.api);
    expect([...harness.commands.keys()].sort()).toEqual([
      "trellis:check",
      "trellis:init",
      "trellis:off",
      "trellis:on",
      "trellis:status",
    ]);
  });
});
