import { useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Roving-focus keyboard mechanics shared by every Studio tab strip and by the
 * surface switcher: the group is one Tab stop and Arrow/Home/End move the active
 * item, with focus following selection. Callers layer the correct ARIA on top
 * (tablist/tab for a real tab widget, aria-current for view navigation).
 */
export interface RovingFocus<T extends string> {
  onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  itemRef: (id: T) => (node: HTMLButtonElement | null) => void;
  tabIndexFor: (id: T) => 0 | -1;
}

export function useRovingFocus<T extends string>(options: {
  ids: readonly T[];
  active: T;
  onSelect: (id: T) => void;
  orientation?: "horizontal" | "vertical";
}): RovingFocus<T> {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const { ids, active, onSelect } = options;
  const nextKey = options.orientation === "vertical" ? "ArrowDown" : "ArrowRight";
  const previousKey = options.orientation === "vertical" ? "ArrowUp" : "ArrowLeft";

  return {
    onKeyDown: (event) => {
      if (![nextKey, previousKey, "Home", "End"].includes(event.key)) return;
      if (ids.length === 0) return;
      event.preventDefault();
      const current = Math.max(0, ids.indexOf(active));
      const target = event.key === "Home"
        ? 0
        : event.key === "End"
          ? ids.length - 1
          : event.key === nextKey
            ? (current + 1) % ids.length
            : (current - 1 + ids.length) % ids.length;
      const id = ids[target]!;
      onSelect(id);
      globalThis.requestAnimationFrame(() => refs.current.get(id)?.focus());
    },
    itemRef: (id) => (node) => { if (node) refs.current.set(id, node); else refs.current.delete(id); },
    tabIndexFor: (id) => active === id ? 0 : -1,
  };
}

/**
 * WAI-ARIA tabs wrapper for a real tab widget whose panel is a sibling of the
 * tab strip. Each strip used to ship a partial pattern (role="tab" without
 * roving focus), which the DESIGN.md interaction model forbids.
 */
export interface RovingTablist<T extends string> {
  tablistProps: {
    role: "tablist";
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
  };
  getTabProps: (id: T) => {
    ref: (node: HTMLButtonElement | null) => void;
    role: "tab";
    tabIndex: 0 | -1;
    "aria-selected": boolean;
    "aria-controls": string | undefined;
  };
}

export function useRovingTablist<T extends string>(options: {
  ids: readonly T[];
  active: T;
  onSelect: (id: T) => void;
  orientation?: "horizontal" | "vertical";
  panelId?: string;
}): RovingTablist<T> {
  const roving = useRovingFocus(options);
  return {
    tablistProps: { role: "tablist", onKeyDown: roving.onKeyDown },
    getTabProps: (id) => ({
      ref: roving.itemRef(id),
      role: "tab",
      tabIndex: roving.tabIndexFor(id),
      "aria-selected": options.active === id,
      "aria-controls": options.panelId,
    }),
  };
}
