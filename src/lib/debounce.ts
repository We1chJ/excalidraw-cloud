export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  /** Runs the pending call immediately, if there is one. */
  flush(): void;
  cancel(): void;
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;

  const debounced = ((...args: A) => {
    pending = args;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      const args_ = pending;
      pending = undefined;
      if (args_) fn(...args_);
    }, waitMs);
  }) as Debounced<A>;

  debounced.flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const args = pending;
    pending = undefined;
    if (args) fn(...args);
  };

  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };

  return debounced;
}
