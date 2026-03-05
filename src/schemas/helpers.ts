import { z } from 'zod';

export function createBoundedString(
  min: number,
  max: number,
  description: string
): z.ZodString {
  return z.string().min(min).max(max).describe(description);
}

export function createOptionalBoundedString(
  min: number,
  max: number,
  description: string
): z.ZodOptional<z.ZodString> {
  return createBoundedString(min, max, description).optional();
}

export function createBoundedStringArray(
  itemMin: number,
  itemMax: number,
  minItems: number,
  maxItems: number,
  description: string
): z.ZodArray<z.ZodString> {
  return z
    .array(z.string().min(itemMin).max(itemMax))
    .min(minItems)
    .max(maxItems)
    .describe(description);
}

export function createOptionalBoundedInteger(
  min: number,
  max: number,
  description: string
): z.ZodOptional<z.ZodInt> {
  return z.int().min(min).max(max).optional().describe(description);
}
