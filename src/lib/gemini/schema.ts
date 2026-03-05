type JsonRecord = Record<string, unknown>;

const CONSTRAINT_KEY_VALUES = [
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'minItems',
  'maxItems',
  'multipleOf',
  'pattern',
  'format',
] as const;
const CONSTRAINT_KEYS = new Set<string>(CONSTRAINT_KEY_VALUES);
const INTEGER_JSON_TYPE = 'integer';
const NUMBER_JSON_TYPE = 'number';

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripConstraintValue(value: unknown): unknown {
  if (!isJsonRecord(value)) {
    if (!Array.isArray(value)) {
      return value;
    }

    const hasNested = value.some((v) => isJsonRecord(v) || Array.isArray(v));
    if (!hasNested) {
      return value;
    }
  }

  if (Array.isArray(value)) {
    return value.map((v) => stripConstraintValue(v));
  }

  return stripJsonSchemaConstraints(value);
}

export function stripJsonSchemaConstraints(schema: JsonRecord): JsonRecord {
  const result: JsonRecord = {};

  for (const [key, value] of Object.entries(schema)) {
    if (CONSTRAINT_KEYS.has(key)) {
      continue;
    }

    // Gemini API does not support "integer" as a JSON Schema type;
    // erase to "number" so the constraint is accepted by the backend.
    if (key === 'type' && value === INTEGER_JSON_TYPE) {
      result[key] = NUMBER_JSON_TYPE;
      continue;
    }

    result[key] = stripConstraintValue(value);
  }

  return result;
}
