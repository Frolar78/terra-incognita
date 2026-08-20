// ============================================================
// cinematic.js — la grande révélation (Lot 3)
// Rejeu chronologique de toute ton histoire : la carte part
// entièrement sous la brume, puis chaque sortie s'écrit à l'encre
// et déchire le voile derrière elle. Tout est PRÉCALCULÉ avant le
// lancement (cellules groupées par sortie, tracés décodés) : la
// lecture ne fait plus que dessiner, sans jamais recalculer.
// Aucun appel réseau — les données sont déjà en base.
// ============================================================
(function () {
  const DB = window.TI.DB;
  const DUREE_CIBLE = 150000;  // ~2 min 30 de spectacle
  const PAS_MIN = 45, PAS_MAX = 700;

  let map = null, fog = null;
  let running = false, annule = false;

  const $ = (id) => document.getElementById(id);
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

  // ----------------------------------------------------------
  // Précalcul : une frise d'étapes chronologiques
  async function preparer() {
    const [acts, cells, pois] = await Promise.all([
      DB.getAll('activities'), DB.getAll('cells'), DB.getAll('pois'),
    ]);
    if (!acts.length) return null;

    // Cellules groupées par sortie
    const parAct = new Map();
    for (const c of cells) {
      if (!parAct.has(c.act)) parAct.set(c.act, []);
      parAct.get(c.act).push(c.h3);
    }
    // Lieux groupés par sortie de découverte
    const poiParAct = new Map();
    for (const p of pois) {
      if (p.act == null) continue;
      if (!poiParAct.has(p.act)) poiParAct.set(p.act, []);
      poiParAct.get(p.act).push(p);
    }

    const Strava = window.TI.Strava;
    const etapes = acts
      .filter((a) => a.date)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map((a) => {
        let pts = [];
        try { pts = a.poly ? Strava.decodePolyline(a.poly) : []; } catch (e) { pts = []; }
        let lat = 0, lng = 0;
        if (pts.length) {
          for (const p of pts) { lat += p[0]; lng += p[1]; }
          lat /= pts.length; lng /= pts.length;
        }
        return {
          id: a.id, nom: a.name, date: a.date,
          cells: parAct.get(a.id) || [],
          pois: poiParAct.get(a.id) || [],
          ligne: pts.map((p) => [p[1], p[0]]), // GeoJSON : lng, lat
          centre: pts.length ? [lng, lat] : null,
        };
      });

    const totalCells = cells.length;
    return { etapes, totalCells };
  }

  // ----------------------------------------------------------
  function moisFr(iso) {
    return new Date(iso).toLocaleDateString('fr-FR',
      { month: 'long', year: 'numeric' });
  }

  function overlay(afficher) {
    const el = $('cine-overlay');
    if (el) el.classList.toggle('hidden', !afficher);
  }

  // ----------------------------------------------------------
  async function jouer() {
    if (running) return;
    running = true; annule = false;

    const btnPasser = $('cine-passer');
    const onPasser = () => { annule = true; };
    if (btnPasser) btnPasser.addEventListener('click', onPasser);

    // Mémoriser l'état pour tout restaurer à la fin
    const vueAvant = { center: map.getCenter(), zoom: map.getZoom() };
    const cellsAvant = await DB.getAll('cells');

    try {
      overlay(true);
      $('cine-date').textContent = 'Le chroniqueur prépare le récit…';
      $('cine-titre').textContent = '';
      $('cine-jauge').style.width = '0%';
      $('cine-pct').textContent = '';

      const data = await preparer();
      if (!data || !data.etapes.length) {
        $('cine-date').textContent = 'Aucune chevauchée à raconter pour l\u2019instant.';
        await attendre(2200);
        return;
      }
      const { etapes, totalCells } = data;

      // La carte repart vierge : brume totale, aucun tracé
      fog.setCells([]);
      fog.refresh();
      if (map.getSource('cine-traces')) {
        map.getSource('cine-traces').setData({ type: 'FeatureCollection', features: [] });
      }
      if (map.getLayer('traces')) map.setLayoutProperty('traces', 'visibility', 'none');

      map.jumpTo({ center: [2.4, 46.6], zoom: 4.6 });
      await attendre(1400);
      if (annule) return;

      const pas = Math.max(PAS_MIN, Math.min(PAS_MAX, DUREE_CIBLE / etapes.length));
      const traits = [];
      let cellsVues = 0, dernierMois = '', dernierCentre = null;

      for (let i = 0; i < etapes.length; i++) {
        if (annule) break;
        const e = etapes[i];

        // Cartouche daté : n'écrit que lorsque le mois change
        const m = moisFr(e.date);
        if (m !== dernierMois) {
          dernierMois = m;
          $('cine-date').textContent = m.charAt(0).toUpperCase() + m.slice(1);
        }
        $('cine-titre').textContent = e.nom || '';

        // Caméra : suit les foyers d'activité, sans s'agiter
        if (e.centre) {
          const loin = !dernierCentre ||
            Math.abs(e.centre[0] - dernierCentre[0]) > 1.1 ||
            Math.abs(e.centre[1] - dernierCentre[1]) > 0.9;
          if (loin) {
            map.easeTo({ center: e.centre, zoom: 7.4, duration: 1100 });
            dernierCentre = e.centre;
            await attendre(500);
            if (annule) break;
          }
        }

        // Le tracé s'écrit à l'encre
        if (e.ligne.length > 1) {
          traits.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: e.ligne } });
          const src = map.getSource('cine-traces');
          if (src) src.setData({ type: 'FeatureCollection', features: traits });
        }

        // Le voile se déchire
        if (e.cells.length) {
          fog.addCells(e.cells);
          fog.refresh();
          cellsVues += e.cells.length;
        }

        // Les hauts lieux surgissent
        if (e.pois.length) {
          const p = e.pois[0];
          const el = $('cine-lieu');
          el.textContent = '✦ ' + p.name;
          el.classList.remove('hidden');
          setTimeout(() => el.classList.add('hidden'), 2000);
        }

        const k = (i + 1) / etapes.length;
        $('cine-jauge').style.width = (k * 100).toFixed(1) + '%';
        if (totalCells) {
          const pct = (cellsVues / window.TI.Progress.counts.total) * 100;
          $('cine-pct').textContent = window.TI.Progress.formatPct(pct) + ' de la France';
        }

        await attendre(pas);
      }

      // Épilogue
      if (!annule) {
        $('cine-titre').textContent = '';
        $('cine-date').textContent = 'Voilà ton royaume, explorateur.';
        await attendre(2600);
      }
    } catch (e) {
      console.error(e);
    } finally {
      // Restauration intégrale : rien de la cinématique ne persiste
      try {
        fog.setCells(cellsAvant.map((c) => c.h3));
        fog.refresh();
        if (map.getSource('cine-traces')) {
          map.getSource('cine-traces').setData({ type: 'FeatureCollection', features: [] });
        }
        if (map.getLayer('traces')) map.setLayoutProperty('traces', 'visibility', 'visible');
        map.easeTo({ center: vueAvant.center, zoom: vueAvant.zoom, duration: 900 });
      } catch (e) { /* la carte sera de toute façon rafraîchie */ }
      const el = $('cine-lieu'); if (el) el.classList.add('hidden');
      if (btnPasser) btnPasser.removeEventListener('click', onPasser);
      overlay(false);
      running = false;
      await DB.metaSet('cineVue', true);
    }
  }

  // ----------------------------------------------------------
  function init(m, f) {
    map = m; fog = f;
    // Couche de tracés propre à la cinématique (au-dessus de la brume)
    if (!map.getSource('cine-traces')) {
      map.addSource('cine-traces', { type: 'geojson',
        data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'cine-traces', type: 'line', source: 'cine-traces',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#7A2E2B', 'line-width': 2.2, 'line-opacity': 0.95 },
      });
    }
  }

  async function dejaVue() { return !!(await DB.metaGet('cineVue', false)); }

  window.TI.Cine = { init, jouer, dejaVue };
})();
