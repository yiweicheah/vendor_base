// Vercel serverless endpoint pinged by an external uptime monitor (e.g.
// UptimeRobot, every 5 min) to prevent Supabase free-tier auto-pause and
// keep Postgres / PostgREST connection caches warm. A no-op SELECT on a
// tiny table is enough — the goal is just to exercise the project so it
// doesn't go cold.
//
// Gated by KEEPALIVE_TOKEN. Fails closed: if the env var is unset, every
// request is rejected — so a misconfigured deploy can't silently leave the
// endpoint open to anonymous traffic.

export default async function handler(req, res) {
  const expected = process.env.KEEPALIVE_TOKEN;
  const provided = req.query?.token;
  if (!expected || provided !== expected) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    return res.status(500).json({ ok: false, error: 'missing supabase env vars' });
  }

  const start = Date.now();
  try {
    const r = await fetch(`${url}/rest/v1/user?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const ok = r.ok;
    return res.status(ok ? 200 : 502).json({
      ok,
      status: r.status,
      ms: Date.now() - start,
    });
  } catch (err) {
    return res.status(502).json({ ok: false, error: String(err), ms: Date.now() - start });
  }
}
