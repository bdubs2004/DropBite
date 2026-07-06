// Supabase Edge Function: format-recipe
// Calls the Anthropic API server-side so the key never ships in the app.
//
// Deploy:   supabase functions deploy format-recipe
// Secret:   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//
// Request:  POST { blurb: string }
// Response: { is_recipe, title, ingredients: [{item,quantity,unit}], steps: [], cook_time_minutes }

// Keep model + prompt aligned with src/config.ts AI_CONFIG.
const MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 1024;
const SYSTEM_PROMPT = [
  'You turn a casual home-cook blurb into a structured recipe.',
  'Return STRICT JSON only, no prose, matching:',
  '{"is_recipe": boolean, "title": string, "ingredients": [{"item": string, "quantity": string, "unit": string}], "steps": [string], "cook_time_minutes": number | null}',
  'If the blurb clearly is not a cooking description (restaurant meal, "just cereal lol"), set is_recipe=false and leave the rest minimal.',
  "Never invent ingredients that aren't implied. Quantities may be empty strings when unknown.",
].join(' ');

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  try {
    const { blurb } = await req.json();
    if (!blurb || typeof blurb !== 'string' || blurb.length > 4000) {
      return json({ error: 'blurb required' }, 400);
    }

    const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Blurb: ${blurb}` }],
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ error: 'anthropic_error', detail }, 502);
    }

    const data = await resp.json();
    const text: string = data?.content?.[0]?.text ?? '';

    // Parse defensively — never let a bad AI response block the post.
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch {
          parsed = null;
        }
      }
    }
    if (!parsed || typeof parsed !== 'object') {
      return json({ error: 'unparseable' }, 502);
    }
    return json(parsed, 200);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}
