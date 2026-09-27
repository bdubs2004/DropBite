/**
 * Display name for a DM thread, from the viewer's perspective.
 *
 * `others` is everyone in the thread except you. A 1:1 thread shows the one
 * other person; a group joins the names and, past three, trims to two plus a
 * "+N" so the title stays on one line. "You" is never listed.
 */
export function conversationTitle(
  others: { display_name?: string | null; handle?: string | null }[],
): string {
  const names = others.map(
    (u) => u.display_name?.trim() || (u.handle ? '@' + u.handle : 'Someone'),
  );
  if (names.length === 0) return 'Someone';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} & ${names[2]}`;
  return `${names[0]}, ${names[1]} +${names.length - 2}`;
}

/** A thread is a group once it has more than one other member. */
export function isGroupConversation(othersCount: number): boolean {
  return othersCount > 1;
}
