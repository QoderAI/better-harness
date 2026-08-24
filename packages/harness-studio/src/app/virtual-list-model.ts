export interface VirtualWindow {
  start: number;
  end: number;
  offset: number;
  totalSize: number;
}

/** Fixed-row virtual window with bounded overscan. */
export function fixedVirtualWindow(
  itemCount: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = 6,
): VirtualWindow {
  const safeCount = Math.max(0, Math.trunc(itemCount));
  const safeHeight = Math.max(1, rowHeight);
  const first = Math.max(0, Math.floor(Math.max(0, scrollTop) / safeHeight) - overscan);
  const visible = Math.ceil(Math.max(safeHeight, viewportHeight) / safeHeight) + overscan * 2;
  const end = Math.min(safeCount, first + visible);
  return { start: first, end, offset: first * safeHeight, totalSize: safeCount * safeHeight };
}
