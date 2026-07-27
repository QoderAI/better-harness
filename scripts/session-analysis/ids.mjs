import { createHash } from "node:crypto";

export function stableId(parts) {
  return createHash("sha1").update(parts.filter(Boolean).join("|")).digest("hex").slice(0, 16);
}

export function mapToSortedObject(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}
