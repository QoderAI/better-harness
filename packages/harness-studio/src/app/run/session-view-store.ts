import { useCallback, useSyncExternalStore, type SetStateAction } from "react";
interface OwnedState<T> { current: T; listeners: Set<() => void> }
const stores = new Map<string, OwnedState<unknown>>();
/** An active stream owns this state across view switches; a React mount only subscribes. */
export function useSessionOwnedState<T>(key: string, initial: T | (() => T)): [T, (update: SetStateAction<T>) => void, OwnedState<T>] {
  if (!stores.has(key)) stores.set(key, { current: typeof initial === "function" ? (initial as () => T)() : initial, listeners: new Set() });
  const store = stores.get(key)! as OwnedState<T>;
  const subscribe = useCallback((listener: () => void) => { store.listeners.add(listener); return () => { store.listeners.delete(listener); }; }, [store]);
  const get = useCallback(() => store.current, [store]);
  const value = useSyncExternalStore(subscribe, get);
  const set = useCallback((update: SetStateAction<T>) => {
    store.current = typeof update === "function" ? (update as (previous: T) => T)(store.current) : update;
    for (const listener of store.listeners) listener();
  }, [store]);
  return [value, set, store];
}
