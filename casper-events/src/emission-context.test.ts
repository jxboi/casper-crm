import { describe, expect, it } from "vitest";
import { currentEmission, withEmissionContext } from "./emission-context.js";

describe("emission context (D-026)", () => {
  it("is undefined outside any scope (so emit keeps prior behavior)", () => {
    expect(currentEmission()).toBeUndefined();
  });

  it("exposes causationId/source inside a scope and restores after", () => {
    const seen = withEmissionContext({ causationId: "cs-1", source: "automation" }, () => {
      const c = currentEmission();
      return `${c?.causationId}:${c?.source}`;
    });
    expect(seen).toBe("cs-1:automation");
    expect(currentEmission()).toBeUndefined();
  });

  it("nests: an inner scope overrides, the outer is restored on exit", () => {
    withEmissionContext({ causationId: "outer" }, () => {
      expect(currentEmission()?.causationId).toBe("outer");
      withEmissionContext({ causationId: "inner", source: "ai" }, () => {
        expect(currentEmission()).toMatchObject({ causationId: "inner", source: "ai" });
      });
      expect(currentEmission()?.causationId).toBe("outer");
    });
  });
});
