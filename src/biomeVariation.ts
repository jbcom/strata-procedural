import { createSeededRandom, seedToUint32, type Seed } from "./noise.js";

export interface BiomeVariant<Id extends string = string> {
  id: Id;
  /** Relative weight. Zero disables the variant. */
  weight: number;
  scale?: readonly [min: number, max: number];
}

export interface BiomeVariationRule<Id extends string = string> {
  /** Chance of occupying a suitable site, from zero to one. */
  density: number;
  /** Optional limits are in the caller's elevation units and slope convention. */
  elevation?: readonly [min: number, max: number];
  maxSlope?: number;
  variants: readonly BiomeVariant<Id>[];
}

export interface BiomeVariationSite<Biome extends string = string> {
  /** A persistent address, such as a grid cell or authored waypoint ID. */
  id: string;
  biome: Biome;
  elevation: number;
  slope: number;
}

export interface BiomeVariation<Id extends string = string> {
  id: Id;
  scale: number;
  rotation: number;
  variation: number;
}

export interface BiomeVariationOptions<Biome extends string, Id extends string> {
  placementSeed: Seed;
  variationSeed: Seed;
  biomes: Readonly<Partial<Record<Biome, BiomeVariationRule<Id>>>>;
}

function validRange(range: readonly [number, number], min: number): boolean {
  return range.every(Number.isFinite) && range[0] >= min && range[1] >= range[0];
}

/** Resolve each site independently, keeping occupancy stable when only the variation seed changes. */
export function createBiomeVariationField<Biome extends string, Id extends string>(
  options: BiomeVariationOptions<Biome, Id>,
): (site: BiomeVariationSite<Biome>) => BiomeVariation<Id> | null {
  const placementSeed = seedToUint32(options.placementSeed);
  const variationSeed = seedToUint32(options.variationSeed);
  type WeightedVariant = BiomeVariant<Id> & { upperBound: number };
  const rules = new Map<
    string,
    Omit<BiomeVariationRule<Id>, "variants"> & {
      variants: WeightedVariant[];
      fallback: WeightedVariant;
      total: number;
    }
  >();
  for (const biome of Object.keys(options.biomes) as Biome[]) {
    const rule = options.biomes[biome];
    if (!rule) continue;
    if (
      !Number.isFinite(rule.density) ||
      rule.density < 0 ||
      rule.density > 1 ||
      (rule.elevation && !validRange(rule.elevation, -Infinity)) ||
      (rule.maxSlope !== undefined && (!Number.isFinite(rule.maxSlope) || rule.maxSlope < 0))
    )
      throw new RangeError(`Invalid placement rule for biome "${biome}"`);

    const seen = new Set<Id>();
    const variants = rule.variants.map((variant) => {
      if (
        !variant.id ||
        seen.has(variant.id) ||
        !Number.isFinite(variant.weight) ||
        variant.weight < 0 ||
        (variant.scale && (!validRange(variant.scale, 0) || variant.scale[0] === 0))
      )
        throw new RangeError(`Invalid variant "${variant.id}" for biome "${biome}"`);
      seen.add(variant.id);
      return { ...variant, scale: variant.scale && ([...variant.scale] as [number, number]) };
    });
    const largest = variants.reduce((max, variant) => Math.max(max, variant.weight), 0);
    let total = 0;
    const weighted: WeightedVariant[] = [];
    for (const variant of variants) {
      if (variant.weight === 0) continue;
      const upperBound = total + variant.weight / largest;
      if (upperBound === total) continue;
      weighted.push({ ...variant, upperBound });
      total = upperBound;
    }
    const fallback = weighted.at(-1);
    if (!fallback)
      throw new RangeError(`Biome "${biome}" requires a positive total variant weight`);
    rules.set(biome, {
      ...rule,
      elevation: rule.elevation && [...rule.elevation],
      variants: weighted,
      fallback,
      total,
    });
  }

  return ({ id, biome, elevation, slope }) => {
    if (!id || !Number.isFinite(elevation) || !Number.isFinite(slope) || slope < 0)
      throw new RangeError(
        "A biome variation site requires an ID, finite elevation and non-negative slope",
      );
    const rule = rules.get(biome);
    if (
      !rule ||
      (rule.elevation && (elevation < rule.elevation[0] || elevation > rule.elevation[1])) ||
      (rule.maxSlope !== undefined && slope > rule.maxSlope)
    )
      return null;

    const key = JSON.stringify([biome, id]);
    const placement = createSeededRandom(`${placementSeed}:placement:${key}`);
    if (placement() >= rule.density) return null;

    const appearance = createSeededRandom(`${variationSeed}:variation:${key}`);
    const draw = appearance() * rule.total;
    const variant = rule.variants.find(({ upperBound }) => draw < upperBound) ?? rule.fallback;
    const [min, max] = variant.scale ?? [1, 1];
    return {
      id: variant.id,
      scale: min + (max - min) * appearance(),
      rotation: appearance() * Math.PI * 2,
      variation: appearance(),
    };
  };
}
