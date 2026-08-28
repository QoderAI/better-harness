/**
 * Copies protocol data into Host ownership and freezes the complete plain-data
 * graph. Functions, symbols, exotic objects, and cycles cannot cross a frame
 * boundary with stable immutable semantics, so they fail before entering Host
 * state, observations, or identity-bearing snapshots.
 */
export function cloneAndFreezePlainData<T>(value: T, label: string): T {
  let clone: T;
  try {
    clone = structuredClone(value);
  } catch (error) {
    throw new TypeError(`${label} must be structured-cloneable: ${error instanceof Error ? error.message : String(error)}`);
  }
  assertPlainData(clone, label, new WeakSet());
  return freezeDeep(clone, new WeakSet());
}

function assertPlainData(value: unknown, label: string, ancestors: WeakSet<object>): void {
  if (typeof value === "function" || typeof value === "symbol") {
    throw new TypeError(`${label} may contain only primitives, arrays, and plain objects.`);
  }
  if (typeof value !== "object" || value === null) return;
  if (ancestors.has(value)) throw new TypeError(`${label} may not contain cycles.`);
  ancestors.add(value);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} may contain only primitives, arrays, and plain objects.`);
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    assertPlainData(nested, label, ancestors);
  }
  ancestors.delete(value);
}

function freezeDeep<T>(value: T, seen: WeakSet<object>): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value as Record<string, unknown>)) freezeDeep(nested, seen);
  return Object.freeze(value);
}
