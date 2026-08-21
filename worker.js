// ============================================================
// TERRA INCOGNITA — Worker Cloudflare (2 routes, aucune autre)
//   POST /strava/token  : échange code OAuth / rafraîchissement
//   POST /lore          : relais vers l'API Claude (Lot 2)
//   POST /sauvegarde    : sauvegarde automatique du royaume (KV)
// Variables d'environnement attendues (voir README) :
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET (secret),
//   ATHLETE_ID, ALLOWED_ORIGIN, ANTHROPIC_API_KEY (secret)
// Liaison KV attendue : SAUVEGARDE -> espace TERRA_SAUVEGARDE
// Les secrets ne transitent JAMAIS côté navigateur.
// ============================================================

function cors(env, origin) {
  const allowed = env.ALLOWED_ORIGIN || '';
  const ok = origin === allowed;
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers });
}

// Le porteur du jeton doit être un athlète autorisé.
// Renvoie l'identifiant d'athlète, ou null si l'accès est refusé.
async function athleteAutorise(token, env) {
  if (!token) return null;
  const who = await fetch('https://www.strava.com/api/v3/athlete', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!who.ok) return null;
  const a = await who.json();
  if (!a || !a.id) return null;
  // Liste d'amis explicite : ATHLETE_ID peut contenir plusieurs
  // identifiants séparés par des virgules.
  const permis = String(env.ATHLETE_ID || '')
    .split(',').map((x) => x.trim()).filter(Boolean);
  if (permis.length && !permis.includes(String(a.id))) return null;
  return String(a.id);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const headers = cors(env, request.headers.get('Origin') || '');

    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers });
    if (request.method !== 'POST')
      return json({
        error: 'Méthode non autorisée',
        origine_autorisee: env.ALLOWED_ORIGIN || '(ALLOWED_ORIGIN absente de la version déployée)',
      }, 405, headers);

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
    // ------------------------------------------------------ //
    // Sauvegarde du royaume : { token, action:'lire'|'ecrire', data }
    // Une seule clé par athlète, écrasée à chaque fois : dernier
    // enregistrement gagnant, comme une sauvegarde de jeu.
    if (url.pathname === '/sauvegarde') {
      if (!env.SAUVEGARDE)
        return json({ error: 'Stockage non relié (liaison KV « SAUVEGARDE » absente)' },
          501, headers);

      let body;
      try { body = await request.json(); }
      catch (e) { return json({ error: 'JSON invalide' }, 400, headers); }
      const { token, action, data } = body || {};

      const id = await athleteAutorise(token, env);
      if (!id) return json({ error: 'Athlète non autorisé' }, 403, headers);
      const cle = 'royaume_' + id;

      if (action === 'lire') {
        const brut = await env.SAUVEGARDE.get(cle);
        if (!brut) return json({ vide: true }, 200, headers);
        let meta = null;
        try { meta = JSON.parse(await env.SAUVEGARDE.get(cle + '_meta') || 'null'); }
        catch (e) { /* méta facultative */ }
        return json({ data: brut, meta }, 200, headers);
      }

      if (action === 'ecrire') {
        if (typeof data !== 'string' || !data)
          return json({ error: 'data requis' }, 400, headers);
        if (data.length > 20 * 1024 * 1024)
          return json({ error: 'Sauvegarde trop volumineuse' }, 413, headers);
        const meta = { ts: Date.now(), octets: data.length };
        await env.SAUVEGARDE.put(cle, data);
        await env.SAUVEGARDE.put(cle + '_meta', JSON.stringify(meta));
        return json({ ok: true, meta }, 200, headers);
      }

      if (action === 'etat') {
        let meta = null;
        try { meta = JSON.parse(await env.SAUVEGARDE.get(cle + '_meta') || 'null'); }
        catch (e) { /* méta facultative */ }
        return json({ meta }, 200, headers);
      }

      return json({ error: "action inconnue (lire, ecrire ou etat)" }, 400, headers);
    }

    if (url.pathname === '/lore') {
      let body;
      try { body = await request.json(); }
      catch (e) { return json({ error: 'JSON invalide' }, 400, headers); }
      const { token, name, type, material } = body || {};
      if (!token || !name || !material)
        return json({ error: 'token, name et material requis' }, 400, headers);

      if (!(await athleteAutorise(token, env)))
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
          'Content-Type': 'application/json; charset=utf-8',
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
