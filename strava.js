// ============================================================
// strava.js — OAuth (via Worker), synchronisation paginée,
// gestion du quota, décodage des polylines
// ============================================================
(function () {
  const C = window.TI.CONFIG;
  const DB = window.TI.DB;
  const API = 'https://www.strava.com/api/v3';

  class QuotaError extends Error {
    constructor() { super('Quota Strava atteint'); this.quota = true; }
  }

  function redirectUri() {
    return location.origin + location.pathname;
  }

  const Strava = {
    QuotaError,

    // --- OAuth ------------------------------------------------
    authorize() {
      const u = new URL('https://www.strava.com/oauth/authorize');
      u.searchParams.set('client_id', C.STRAVA_CLIENT_ID);
      u.searchParams.set('redirect_uri', redirectUri());
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('approval_prompt', 'auto');
      u.searchParams.set('scope', 'activity:read_all');
      location.href = u.toString();
    },

    async handleCallback() {
      const p = new URLSearchParams(location.search);
      const code = p.get('code');
      if (!code) return false;
      history.replaceState(null, '', location.pathname); // nettoie l'URL
      const r = await fetch(C.WORKER_URL + '/strava/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (!r.ok) {
        const t = await r.text();
        throw new Error('Échange du code Strava refusé : ' + t);
      }
      const j = await r.json();
      await this._storeTokens(j);
      if (j.athlete) await DB.metaSet('athlete', {
        id: j.athlete.id,
        name: [j.athlete.firstname, j.athlete.lastname].filter(Boolean).join(' '),
      });
      return true;
    },

    async _storeTokens(j) {
      await DB.metaSet('access_token', j.access_token);
      await DB.metaSet('refresh_token', j.refresh_token);
      await DB.metaSet('expires_at', j.expires_at);
    },

    async isConnected() {
      return !!(await DB.metaGet('refresh_token'));
    },

    async logout() {
      for (const k of ['access_token', 'refresh_token', 'expires_at', 'athlete'])
        await DB.put('meta', { key: k, value: null });
    },

    async getToken() {
      const exp = await DB.metaGet('expires_at', 0);
      let tok = await DB.metaGet('access_token');
      if (tok && exp && (exp - 60) * 1000 > Date.now()) return tok;
      const refresh = await DB.metaGet('refresh_token');
      if (!refresh) throw new Error('Non connecté à Strava');
      const r = await fetch(C.WORKER_URL + '/strava/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refresh }),
      });
      if (!r.ok) throw new Error('Rafraîchissement du token Strava impossible');
      const j = await r.json();
      await this._storeTokens(j);
      return j.access_token;
    },

    // --- Appels API avec quota -------------------------------
    async api(path, params) {
      const tok = await this.getToken();
      const u = new URL(API + path);
      for (const k in (params || {})) u.searchParams.set(k, params[k]);
      const r = await fetch(u, { headers: { Authorization: 'Bearer ' + tok } });
      if (r.status === 429) throw new QuotaError();
      if (r.status === 401) throw new Error('Token Strava expiré ou révoqué');
      if (!r.ok) throw new Error('Strava a répondu ' + r.status);
      return r.json();
    },

    // Itère les activités par pages de 200, de la plus ancienne
    // à la plus récente parmi celles postérieures à `after` (epoch s).
    // onPage(activités, numéroPage) est appelé pour chaque page.
    async fetchActivities(after, onPage) {
      let page = 1;
      for (;;) {
        const acts = await this.api('/athlete/activities', {
          per_page: 200, page, after: after || 0,
        });
        if (!acts.length) break;
        await onPage(acts, page);
        if (acts.length < 200) break;
        page += 1;
        await new Promise((r) => setTimeout(r, 1500)); // temporisation quota
      }
    },

    // Option haute précision : stream latlng complet (1 appel / activité)
    async fetchLatLngStream(activityId) {
      const j = await this.api(`/activities/${activityId}/streams`, {
        keys: 'latlng', key_by_type: 'true',
      });
      return (j.latlng && j.latlng.data) || null; // [[lat,lng],...]
    },
  };

  // --- Décodage polyline (format Google encodé) --------------
  Strava.decodePolyline = function (str) {
    let idx = 0, lat = 0, lng = 0;
    const pts = [];
    while (idx < str.length) {
      let b, shift = 0, result = 0;
      do { b = str.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; }
      while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = str.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; }
      while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      pts.push([lat * 1e-5, lng * 1e-5]);
    }
    return pts;
  };

  window.TI.Strava = Strava;
})();
