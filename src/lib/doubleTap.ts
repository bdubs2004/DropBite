/**
 * Tell a double-tap from a single tap.
 *
 * A second tap within `delay` ms is a double-tap. When there's also a
 * single-tap action (tap a chat photo to open it, double-tap to heart it), the
 * single action waits out `delay` first so a double-tap never also opens it.
 * With no single action, nothing waits: the second tap fires straight away.
 */

export const DOUBLE_TAP_MS = 280;

export type TapHandler = { tap: () => void; cancel: () => void };

export function makeTapHandler({
  onDouble,
  onSingle,
  delay = DOUBLE_TAP_MS,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}: {
  onDouble: () => void;
  onSingle?: () => void;
  delay?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => any;
  clearTimer?: (t: any) => void;
}): TapHandler {
  let lastAt = -Infinity;
  let timer: any = null;
  const cancel = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };
  return {
    cancel,
    tap: () => {
      const t = now();
      if (t - lastAt < delay) {
        cancel();
        lastAt = -Infinity; // a third quick tap starts over
        onDouble();
        return;
      }
      lastAt = t;
      if (onSingle) {
        cancel();
        timer = setTimer(() => {
          timer = null;
          onSingle();
        }, delay);
      }
    },
  };
}
