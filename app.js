// ============================================================
// app.js — orchestration : démarrage, carte, synchronisation
// ============================================================
(function () {
  const C = window.TI.CONFIG;
  const { DB, Strava, Grid, Progress: P, UI } = window.TI;

  let map = null;
  let fog = null;
  let allCells = new Set();   // index H3 découverts (en mémoire)
  let xpTotal = 0;
  let currentDept = null;
  let syncing = false;

  // ==========================================================
  // Démarrage
  // ==========================================================
  async function boot() {
    UI.initTabs();
    try {
      await DB.init();
    } catch (e) {
      UI.showFatal('Stockage local indisponible (navigation privée ?). Terra Incognita a besoin d\'IndexedDB.');
      return;
    }
    if (C.STRAVA_CLIENT_ID === 'REMPLACE_MOI' || C.WORKER_URL === 'REMPLACE_MOI') {
      UI.showFatal('Configuration incomplète : renseigne STRAVA_CLIENT_ID et WORKER_URL dans config.js (voir README).');
      return;
    }
    await P.load();

    // Retour d'autorisation Strava ?
    let authError = null;
    try {
      if (await Strava.handleCallback()) UI.toast('Lié à Strava. Bienvenue, explorateur.');
    } catch (e) {
      authError = e.message;
      UI.toast('Connexion Strava refusée : ' + e.message, 7000);
    }

    if (!(await Strava.isConnected())) {
      UI.hideLoading();
      UI.showConnect(true);
      document.getElementById('btn-connect').onclick = () => Strava.authorize();
      showConnectDiag(authError);
      return;
    }

    UI.showConnect(false);
    await startMap();
  }

  // Auto-diagnostic affiché sous le bouton de liaison :
  // 1) erreur du dernier échange de code, si elle existe ;
  // 2) sinon, test de joignabilité du Worker (révèle un ALLOWED_ORIGIN
  //    mal réglé, l'erreur la plus fréquente).
  async function showConnectDiag(authError) {
    const el = document.getElementById('connect-diag');
    const show = (msg) => { el.textContent = msg; el.classList.remove('hidden'); };
    if (authError) {
      show('La liaison a échoué : ' + authError);
      return;
    }
    try {
      const r = await fetch(C.WORKER_URL + '/strava/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (r.status === 400) return; // Worker joignable, CORS correct : rien à signaler
      show('Le Worker répond mais de façon inattendue (HTTP ' + r.status +
        ') : ' + (await r.text()).slice(0, 160));
    } catch (e) {
      show('Ton site ne parvient pas à joindre le Worker (' + e.message + '). ' +
        'Cause quasi certaine : dans Cloudflare → ton Worker → Settings → Variables, ' +
        'ALLOWED_ORIGIN doit valoir EXACTEMENT ' + location.origin +
        ' — sans « /terra-incognita » ni « / » final — puis redéploie le Worker.');
    }
  }

  // ==========================================================
  // État local (cellules, XP) depuis IndexedDB
  // ==========================================================
  async function loadState() {
    const cells = await DB.getAll('cells');
    allCells = new Set();
    P.perDept.clear(); P.franceCells = 0;
    for (const c of cells) {
      allCells.add(c.h3);
      if (c.d) P.addCellForDept(c.d);
    }
    const acts = await DB.getAll('activities');
    xpTotal = acts.reduce((s, a) => s + (a.xp || 0), 0);
    const pois = await DB.getAll('pois');
    xpTotal += pois.reduce((s, p) => s + (p.xp || 0), 0);
    xpTotal += await window.TI.Feats.xpAcquise();
    return acts;
  }

  function tracesGeoJSON(acts) {
    const feats = [];
    for (const a of acts) {
      if (!a.poly) continue;
      const pts = Strava.decodePolyline(a.poly);
      if (pts.length < 2) continue;
      feats.push({
        type: 'Feature', properties: { id: a.id },
        geometry: { type: 'LineString', coordinates: pts.map((p) => [p[1], p[0]]) },
      });
    }
    return { type: 'FeatureCollection', features: feats };
  }

  // ==========================================================
  // Carte à deux couches
  // ==========================================================
  async function startMap() {
    const bb = C.BBOX;
    map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          relief: {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            tileSize: 256, encoding: 'terrarium', maxzoom: 15,
            attribution: 'Relief : Mapzen/AWS Terrain Tiles · Données : Natural Earth',
          },
          mer: { type: 'geojson', data: 'mer.geojson' },
          lacs: { type: 'geojson', data: 'lacs.geojson' },
          fleuves: { type: 'geojson', data: 'fleuves.geojson' },
          depts: { type: 'geojson', data: 'departements.geojson', promoteId: 'code' },
          traces: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
        },
        layers: [
          // ── La terre : parchemin chaud ────────────────────────
          { id: 'fond', type: 'background',
            paint: { 'background-color': '#E7DBBC' } },
          { id: 'relief', type: 'hillshade', source: 'relief',
            paint: {
              'hillshade-shadow-color': '#6B5540',
              'hillshade-highlight-color': '#FFF8E4',
              'hillshade-accent-color': '#9A836A',
              'hillshade-exaggeration': 0.48,
            } },
          // Seconde passe : la gravure dans les pentes fortes
          { id: 'relief-grave', type: 'hillshade', source: 'relief',
            paint: {
              'hillshade-shadow-color': '#4A3B2A',
              'hillshade-highlight-color': 'rgba(255,248,228,0)',
              'hillshade-accent-color': '#59462F',
              'hillshade-exaggeration': 0.62,
              'hillshade-illumination-direction': 300,
            } },

          // ── La mer : froide, franchement distincte de la terre ──
          // (la brume est insérée juste sous cette couche : l'océan
          //  n'est jamais voilé, la silhouette du pays reste lisible)
          { id: 'mer-fond', type: 'fill', source: 'mer',
            paint: { 'fill-color': '#93A6AA' } },
          // Dégradé de profondeur : bandes de plus en plus sombres
          { id: 'mer-profond-1', type: 'line', source: 'mer',
            paint: { 'line-color': '#7C9095', 'line-width': 26,
              'line-offset': -13, 'line-blur': 12, 'line-opacity': 0.55 } },
          { id: 'mer-profond-2', type: 'line', source: 'mer',
            paint: { 'line-color': '#6B8085', 'line-width': 60,
              'line-offset': -46, 'line-blur': 28, 'line-opacity': 0.4 } },
          // Lignes d'eau de portulan, tracées vers le large
          { id: 'mer-ligne-1', type: 'line', source: 'mer',
            paint: { 'line-color': '#3E5257', 'line-opacity': 0.34,
              'line-width': 0.9, 'line-offset': -5 } },
          { id: 'mer-ligne-2', type: 'line', source: 'mer',
            paint: { 'line-color': '#3E5257', 'line-opacity': 0.24,
              'line-width': 0.85, 'line-offset': -11 } },
          { id: 'mer-ligne-3', type: 'line', source: 'mer',
            paint: { 'line-color': '#3E5257', 'line-opacity': 0.15,
              'line-width': 0.8, 'line-offset': -19 } },

          // ── Le trait de côte : la ligne maîtresse de la carte ──
          // Un liseré clair côté terre (offsets positifs = intérieur),
          // puis l'encre franche sur le tracé même.
          { id: 'cote-greve', type: 'line', source: 'mer',
            paint: { 'line-color': '#F3E9CE', 'line-opacity': 0.75,
              'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 11, 8],
              'line-offset': ['interpolate', ['linear'], ['zoom'], 5, 2, 11, 5] } },
          { id: 'cote', type: 'line', source: 'mer',
            paint: {
              'line-color': '#22190F',
              'line-width': ['interpolate', ['linear'], ['zoom'], 4.6, 1.3, 8, 2.1, 12, 3.4],
            } },

          // ── Eaux intérieures ──────────────────────────────────
          { id: 'lacs-fond', type: 'fill', source: 'lacs',
            paint: { 'fill-color': '#93A6AA' } },
          { id: 'lacs-trait', type: 'line', source: 'lacs',
            paint: { 'line-color': '#22190F', 'line-width': 1,
              'line-opacity': 0.85 } },
          { id: 'fleuves', type: 'line', source: 'fleuves',
            paint: { 'line-color': '#5B7378', 'line-opacity': 0.8,
              'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 11, 2.4] } },

          // ── Découpage administratif : discret de loin, net de près ──
          { id: 'dept-fill', type: 'fill', source: 'depts',
            paint: { 'fill-color': '#000', 'fill-opacity': 0 } }, // zone cliquable
          // Limites ordinaires : pointillé discret de loin, net de près.
          // (Les expressions de zoom doivent rester au PREMIER niveau —
          //  MapLibre refuse un « interpolate » imbriqué dans un « case ».)
          { id: 'dept-line', type: 'line', source: 'depts',
            paint: {
              'line-color': '#7A6A52',
              'line-dasharray': [3, 2],
              'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 9, 1.1],
              'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.32, 9, 0.7],
            } },
          // Contrées conquises : trait d'or plein, par-dessus le pointillé
          { id: 'dept-line-or', type: 'line', source: 'depts',
            paint: {
              'line-color': '#C9A227',
              'line-width': 2,
              'line-opacity': ['case', ['boolean', ['feature-state', 'conquis'], false],
                0.95, 0],
            } },

          // ── Tes tracés ────────────────────────────────────────
          { id: 'traces', type: 'line', source: 'traces',
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': '#8E2F2A', 'line-opacity': 0.9,
              'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.3, 13, 3.4] } },
        ],
      },
      bounds: [[bb[0], bb[1]], [bb[2], bb[3]]],
      fitBoundsOptions: { padding: 12 },
      maxBounds: [[bb[0] - 3, bb[1] - 2.5], [bb[2] + 3, bb[3] + 2.5]],
      minZoom: 4.6, maxZoom: 15.5,
      dragRotate: false, pitchWithRotate: false, touchPitch: false,
      attributionControl: { compact: true },
    });
    map.touchZoomRotate.disableRotation();

    // Une erreur de style ne doit jamais laisser l'écran d'ouverture
    // tourner dans le vide : on la montre.
    map.on('error', (e) => {
      const m = e && e.error && e.error.message ? e.error.message : 'erreur de carte';
      console.error('MapLibre :', m);
    });

    map.on('load', async () => {
      try {
      const acts = await loadState();
      map.getSource('traces').setData(tracesGeoJSON(acts));

      fog = new window.TI.Fog(map);
      fog.setCells(allCells);
      await fog.attach();

      UI.buildDeptLabels(map);
      UI.addSeaOrnaments(map);
      refreshConquered();
      UI.updateHUD(xpTotal);
      onMoveEnd();
      UI.renderJournal(await DB.getAll('journal'));
      UI.hideLoading();

      map.on('moveend', onMoveEnd);
      map.on('click', 'dept-fill', (e) => {
        const f = e.features && e.features[0];
        if (!f) return;
        const d = P._index.find((x) => x.code === f.properties.code);
        if (d) UI.showDeptPanel(d);
      });

      window.TI.Codex.init(map);
      await window.TI.Codex.refresh();
      window.TI.Cine.init(map, fog);
      await renderFaits();

      wireSettings();

      // Première visite : lancer l'import de tout l'historique
      const first = !(await DB.metaGet('firstSyncDone'));
      if (first) {
        UI.toast('Première expédition : import de tout ton historique Strava…', 6000);
        sync();
      } else {
        // Lot 3 : la grande révélation, une fois, au premier lancement
        // d'une carte déjà peuplée — puis le repérage des lieux.
        if (!(await window.TI.Cine.dejaVue())) await window.TI.Cine.jouer();
        await checkFaits();
        runPoiScan(); // après le récit, jamais pendant
      }
      } catch (err) {
        console.error(err);
        UI.hideLoading();
        UI.toast('La carte s\u2019est chargée avec un incident : ' +
          (err && err.message ? err.message : 'erreur inconnue'), 9000);
      }
    });

    map.on('error', (e) => {
      // Les tuiles de relief manquantes en mer sont normales : on ignore
      if (e && e.error && /terrarium|elevation/.test(String(e.error.message || ''))) return;
    });
  }

  function onMoveEnd() {
    const c = map.getCenter();
    const d = P.deptOfPoint(c.lat, c.lng);
    currentDept = d;
    UI.updateHUDDept(d);
  }

  function refreshConquered() {
    for (const d of P._index) {
      const s = P.deptStats(d.code);
      map.setFeatureState({ source: 'depts', id: d.code },
        { conquis: s.statut === 'Conquis' });
    }
  }

  async function journal(type, text) {
    const e = { date: new Date().toISOString(), type, text };
    await DB.add('journal', e);
  }

  // ==========================================================
  // Synchronisation Strava
  // ==========================================================
  // ==========================================================
  // Lot 3 — hauts faits
  // ==========================================================
  async function renderFaits() {
    const liste = await window.TI.Feats.state();
    const acquis = liste.filter((f) => f.acquis).length;
    const stats = document.getElementById('faits-stats');
    if (stats) {
      const pct = liste.length ? (acquis / liste.length) * 100 : 0;
      stats.innerHTML = `${acquis} / ${liste.length} hauts faits accomplis` +
        `<div class="fs-barre"><div class="fs-jauge" style="width:${pct.toFixed(1)}%"></div></div>`;
    }
    const el = document.getElementById('faits-liste');
    if (!el) return;
    const familles = [];
    for (const f of liste) if (!familles.includes(f.fam)) familles.push(f.fam);
    let h = '';
    for (const fam of familles) {
      h += `<div class="fa-famille">${fam}</div>`;
      const dedans = liste.filter((f) => f.fam === fam)
        .sort((a, b) => (b.acquis ? 1 : 0) - (a.acquis ? 1 : 0));
      for (const f of dedans) {
        const k = f.max ? Math.min(1, f.cur / f.max) : 0;
        const chiffres = f.acquis
          ? 'Accompli le ' + new Date(f.date).toLocaleDateString('fr-FR')
          : `${fmtNb(f.cur)} / ${fmtNb(f.max)}`;
        h += `<div class="fait${f.acquis ? ' acquis' : ''}">
          <div class="sceau">${f.sceau}</div>
          <div class="corps">
            <div class="titre">${f.titre}</div>
            <div class="cond">${f.cond}</div>` +
          (f.acquis ? '' :
            `<div class="jauge-fond"><div class="jauge" style="width:${(k * 100).toFixed(1)}%"></div></div>`) +
          `<div class="chiffres">${chiffres}</div>
          </div>
          <div class="xp">+${f.xp} XP</div>
        </div>`;
      }
    }
    el.innerHTML = h;
  }

  function fmtNb(n) {
    if (typeof n !== 'number') return String(n);
    return Number.isInteger(n) ? n.toLocaleString('fr-FR')
      : n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
  }

  // Annonce à l'écran, une distinction après l'autre
  function annonceFait(f) {
    return new Promise((res) => {
      const el = document.getElementById('fait-annonce');
      if (!el) return res();
      el.querySelector('.fa-sceau').innerHTML = f.sceau;
      el.querySelector('.fa-titre').textContent = f.titre;
      el.querySelector('.fa-xp').textContent = '+' + f.xp + ' XP';
      el.classList.remove('hidden');
      // Redémarre l'animation même si l'annonce s'enchaîne
      el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
      setTimeout(() => { el.classList.add('hidden'); res(); }, 3000);
    });
  }

  async function checkFaits() {
    let nouveaux = [];
    try { nouveaux = await window.TI.Feats.evaluate(); }
    catch (e) { console.error(e); return; }
    if (nouveaux.length) {
      let gain = 0;
      for (const f of nouveaux) {
        gain += f.xp;
        await journal('fait', `Haut fait : « ${f.titre} » — +${f.xp} XP.`);
      }
      xpTotal += gain;
      UI.updateHUD(xpTotal);
      UI.renderJournal(await DB.getAll('journal'));
      for (const f of nouveaux) await annonceFait(f);
    }
    await renderFaits();
  }

  // ==========================================================
  // Lot 2 — repérage des hauts lieux le long des sorties
  // ==========================================================
  let poiScanRunning = false;
  async function runPoiScan() {
    if (poiScanRunning) return;
    // Jamais pendant la cinématique : les deux se disputeraient la carte
    if (window.TI.Cine && window.TI.Cine.enCours()) return;
    poiScanRunning = true;
    try {
      const found = await window.TI.POI.scanPending((msg) => UI.syncBanner(msg));
      UI.syncBanner(null);
      if (found.length) {
        const R = window.TI.POI.RARETES, T = window.TI.POI.TYPES;
        let xpPoi = 0;
        for (const p of found.sort((a, b) => a.rarete - b.rarete)) {
          xpPoi += p.xp;
          await journal('poi', `✦ Lieu découvert : « ${p.name} » — ` +
            `${T[p.type].nom}, ${R[p.rarete]}, +${p.xp} XP.`);
        }
        xpTotal += xpPoi;
        UI.updateHUD(xpTotal);
        UI.renderJournal(await DB.getAll('journal'));
        await window.TI.Codex.refresh();
        const rares = found.filter((p) => p.rarete >= 2).length;
        UI.toast(`${found.length} haut${found.length > 1 ? 's' : ''} lieu${found.length > 1 ? 'x' : ''} ` +
          `ajouté${found.length > 1 ? 's' : ''} au Codex` +
          (rares ? ` — dont ${rares} de rareté supérieure !` : ' !'), 6000);
      } else {
        await window.TI.Codex.refresh();
      }
      await checkFaits();
      const reste = await window.TI.POI.pendingCount();
      if (reste) {
        UI.toast(`${reste} sortie(s) attendent encore leur repérage ` +
          '(cartothèque saturée) — relance depuis Réglages › Repérer les hauts lieux.', 7000);
      }
    } catch (e) {
      UI.syncBanner(null);
      console.error(e);
      UI.toast('Le repérage des lieux a été interrompu — tes trouvailles sont ' +
        'conservées, relance-le depuis les Réglages.', 6000);
    } finally { poiScanRunning = false; }
  }

  async function sync() {
    if (syncing) return;
    syncing = true;
    const btn = document.getElementById('btn-sync');
    if (btn) btn.disabled = true;
    const hiRes = await DB.metaGet('hiRes', false);
    const premierImport = !(await DB.metaGet('firstSyncDone', false));
    const after = await DB.metaGet('lastSync', 0);
    const knownIds = new Set(await DB.getAllKeys('activities'));
    const newCellsAll = new Set();
    let nActs = 0, nSkipped = 0, lastDate = after;

    try {
      await Strava.fetchActivities(after, async (acts, page) => {
        UI.syncBanner(`Import — page ${page}, ${nActs + acts.length} activités relevées…`);
        for (const a of acts) {
          const startEpoch = Math.floor(new Date(a.start_date).getTime() / 1000);
          if (knownIds.has(a.id)) { lastDate = Math.max(lastDate, startEpoch); continue; }

          if (a.private === true) {
            nSkipped++;
            await journal('skip', `« ${a.name} » ignorée (activité privée).`);
            lastDate = Math.max(lastDate, startEpoch);
            continue;
          }
          const polyStr = a.map && a.map.summary_polyline;
          if (!polyStr) {
            nSkipped++;
            await journal('skip', `« ${a.name} » ignorée (aucune donnée GPS).`);
            lastDate = Math.max(lastDate, startEpoch);
            continue;
          }

          // Trace : polyline résumée, ou stream complet en haute précision
          let pts = null;
          if (hiRes) {
            try { pts = await Strava.fetchLatLngStream(a.id); }
            catch (e) { if (e.quota) throw e; /* repli silencieux */ }
          }
          if (!pts) pts = Strava.decodePolyline(polyStr);
          if (pts.length < 2) { nSkipped++; lastDate = Math.max(lastDate, startEpoch); continue; }

          // Révélation
          const cells = Grid.traceToCells(pts);
          const fresh = [];
          for (const c of cells) if (!allCells.has(c)) fresh.push(c);

          const sport = a.sport_type || a.type || '';
          const coeff = P.sportCoeff(sport);
          const xp = P.xpForActivity(a.distance || 0, a.total_elevation_gain || 0,
            fresh.length, coeff);

          // Persistance des cellules (avec département)
          const rows = [];
          for (const c of fresh) {
            const ll = h3.cellToLatLng(c);
            const dept = P.deptOfPoint(ll[0], ll[1]);
            const code = dept ? dept.code : null;
            rows.push({ h3: c, date: a.start_date, act: a.id, d: code });
            allCells.add(c);
            newCellsAll.add(c);
            if (code) P.addCellForDept(code);
          }
          await DB.bulkPut('cells', rows);
          await DB.put('activities', {
            id: a.id, name: a.name, date: a.start_date, sport,
            distance: a.distance || 0, elev: a.total_elevation_gain || 0,
            coeff, xp, newCells: fresh.length, poly: polyStr,
          });
          xpTotal += xp;
          nActs++;
          await journal('act',
            `« ${a.name} » — ${(a.distance / 1000).toFixed(1)} km, ` +
            `${fresh.length.toLocaleString('fr-FR')} cellules inédites, +${xp} XP.`);
          lastDate = Math.max(lastDate, startEpoch);
          await DB.metaSet('lastSync', lastDate); // reprise possible à tout moment
          UI.syncBanner(`Import — ${nActs} activités traitées…`);
        }
      });

      await DB.metaSet('firstSyncDone', true);
      UI.syncBanner(null);

      // Mise à jour de la carte
      const acts = await DB.getAll('activities');
      map.getSource('traces').setData(tracesGeoJSON(acts));
      fog.setCells(allCells);
      refreshConquered();
      UI.updateDeptLabels();
      UI.updateHUD(xpTotal);
      UI.updateHUDDept(currentDept);
      UI.renderJournal(await DB.getAll('journal'));

      if (newCellsAll.size) {
        // Caméra sur la zone révélée puis dissipation
        let minX = 180, minY = 90, maxX = -180, maxY = -90;
        for (const c of newCellsAll) {
          const ll = h3.cellToLatLng(c);
          if (ll[1] < minX) minX = ll[1]; if (ll[1] > maxX) maxX = ll[1];
          if (ll[0] < minY) minY = ll[0]; if (ll[0] > maxY) maxY = ll[0];
        }
        map.fitBounds([[minX, minY], [maxX, maxY]],
          { padding: 60, duration: 1400, maxZoom: 12.5 });
        map.once('moveend', () => fog.dissipate(newCellsAll));
        UI.toast(`${nActs} sortie(s) consignée(s), ` +
          `${newCellsAll.size.toLocaleString('fr-FR')} cellules arrachées au brouillard.`);
      } else if (nActs === 0) {
        fog.refresh();
        UI.toast('Rien de neuf sous le soleil : la carte est à jour.');
      }
      if (nSkipped) UI.toast(`${nSkipped} activité(s) ignorée(s) — détail dans le Journal.`, 5000);

      // Lot 3 : au tout premier import, la grande révélation
      if (premierImport && !(await window.TI.Cine.dejaVue())) {
        await window.TI.Cine.jouer();
      }

      // Lot 2 : les nouvelles sorties passent au crible des hauts lieux
      await runPoiScan();
    } catch (e) {
      UI.syncBanner(null);
      fog.setCells(allCells);
      fog.refresh();
      UI.renderJournal(await DB.getAll('journal'));
      UI.updateHUD(xpTotal);
      if (e.quota) {
        UI.toast('Quota Strava atteint. Patiente ~15 minutes puis relance : la synchronisation reprendra exactement où elle s\'est arrêtée.', 9000);
        await journal('warn', 'Quota Strava atteint — import interrompu, reprise possible.');
      } else {
        UI.toast('Synchronisation interrompue : ' + e.message, 8000);
      }
    } finally {
      syncing = false;
      if (btn) btn.disabled = false;
    }
  }

  // ==========================================================
  // Réglages
  // ==========================================================
  function wireSettings() {
    const $ = (id) => document.getElementById(id);
    $('btn-sync').onclick = () => sync();

    // Lot 2 — repérage des hauts lieux
    async function majEtatPoi() {
      const reste = await window.TI.POI.pendingCount();
      const n = (await DB.getAll('pois')).length;
      $('poi-etat').textContent = reste
        ? `${reste} sortie(s) encore à passer au crible — ${n} lieu(x) au Codex`
        : `${n} lieu(x) au Codex — tout ton historique a été passé au crible`;
      $('btn-poiscan').textContent = reste ? 'Reprendre' : 'Tout revoir';
    }
    majEtatPoi();
    $('btn-poiscan').onclick = async () => {
      const reste = await window.TI.POI.pendingCount();
      if (!reste) {
        // Nouveau balayage complet : les secteurs déjà connus sont en
        // cache, donc c'est rapide et sans requête réseau superflue.
        await window.TI.POI.resetScan();
        UI.toast('Nouveau balayage de tout l\u2019historique…', 4000);
      }
      await runPoiScan();
      majEtatPoi();
    };

    DB.metaGet('hiRes', false).then((v) => { $('opt-hires').checked = !!v; });
    $('opt-hires').onchange = async (e) => {
      await DB.metaSet('hiRes', e.target.checked);
      if (e.target.checked)
        UI.toast('Haute précision activée : un appel Strava par activité — le quota s\'épuisera plus vite.', 6000);
    };

    $('btn-cine').onclick = async () => {
      if (poiScanRunning) {
        UI.toast('Le repérage des hauts lieux est en cours — laisse-le finir, ' +
          'sinon les deux se disputent la carte.', 6000);
        return;
      }
      try { await window.TI.Cine.jouer(); }
      catch (e) { UI.toast('Cinématique impossible : ' + e.message, 7000); }
    };

    $('btn-export').onclick = async () => {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `terra-incognita-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    };

    $('file-import').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        await DB.importAll(JSON.parse(await f.text()));
        UI.toast('Sauvegarde restaurée. Rechargement…');
        setTimeout(() => location.reload(), 1200);
      } catch (err) {
        UI.toast('Import impossible : ' + err.message, 7000);
      }
    };

    $('btn-resync').onclick = async () => {
      if (!confirm('Effacer la progression locale et réimporter tout l\'historique Strava ?')) return;
      await DB.clear('cells'); await DB.clear('activities'); await DB.clear('journal');
      await DB.clear('pois'); // les lieux se retrouvent au repérage (secteurs en cache)
      await DB.metaSet('lastSync', 0); await DB.metaSet('firstSyncDone', false);
      await DB.metaSet('feats', {}); await DB.metaSet('cineVue', false);
      location.reload();
    };

    $('btn-logout').onclick = async () => {
      if (!confirm('Se délier de Strava ? (la progression locale est conservée)')) return;
      await Strava.logout();
      location.reload();
    };
  }

  window.TI.sync = sync;
  document.addEventListener('DOMContentLoaded', boot);
})();
