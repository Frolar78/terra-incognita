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
  const DUREE_CIBLE = 165000;  // ~2 min 45 de spectacle, cadencé au mois

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

    // Cadence : un battement par MOIS, pas par sortie. C'est ce qui
    // donne un récit qui respire au lieu d'un diaporama saccadé.
    const mois = [];
    let courant = null;
    for (const e of etapes) {
      const cle = e.date.slice(0, 7);
      if (!courant || courant.cle !== cle) {
        courant = { cle, date: e.date, sorties: [], cells: [], pois: [], lignes: [] };
        mois.push(courant);
      }
      courant.sorties.push(e);
      courant.cells.push.apply(courant.cells, e.cells);
      courant.pois.push.apply(courant.pois, e.pois);
      if (e.ligne.length > 1) courant.lignes.push(e.ligne);
      if (e.centre) {
        courant.centre = courant.centre
          ? [(courant.centre[0] + e.centre[0]) / 2, (courant.centre[1] + e.centre[1]) / 2]
          : e.centre;
      }
    }

    return { etapes, mois, totalCells };
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
    let jouee = false; // n'a de valeur que si le récit s'est vraiment déroulé

    const btnPasser = $('cine-passer');
    const onPasser = () => { annule = true; };
    if (btnPasser) btnPasser.addEventListener('click', onPasser);

    // Referme les panneaux : le récit se regarde sur la carte
    document.querySelectorAll('.panel.open, .sheet.open').forEach((p) => p.classList.remove('open'));
    // Les médaillons du Codex encombreraient la carte : on les efface
    // le temps du récit, les lieux sont annoncés par le bandeau.
    if (window.TI.Codex && window.TI.Codex.setVisible) window.TI.Codex.setVisible(false);
    document.querySelectorAll('.tab').forEach((t) =>
      t.classList.toggle('active', t.dataset.panel === 'panel-carte'));

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
      if (!data || !data.mois.length) {
        $('cine-date').textContent = 'Aucune chevauchée à raconter pour l\u2019instant.';
        await attendre(2200);
        return;
      }
      const { mois, totalCells } = data;

      // La carte repart vierge : brume totale, aucun tracé
      fog.setCells([]);
      fog.refresh();
      videTraces();
      if (map.getLayer('traces')) map.setLayoutProperty('traces', 'visibility', 'none');

      map.jumpTo({ center: [2.4, 46.6], zoom: 4.6 });
      await attendre(1600);
      if (annule) return;

      // Un battement par mois : voyage → écriture → déchirure.
      // La déchirure dure ~1,8 s à elle seule : on la déduit du budget
      // pour que le récit tienne dans la durée visée.
      const respiration = Math.max(250,
        Math.min(2200, DUREE_CIBLE / mois.length - 1800));
      const anciennes = [];
      let cellsVues = 0, dernierCentre = null;

      for (let i = 0; i < mois.length; i++) {
        if (annule) break;
        const m = mois[i];

        const nom = moisFr(m.date);
        $('cine-date').textContent = nom.charAt(0).toUpperCase() + nom.slice(1);
        $('cine-titre').textContent = m.sorties.length > 1
          ? m.sorties.length + ' chevauchées'
          : (m.sorties[0].nom || '');

        // 1. La caméra se déplace lentement, et attend d'être arrivée
        if (m.centre) {
          const d = dernierCentre
            ? Math.hypot(m.centre[0] - dernierCentre[0], m.centre[1] - dernierCentre[1])
            : 99;
          if (d > 0.12) {
            const duree = Math.min(2200, 850 + d * 230);
            map.easeTo({ center: m.centre, zoom: d > 3 ? 8.2 : 9.1,
              duration: duree, easing: (t) => t * (2 - t) });
            dernierCentre = m.centre;
            await attendre(Math.min(duree, respiration * 0.6));
            if (annule) break;
          }
        }

        // 2. Les tracés du mois s'écrivent, les anciens se ternissent
        if (m.lignes.length) {
          majTraces(anciennes, m.lignes);
          for (const l of m.lignes) anciennes.push(l);
        }

        // 3. Le voile se déchire pour de bon (dissipation animée)
        if (m.cells.length) {
          const neuves = new Set(m.cells);
          fog.addCells(neuves);
          cellsVues += m.cells.length;
          await new Promise((res) => {
            let fini = false;
            const fin = () => { if (!fini) { fini = true; res(); } };
            try { fog.dissipate(neuves, fin); } catch (e) { fog.refresh(); fin(); }
            setTimeout(fin, 2400); // filet de sécurité
          });
          if (annule) break;
        }

        // 4. Les hauts lieux du mois se signalent
        if (m.pois.length) {
          const p = m.pois.sort((a, b) => (b.rarete || 0) - (a.rarete || 0))[0];
          const el = $('cine-lieu');
          el.textContent = '✦ ' + p.name +
            (m.pois.length > 1 ? '  (+' + (m.pois.length - 1) + ')' : '');
          el.classList.remove('hidden');
          setTimeout(() => el.classList.add('hidden'), 2200);
        }

        const k = (i + 1) / mois.length;
        $('cine-jauge').style.width = (k * 100).toFixed(1) + '%';
        $('cine-pct').textContent = window.TI.Progress.formatPct(
          (cellsVues / window.TI.Progress.counts.total) * 100) + ' de la France';

        await attendre(respiration * 0.4);
      }

      // Épilogue : recul sur le royaume entier
      if (!annule) {
        $('cine-titre').textContent = '';
        $('cine-date').textContent = 'Voilà ton royaume, explorateur.';
        map.easeTo({ center: [2.4, 46.6], zoom: 4.9, duration: 2600,
          easing: (t) => t * (2 - t) });
        await attendre(3400);
      }
      jouee = true; // le récit s'est déroulé (jusqu'au bout ou passé volontairement)
    } catch (e) {
      console.error(e);
      if (window.TI.UI && window.TI.UI.toast) {
        window.TI.UI.toast('La cinématique n\u2019a pas pu se dérouler : ' +
          (e && e.message ? e.message : 'erreur inconnue'), 7000);
      }
    } finally {
      // Restauration intégrale : rien de la cinématique ne persiste
      try {
        fog.setCells(cellsAvant.map((c) => c.h3));
        fog.refresh();
        videTraces();
        if (map.getLayer('traces')) map.setLayoutProperty('traces', 'visibility', 'visible');
        if (window.TI.Codex && window.TI.Codex.setVisible) window.TI.Codex.setVisible(true);
        map.easeTo({ center: vueAvant.center, zoom: vueAvant.zoom, duration: 900 });
      } catch (e) { /* la carte sera de toute façon rafraîchie */ }
      const el = $('cine-lieu'); if (el) el.classList.add('hidden');
      if (btnPasser) btnPasser.removeEventListener('click', onPasser);
      overlay(false);
      running = false;
      // « Déjà vue » seulement si le récit s'est vraiment déroulé : une
      // interruption technique ne doit pas le neutraliser pour toujours.
      if (jouee) await DB.metaSet('cineVue', true);
    }
  }

  // ----------------------------------------------------------
  // ----------------------------------------------------------
  // Tracés : deux couches, pour que le mois en cours ressorte
  // sur la sédimentation des mois passés.
  function fc(lignes) {
    return { type: 'FeatureCollection', features: lignes.map((l) => ({
      type: 'Feature', geometry: { type: 'LineString', coordinates: l } })) };
  }
  function majTraces(anciennes, courantes) {
    const a = map.getSource('cine-anciennes'), c = map.getSource('cine-traces');
    if (a) a.setData(fc(anciennes));
    if (c) c.setData(fc(courantes));
  }
  function videTraces() {
    const a = map.getSource('cine-anciennes'), c = map.getSource('cine-traces');
    if (a) a.setData(fc([]));
    if (c) c.setData(fc([]));
  }

  function init(m, f) {
    map = m; fog = f;
    // Couches de tracés propres à la cinématique (au-dessus de la brume)
    if (!map.getSource('cine-anciennes')) {
      map.addSource('cine-anciennes', { type: 'geojson', data: fc([]) });
      map.addLayer({
        id: 'cine-anciennes', type: 'line', source: 'cine-anciennes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#7A2E2B', 'line-width': 1.6, 'line-opacity': 0.42 },
      });
    }
    if (!map.getSource('cine-traces')) {
      map.addSource('cine-traces', { type: 'geojson', data: fc([]) });
      map.addLayer({
        id: 'cine-traces', type: 'line', source: 'cine-traces',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#9B3A33', 'line-width': 2.6, 'line-opacity': 0.98,
          'line-blur': 0.4,
        },
      });
    }
  }

  async function dejaVue() { return !!(await DB.metaGet('cineVue', false)); }

  window.TI.Cine = { init, jouer, dejaVue };
})();
