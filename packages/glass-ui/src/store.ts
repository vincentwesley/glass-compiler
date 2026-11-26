type Listener<S> = (state: S, prev: S) => void;

/**
 * The smallest useful state container: immutable snapshots, shallow patches and
 * synchronous listeners that see both the new and the previous state.
 */
export class Store<S extends object> {
  private listeners: Listener<S>[] = [];
  constructor(private current: S) {}

  get state(): S {
    return this.current;
  }

  set(patch: Partial<S>) {
    const prev = this.current;
    this.current = { ...prev, ...patch };
    for (const l of this.listeners) l(this.current, prev);
  }

  /** Returns a function that removes the listener. */
  subscribe(listener: Listener<S>): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
}
