// Runs one edge function, unchanged, for the end-to-end test (run.sh).
//
// Two things differ from Supabase, both outside the function's own code:
//   * Deno.serve listens on FN_PORT, so all seven can run at once.
//   * Calls to Anthropic, USDA and Expo's push service go to the gateway's
//     stand-ins (FAKES_URL/<host>/...), so the test can count them and nothing
//     leaves the machine or costs money.
const port = Number(Deno.env.get('FN_PORT'));
const fakes = Deno.env.get('FAKES_URL')!;
const OUTSIDE = ['https://api.anthropic.com', 'https://api.nal.usda.gov', 'https://exp.host'];

const realFetch = globalThis.fetch;
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const host = OUTSIDE.find((h) => url.startsWith(h));
  if (host) {
    const target = `${fakes}/${new URL(host).hostname}${url.slice(host.length)}`;
    return input instanceof Request ? realFetch(new Request(target, input), init) : realFetch(target, init);
  }
  return realFetch(input, init);
}) as typeof fetch;

const realServe = Deno.serve;
// deno-lint-ignore no-explicit-any
(Deno as any).serve = (a: any, b?: any) =>
  typeof a === 'function'
    ? realServe({ port, hostname: '127.0.0.1', onListen() {} }, a)
    : realServe({ ...a, port, hostname: '127.0.0.1', onListen() {} }, b);

await import(Deno.env.get('FN_MAIN')!);
