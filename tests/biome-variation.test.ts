import { describe, expect, it } from "vitest";
import { createBiomeVariationField } from "../src/index.ts";

const biomes = {
  forest: {
    density: 0.65,
    maxSlope: 0.4,
    variants: [
      { id: "deer", weight: 2, scale: [0.85, 1.12] as const },
      { id: "hare", weight: 1 },
    ],
  },
  marsh: {
    density: 1,
    elevation: [-1, 4] as const,
    variants: [
      { id: "reed", weight: 1 },
      { id: "rock", weight: 0 },
    ],
  },
};
const sites = Array.from({ length: 100 }, (_, index) => ({
  id: String(index),
  biome: "forest" as const,
  elevation: index % 5,
  slope: 0.13,
}));

describe("biome variation recipes", () => {
  it("uses independent, order-invariant placement and variation streams", () => {
    const a = createBiomeVariationField({ placementSeed: "route", variationSeed: "Ada", biomes });
    const b = createBiomeVariationField({ placementSeed: "route", variationSeed: "Mira", biomes });
    const first = sites.map(a);
    const second = sites.map(b);
    expect([...sites].reverse().map(a).reverse()).toEqual(first);
    expect(second.map(Boolean)).toEqual(first.map(Boolean));
    expect(second).not.toEqual(first);
    expect(first).toContain(null);
    for (const match of first.flatMap((value) => (value ? [value] : []))) {
      expect(match.rotation).toBeGreaterThanOrEqual(0);
      expect(match.rotation).toBeLessThan(Math.PI * 2);
      if (match.id === "deer") {
        expect(match.scale).toBeGreaterThanOrEqual(0.85);
        expect(match.scale).toBeLessThanOrEqual(1.12);
      }
    }
  });

  it("applies per-biome slope, elevation and variant weights", () => {
    const field = createBiomeVariationField({ placementSeed: 9, variationSeed: 21, biomes });
    expect(field({ ...sites[0], slope: 0.41 })).toBeNull();
    expect(field({ ...sites[0], biome: "marsh", elevation: 5 })).toBeNull();
    expect(field({ ...sites[0], biome: "marsh", elevation: 4 })?.id).toBe("reed");
  });

  it("rejects ambiguous and invalid recipes", () => {
    const resolve = (weights: number[]) =>
      createBiomeVariationField({
        placementSeed: 9,
        variationSeed: 21,
        biomes: {
          forest: { density: 0.5, variants: weights.map((weight) => ({ id: "same", weight })) },
        },
      });
    expect(() => resolve([1, 2])).toThrow(RangeError);
    expect(() => resolve([Infinity])).toThrow(RangeError);
    expect(() => resolve([0])).toThrow(RangeError);
  });
});
