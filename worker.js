// ============================================================
// TERRA INCOGNITA — Worker Cloudflare (2 routes, aucune autre)
//   POST /strava/token  : échange code OAuth / rafraîchissement
//   POST /lore          : relais vers l'API Claude (Lot 2)
// Variables d'environnement attendues (voir README) :
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET (secret),
//   ATHLETE_ID, ALLOWED_ORIGIN, ANTHROPIC_API_KEY (secret)
// Les secrets ne transitent JAMAIS côté navigateur.
// ============================================================

function cors(env, origin) {
  const allowed = env.ALLOWED_ORIGIN || '';
  const ok = origin === allowed;
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = cors(env, request.headers.get('Origin') || '');

    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers });
    if (request.method !== 'POST')
      return json({ error: 'Méthode non autorisée' }, 405, headers);

    // ------------------------------------------------------ //
    if (url.pathname === '/strava/token') {
      let body;
      try { body = await request.json(); }
      catch (e) { return json({ error: 'JSON invalide' }, 400, headers); }

      const params = new URLSearchParams({
        client_id: env.STRAVA_CLIENT_ID,
        client_secret: env.STRAVA_CLIENT_SECRET,
      });
      if (body.code) {
        params.set('code', body.code);
        params.set('grant_type', 'authorization_code');
      } else if (body.refresh_token) {
        params.set('refresh_token', body.refresh_token);
        params.set('grant_type', 'refresh_token');
      } else {
        return json({ error: 'code ou refresh_token requis' }, 400, headers);
      }

      const r = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST', body: params,
      });
      const j = await r.json();
      if (!r.ok) return json(j, r.status, headers);

      // Verrouillage : ce Worker ne sert qu'UN athlète
      if (body.code && env.ATHLETE_ID &&
          String(j.athlete && j.athlete.id) !== String(env.ATHLETE_ID)) {
        return json({ error: 'Ce compte Strava n\'est pas autorisé sur cette instance.' },
          403, headers);
      }
      return json(j, 200, headers);
    }

    // ------------------------------------------------------ //
    if (url.pathname === '/lore') {
      let body;
      try { body = await request.json(); }
      catch (e) { return json({ error: 'JSON invalide' }, 400, headers); }
      const { token, name, type, material } = body || {};
      if (!token || !name || !material)
        return json({ error: 'token, name et material requis' }, 400, headers);

      // Le porteur du token doit être l'athlète autorisé
      const who = await fetch('https://www.strava.com/api/v3/athlete', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!who.ok) return json({ error: 'Token Strava invalide' }, 401, headers);
      const athlete = await who.json();
      if (env.ATHLETE_ID && String(athlete.id) !== String(env.ATHLETE_ID))
        return json({ error: 'Athlète non autorisé' }, 403, headers);

      const prompt =
        `Tu es un chroniqueur médiéval. À partir du matériau ci-dessous, rédige en ` +
        `français la notice du lieu « ${name} » (type : ${type || 'lieu'}) pour un ` +
        `codex d'explorateur.\n` +
        `Règles strictes : exactement 3 phrases au ton de chronique ancienne, ` +
        `puis une ligne commençant par « Fait d'armes : » avec un détail marquant. ` +
        `N'invente AUCUN fait : tout doit provenir du matériau. Si le matériau est ` +
        `pauvre, reste sobre et bref.\n\nMATÉRIAU :\n` +
        String(material).slice(0, 6000);

      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        return json({ error: 'API Claude indisponible', detail: t.slice(0, 300) },
          502, headers);
      }
      const j = await r.json();
      const text = (j.content || [])
        .filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      return json({ lore: text }, 200, headers);
    }

    return json({ error: 'Route inconnue' }, 404, headers);
  },
};
