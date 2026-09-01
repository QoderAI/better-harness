import type { TimelineItem } from "./run-store.js";
import type { DebuggerEventKind } from "../../contracts/debugger-session.js";

export interface TimelineBin<Kind extends string> {
  index: number;
  count: number;
  kind: Kind;
}

export interface LiveTimelineGroup {
  key: string;
  kind: DebuggerEventKind;
  items: TimelineItem[];
}

/** Bound minimap DOM independently of session size. */
export function buildTimelineBins<Item, Kind extends string>(
  items: readonly Item[],
  maximumBins: number,
  kindFor: (item: Item) => Kind,
): TimelineBin<Kind>[] {
  if (items.length === 0 || maximumBins < 1) return [];
  const binSize = Math.max(1, Math.ceil(items.length / maximumBins));
  const bins: TimelineBin<Kind>[] = [];
  for (let start = 0; start < items.length; start += binSize) {
    const slice = items.slice(start, Math.min(items.length, start + binSize));
    const kinds = new Map<Kind, number>();
    for (const item of slice) {
      const kind = kindFor(item);
      kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    }
    const kind = [...kinds].sort((left, right) => right[1] - left[1])[0]![0];
    bins.push({ index: bins.length, count: slice.length, kind });
  }
  return bins;
}

/** Project live tools into the same user-facing phase vocabulary as recorded sessions. */
export function semanticToolKind(item: TimelineItem): DebuggerEventKind {
  if (item.kind === "message") return "response";
  const searchable = `${item.name} ${item.argsText}`.toLowerCase();
  if (/(edit|write|patch|replace|create|delete|move|rename)/.test(searchable)) return "change";
  if (item.status === "failed" || /(test|lint|build|check|verify)/.test(searchable)) return "verify";
  return "explore";
}

/** Aggregate adjacent equivalent tools while leaving responses readable. */
export function groupLiveTimeline(items: readonly TimelineItem[]): LiveTimelineGroup[] {
  const groups: LiveTimelineGroup[] = [];
  for (const item of items) {
    const kind = semanticToolKind(item);
    const current = groups.at(-1);
    const currentTool = current?.items[0];
    if (
      item.kind === "tool-call" &&
      current !== undefined &&
      currentTool?.kind === "tool-call" &&
      current.kind === kind &&
      currentTool.name === item.name
    ) {
      current.items.push(item);
    } else {
      groups.push({ key: `${item.kind}:${item.id}`, kind, items: [item] });
    }
  }
  return groups;
}
