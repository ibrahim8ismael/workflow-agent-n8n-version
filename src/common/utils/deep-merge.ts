export function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const output: Record<string, unknown> = { ...target };

  for (const key of Object.keys(source)) {
    const targetValue = target[key];
    const sourceValue = source[key];

    if (isObject(targetValue) && isObject(sourceValue)) {
      output[key] = deepMerge(
        targetValue as Record<string, unknown>,
        sourceValue as Record<string, unknown>,
      );
    } else if (sourceValue !== undefined) {
      output[key] = sourceValue;
    }
  }

  return output as T;
}

function isObject(item: unknown): item is Record<string, unknown> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}
