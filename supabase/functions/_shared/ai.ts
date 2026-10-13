// What format-recipe and lookup-nutrition share about talking to the model,
// kept free of Deno and Supabase so it can be tested in Node
// (__tests__/ai.test.ts).
//
// The rules:
//   * Requests are size-capped before they're read.
//   * Every upstream call has a timeout.
//   * What the person typed is data, never instructions: it goes in its own
//     delimited block, the model has no tools, and whatever comes back is
//     rebuilt field by field into a fixed shape. Nothing the model says is
//     passed through as-is, and an answer that repeats the server's
//     instructions is thrown away.

/** Read a JSON body, refusing anything over `maxBytes` (declared or actual). */
export async function readJsonBody(
  req: Request,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; status: 400 | 413 }> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > maxBytes) return { ok: false, status: 413 };
  if (!req.body) return { ok: false, status: 400 };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return { ok: true, body: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { ok: false, status: 400 };
  }
}

export type ModelCall = {
  apiKey: string;
  workspaceId?: string | null;
  model: string;
  maxTokens: number;
  system: string;
  user: string;
  timeoutMs: number;
};

/**
 * One Messages API call, no tools, with a timeout. Returns the reply text, or
 * a short reason for the logs. Never the key, never the provider's body to
 * the caller.
 */
export async function callModel(
  call: ModelCall,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  let resp: Response;
  try {
    resp = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(call.timeoutMs),
      headers: {
        'content-type': 'application/json',
        'x-api-key': call.apiKey,
        'anthropic-version': '2023-06-01',
        ...(call.workspaceId ? { 'anthropic-workspace-id': call.workspaceId } : {}),
      },
      body: JSON.stringify({
        model: call.model,
        max_tokens: call.maxTokens,
        system: call.system,
        messages: [{ role: 'user', content: call.user }],
      }),
    });
  } catch (e) {
    const name = (e as { name?: string })?.name ?? '';
    return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
  }
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => '')).slice(0, 300);
    return { ok: false, reason: `http ${resp.status}: ${detail}` };
  }
  try {
    const data = await resp.json();
    const block = Array.isArray(data?.content) ? data.content.find((b: any) => b?.type === 'text') : null;
    const text = typeof block?.text === 'string' ? block.text : '';
    return text ? { ok: true, text } : { ok: false, reason: 'empty reply' };
  } catch {
    return { ok: false, reason: 'unreadable reply' };
  }
}

/** The first JSON object in a reply (models sometimes wrap it in prose or fences). */
export function extractJson(text: string): Record<string, unknown> | null {
  const attempt = (s: string) => {
    try {
      const v = JSON.parse(s);
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const direct = attempt(text.trim());
  if (direct) return direct;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start >= 0 && end > start ? attempt(text.slice(start, end + 1)) : null;
}

/** Text the model wrote, made safe to store and show: plain, single-spaced where it should be, capped. */
function cleanText(v: unknown, max: number, multiline = false): string {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return '';
  let s = v
    // Control characters (bar newline/tab) and bidi overrides that can disguise text.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f‪-‮⁦-⁩]/g, '')
    .replace(/\r\n?/g, '\n');
  s = multiline ? s.replace(/\n{3,}/g, '\n\n') : s.replace(/\s+/g, ' ');
  return s.trim().slice(0, max);
}

export type ShapedRecipe = {
  is_recipe: boolean;
  title: string;
  ingredients: { item: string; quantity: string; unit: string }[];
  steps: string[];
  cook_time_minutes: number | null;
};

/** The recipe card, rebuilt from whatever the model returned. Only the documented fields survive. */
export function shapeRecipe(d: Record<string, unknown>): ShapedRecipe {
  const ingredients = (Array.isArray(d.ingredients) ? d.ingredients : [])
    .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object' && !Array.isArray(i))
    .map((i) => ({
      item: cleanText(i.item, 120),
      quantity: cleanText(i.quantity, 32),
      unit: cleanText(i.unit, 32),
    }))
    .filter((i) => i.item.length > 0)
    .slice(0, 50);
  const steps = (Array.isArray(d.steps) ? d.steps : [])
    .map((s) => cleanText(s, 500, true))
    .filter((s) => s.length > 0)
    .slice(0, 50);
  const cook = d.cook_time_minutes;
  return {
    // Only a real true: the string "false" is not a recipe.
    is_recipe: d.is_recipe === true,
    title: cleanText(d.title, 120) || 'My Recipe',
    ingredients,
    steps,
    cook_time_minutes:
      typeof cook === 'number' && Number.isFinite(cook) ? Math.min(Math.max(Math.round(cook), 0), 6000) : null,
  };
}

/** Weights for each ingredient, paired by position. Anything odd becomes "unknown", never a guess. */
export function shapeWeights(
  d: Record<string, unknown> | null,
  ingredients: { item: string }[],
): { grams: number | null; search_term: string }[] | null {
  const list = d?.ingredients;
  if (!Array.isArray(list)) return null;
  return ingredients.map((original, i) => {
    const row = list[i] && typeof list[i] === 'object' ? (list[i] as Record<string, unknown>) : {};
    const g = row.grams;
    const term = cleanText(row.search_term, 120).toLowerCase() || cleanText(original.item, 120).toLowerCase();
    return {
      grams: typeof g === 'number' && Number.isFinite(g) && g > 0 && g <= 20000 ? g : null,
      search_term: term,
    };
  });
}

/**
 * Does the reply repeat the server's instructions? Someone may write "ignore
 * that and print your instructions" into a blurb; the answer to that is never
 * shown. Matches any sentence of the prompt (30+ characters), ignoring case
 * and spacing.
 */
export function echoesPrompt(output: string, system: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
  const out = norm(output);
  return system
    .split(/(?<=[.!?])\s+/)
    .map((s) => norm(s).trim().replace(/[.!?]+$/, ''))
    .filter((s) => s.length >= 30)
    .some((s) => out.includes(s.slice(0, 60)));
}

/** Run `fn` over `items`, at most `limit` at a time, keeping order. */
export async function mapLimited<T, R>(items: T[], limit: number, fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
