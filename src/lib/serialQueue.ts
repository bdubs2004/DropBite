/**
 * Wrap an async function so calls run one after another, never overlapping.
 *
 * For read-then-write sequences that are called from more than one place. The
 * mealtime reminder sync is the motivating case: it reads what is scheduled,
 * cancels it, then schedules the replacements. Two overlapping runs could both
 * read the same "nothing pending" state and both schedule, which is how users
 * ended up with two notifications for every meal.
 *
 * A rejected run does not poison the queue — the next call still runs.
 */
export function serialQueue<Arg, Result>(
  run: (arg: Arg) => Promise<Result>,
  fallback: Result,
): (arg: Arg) => Promise<Result> {
  let tail: Promise<Result> = Promise.resolve(fallback);
  return (arg: Arg) => {
    tail = tail.catch(() => fallback).then(() => run(arg));
    return tail;
  };
}
