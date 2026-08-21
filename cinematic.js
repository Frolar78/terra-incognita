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

    // Cadence : une scène = un mois DANS UNE MÊME RÉGION. Un mois où
    // tu as couru à Paris puis à Nice donne deux scènes, au lieu d'un
    // point moyen au milieu de nulle part.
    const h3lib = window.h3;
    const latlng = (h3id) => {
      try { return h3lib.cellToLatLng(h3id); } catch (e) { return null; }
    };

    const scenes = [];
    let cour = null;
    for (const e of etapes) {
      const cle = e.date.slice(0, 7);
      const loin = cour && cour.centre && e.centre &&
        Math.hypot(e.centre[0] - cour.centre[0], e.centre[1] - cour.centre[1]) > 0.8;
      if (!cour || cour.cle !== cle || loin) {
        cour = { cle, date: e.date, sorties: [], cells: [], pois: [],
          lignes: [], centre: e.centre || null, n: 0 };
        scenes.push(cour);
      }
      cour.sorties.push(e);
      cour.cells.push.apply(cour.cells, e.cells);
      cour.pois.push.apply(cour.pois, e.pois);
      if (e.ligne.length > 1) cour.lignes.push(e.ligne);
      if (e.centre) {
        // moyenne pondérée honnête (et non un glissement à deux termes)
        cour.n++;
        cour.centre = cour.centre
          ? [cour.centre[0] + (e.centre[0] - cour.centre[0]) / cour.n,
             cour.centre[1] + (e.centre[1] - cour.centre[1]) / cour.n]
          : e.centre;
      }
    }

    // Cadre de chaque scène : l'emprise RÉELLE des cellules révélées,
    // pour que la caméra montre toujours quelque chose qui s'ouvre.
    for (const s of scenes) {
      let x1 = 180, y1 = 90, x2 = -180, y2 = -90, n = 0;
      const pas = Math.max(1, Math.floor(s.cells.length / 400));
      for (let i = 0; i < s.cells.length; i += pas) {
        const ll = latlng(s.cells[i]);
        if (!ll) continue;
        n++;
        if (ll[1] < x1) x1 = ll[1]; if (ll[1] > x2) x2 = ll[1];
        if (ll[0] < y1) y1 = ll[0]; if (ll[0] > y2) y2 = ll[0];
      }
      if (n) {
        const mx = Math.max(0.012, (x2 - x1) * 0.25);
        const my = Math.max(0.010, (y2 - y1) * 0.25);
        s.bbox = [[x1 - mx, y1 - my], [x2 + mx, y2 + my]];
        s.centre = [(x1 + x2) / 2, (y1 + y2) / 2];
      }
    }

    return { etapes, scenes, totalCells };
  }

  // ----------------------------------------------------------
  function moisFr(iso) {
    return new Date(iso).toLocaleDateString('fr-FR',
      { month: 'long', year: 'numeric' });
  }

  function overlay(afficher) {
    const el = $('cine-overlay');
    if (!el) return;
    if (afficher) {
      el.classList.remove('hidden');
      document.body.classList.add('cinema');
      // un souffle pour que la transition d'opacité s'amorce
      requestAnimationFrame(() => el.classList.add('visible'));
    } else {
      el.classList.remove('visible');
      document.body.classList.remove('cinema');
      setTimeout(() => el.classList.add('hidden'), 900);
    }
  }

  // Fondu enchaîné du cartouche : le texte ne saute jamais
  async function ecrireCartouche(date, sous) {
    const h = document.querySelector('.cine-haut');
    if (h) { h.classList.add('transition'); await attendre(320); }
    $('cine-date').textContent = date;
    $('cine-titre').textContent = sous || '';
    if (h) h.classList.remove('transition');
  }

  function carton(id, montrer) {
    const el = $(id);
    if (!el) return Promise.resolve();
    if (montrer) {
      el.classList.remove('hidden');
      requestAnimationFrame(() => el.classList.add('montre'));
      return attendre(1100);
    }
    el.classList.remove('montre');
    return attendre(1100).then(() => el.classList.add('hidden'));
  }

  const nb = (n) => Math.round(n).toLocaleString('fr-FR');

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
      $('cine-date').textContent = '';
      $('cine-titre').textContent = '';
      $('cine-jauge').style.width = '0%';
      $('cine-pct').textContent = '';
      const fin0 = $('cine-final');
      if (fin0) { fin0.classList.remove('montre'); fin0.classList.add('hidden'); }
      $('cine-carton-txt').textContent = 'Le chroniqueur ouvre les registres…';
      await carton('cine-carton', true);

      const data = await preparer();
      if (!data || !data.scenes.length) {
        $('cine-date').textContent = 'Aucune chevauchée à raconter pour l\u2019instant.';
        await attendre(2200);
        return;
      }
      const { scenes, totalCells } = data;

      // La carte repart vierge : brume totale, aucun tracé
      fog.setCells([]);
      fog.refresh();
      videTraces();
      if (map.getLayer('traces')) map.setLayoutProperty('traces', 'visibility', 'none');

      map.jumpTo({ center: [2.4, 46.6], zoom: 4.6 });

      const an = new Date(scenes[0].date).getFullYear();
      $('cine-carton-txt').textContent =
        'Le royaume dort sous la brume. Nous sommes en l\u2019an ' + an + '.';
      await attendre(2300);
      await carton('cine-carton', false);
      if (annule) return;
      await attendre(500);

      // Budget : la déchirure dure ~1,8 s, le voyage jusqu'à ~2 s.
      const respiration = Math.max(300,
        Math.min(2000, DUREE_CIBLE / scenes.length - 2600));
      const anciennes = [];
      let cellsVues = 0, dernierCadre = null;

      for (let i = 0; i < scenes.length; i++) {
        if (annule) break;
        const s = scenes[i];

        const nom = moisFr(s.date);
        $('cine-date').textContent = nom.charAt(0).toUpperCase() + nom.slice(1);
        $('cine-titre').textContent = s.sorties.length > 1
          ? s.sorties.length + ' chevauchées'
          : (s.sorties[0].nom || '');

        // 1. La caméra cadre EXACTEMENT ce qui va s'ouvrir, et on
        //    attend qu'elle soit arrivée : rien ne se révèle en vol.
        if (s.bbox) {
          const bouge = !dernierCadre ||
            Math.hypot(s.centre[0] - dernierCadre[0], s.centre[1] - dernierCadre[1]) > 0.25;
          if (bouge) {
            const d = dernierCadre
              ? Math.hypot(s.centre[0] - dernierCadre[0], s.centre[1] - dernierCadre[1])
              : 8;
            const duree = Math.min(2000, 800 + d * 190);
            await new Promise((res) => {
              let fini = false;
              const fin = () => { if (!fini) { fini = true; res(); } };
              map.once('moveend', fin);
              setTimeout(fin, duree + 700); // filet si moveend n'arrive pas
              map.fitBounds(s.bbox, {
                padding: { top: 110, bottom: 150, left: 40, right: 40 },
                maxZoom: 11.5, duration: duree, essential: true,
                easing: (t) => t * (2 - t),
              });
            });
            dernierCadre = s.centre;
            if (annule) break;
          }
        }

        // 2. Les tracés de la scène s'écrivent, les anciens se ternissent
        if (s.lignes.length) {
          majTraces(anciennes, s.lignes);
          for (const l of s.lignes) anciennes.push(l);
        }

        // 3. Le voile se déchire, caméra immobile
        if (s.cells.length) {
          const neuves = new Set(s.cells);
          fog.addCells(neuves);
          cellsVues += s.cells.length;
          await new Promise((res) => {
            let fini = false;
            const fin = () => { if (!fini) { fini = true; res(); } };
            try { fog.dissipate(neuves, fin); } catch (e) { fog.refresh(); fin(); }
            setTimeout(fin, 2400); // filet de sécurité
          });
          if (annule) break;
        }

        // 4. Les hauts lieux de la scène se signalent
        if (s.pois.length) {
          const p = s.pois.slice().sort((a, b) => (b.rarete || 0) - (a.rarete || 0))[0];
          const el = $('cine-lieu');
          el.textContent = '✦ ' + p.name +
            (s.pois.length > 1 ? '  (+' + (s.pois.length - 1) + ')' : '');
          el.classList.remove('hidden');
          setTimeout(() => el.classList.add('hidden'), 2200);
        }

        const k = (i + 1) / scenes.length;
        $('cine-jauge').style.width = (k * 100).toFixed(1) + '%';
        $('cine-pct').textContent = window.TI.Progress.formatPct(
          (cellsVues / window.TI.Progress.counts.total) * 100) + ' de la France';

        await attendre(respiration);
      }

      // Épilogue : recul sur le royaume entier, puis carton de clôture
      if (!annule) {
        await ecrireCartouche('Aujourd\u2019hui', '');
        map.easeTo({ center: [2.4, 46.6], zoom: 4.9, duration: 3000,
          easing: (t) => t * (2 - t) });
        await attendre(3600);
        await bilanFinal();
        await attendre(5000);
        await carton('cine-final', false);
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
      for (const id of ['cine-carton', 'cine-final']) {
        const c = $(id);
        if (c) { c.classList.remove('montre'); c.classList.add('hidden'); }
      }
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

  // Carton de clôture : les chiffres du royaume
  async function bilanFinal() {
    const [acts, pois, cells] = await Promise.all([
      DB.getAll('activities'), DB.getAll('pois'), DB.getAll('cells'),
    ]);
    const km = acts.reduce((t, a) => t + (a.distance || 0), 0) / 1000;
    const jours = new Set(acts.map((a) => String(a.date).slice(0, 10))).size;
    const depts = new Set(cells.map((c) => c.d).filter(Boolean)).size;
    const pct = window.TI.Progress.formatPct(
      (cells.length / window.TI.Progress.counts.total) * 100);
    const el = $('cine-final-chiffres');
    if (el) {
      el.innerHTML =
        `<div class="cf"><b>${nb(km)}</b><span>kilomètres</span></div>` +
        `<div class="cf"><b>${nb(jours)}</b><span>jours d'exploration</span></div>` +
        `<div class="cf"><b>${nb(pois.length)}</b><span>hauts lieux</span></div>` +
        `<div class="cf"><b>${nb(depts)}</b><span>contrées foulées</span></div>` +
        `<div class="cf" style="grid-column:1/-1"><b>${pct}</b>` +
        `<span>de la France arrachée à la brume</span></div>`;
    }
    await carton('cine-final', true);
  }

  function init(m, f) {
    map = m; fog = f;
    // Couches de tracés propres à la cinématique (au-dessus de la brume)
    if (!map.getSource('cine-anciennes')) {
      map.addSource('cine-anciennes', { type: 'geojson', data: fc([]) });
      map.addLayer({
        id: 'cine-anciennes', type: 'line', source: 'cine-anciennes',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#8E2F2A', 'line-width': 1.5, 'line-opacity': 0.38 },
      });
    }
    if (!map.getSource('cine-traces')) {
      map.addSource('cine-traces', { type: 'geojson', data: fc([]) });
      map.addLayer({
        id: 'cine-traces', type: 'line', source: 'cine-traces',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#A8352E', 'line-width': 2.8, 'line-opacity': 1,
          'line-blur': 0.4,
        },
      });
    }
  }

  async function dejaVue() { return !!(await DB.metaGet('cineVue', false)); }

  window.TI.Cine = { init, jouer, dejaVue, enCours: () => running };
})();
