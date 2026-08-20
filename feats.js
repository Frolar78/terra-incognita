// ============================================================
// feats.js — les hauts faits (Lot 3)
// Tout est évalué en local, sur les données déjà en base :
// activités, cellules révélées, lieux du Codex. Aucun réseau.
// Les hauts faits sont VISIBLES À L'AVANCE : chacun affiche sa
// condition et, quand c'est mesurable, sa jauge de progression.
// ============================================================
(function () {
  const DB = window.TI.DB;

  // --- petits utilitaires de dates (heure locale) -------------
  const jour = (iso) => {
    const d = new Date(iso);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0');
  };
  const saison = (iso) => {
    const d = new Date(iso), m = d.getMonth(), j = d.getDate();
    if ((m === 2 && j >= 20) || m === 3 || m === 4 || (m === 5 && j < 21)) return 'printemps';
    if ((m === 5 && j >= 21) || m === 6 || m === 7 || (m === 8 && j < 23)) return 'été';
    if ((m === 8 && j >= 23) || m === 9 || m === 10 || (m === 11 && j < 21)) return 'automne';
    return 'hiver';
  };
  const plusLongueSerie = (acts) => {
    const jours = [...new Set(acts.map((a) => jour(a.date)))].sort();
    let best = 0, cur = 0, prev = null;
    for (const j of jours) {
      const d = new Date(j + 'T12:00:00');
      cur = (prev && (d - prev) / 86400000 === 1) ? cur + 1 : 1;
      best = Math.max(best, cur);
      prev = d;
    }
    return best;
  };
  const parMois = (acts) => {
    const m = {};
    for (const a of acts) {
      const k = jour(a.date).slice(0, 7);
      m[k] = (m[k] || 0) + 1;
    }
    return Math.max(0, ...Object.values(m));
  };

  // --- jauge : { cur, max } -----------------------------------
  const J = (cur, max) => ({ cur: Math.min(cur, max), max });

  // ============================================================
  // Les hauts faits. `mesure` renvoie une jauge ; acquis dès que
  // cur >= max. `xp` est crédité une seule fois, à l'obtention.
  // ============================================================
  const FAITS = [
    // ---------------- Conquête ----------------
    { id: 'premier-pas', fam: 'Conquête', titre: 'Premier pas hors des murs', sceau: '⚑',
      cond: 'Révéler ta toute première cellule', xp: 30,
      mesure: (c) => J(c.cells.length, 1) },
    { id: 'terre-arpentee', fam: 'Conquête', titre: 'Territoire arpenté', sceau: '⚑',
      cond: 'Porter un département à 2 %', xp: 80,
      mesure: (c) => J(c.deptsAu(2), 1) },
    { id: 'domaine-familier', fam: 'Conquête', titre: 'Domaine familier', sceau: '⚑',
      cond: 'Porter un département à 8 %', xp: 200,
      mesure: (c) => J(c.deptsAu(8), 1) },
    { id: 'departement-conquis', fam: 'Conquête', titre: 'Département conquis', sceau: '♔',
      cond: 'Porter un département à 20 %', xp: 600,
      mesure: (c) => J(c.deptsAu(20), 1) },
    { id: 'cinq-contrees', fam: 'Conquête', titre: 'Cinq contrées foulées', sceau: '⚑',
      cond: 'Fouler 5 départements différents', xp: 120,
      mesure: (c) => J(c.deptsTouches, 5) },
    { id: 'vingt-contrees', fam: 'Conquête', titre: 'Vingt contrées foulées', sceau: '⚑',
      cond: 'Fouler 20 départements différents', xp: 400,
      mesure: (c) => J(c.deptsTouches, 20) },
    { id: 'mille-cellules', fam: 'Conquête', titre: 'Mille arpents', sceau: '▦',
      cond: 'Révéler 1 000 cellules', xp: 100,
      mesure: (c) => J(c.cells.length, 1000) },
    { id: 'dix-mille-cellules', fam: 'Conquête', titre: 'Dix mille arpents', sceau: '▦',
      cond: 'Révéler 10 000 cellules', xp: 350,
      mesure: (c) => J(c.cells.length, 10000) },
    { id: 'cinquante-mille', fam: 'Conquête', titre: 'Cinquante mille arpents', sceau: '▦',
      cond: 'Révéler 50 000 cellules', xp: 900,
      mesure: (c) => J(c.cells.length, 50000) },

    // ---------------- Collection ----------------
    { id: 'dix-lieux', fam: 'Collection', titre: 'Premier codex', sceau: '✦',
      cond: 'Inscrire 10 lieux au Codex', xp: 100,
      mesure: (c) => J(c.pois.length, 10) },
    { id: 'cinquante-lieux', fam: 'Collection', titre: 'Codex fourni', sceau: '✦',
      cond: 'Inscrire 50 lieux au Codex', xp: 300,
      mesure: (c) => J(c.pois.length, 50) },
    { id: 'deux-cents-lieux', fam: 'Collection', titre: 'Grand cartulaire', sceau: '✦',
      cond: 'Inscrire 200 lieux au Codex', xp: 800,
      mesure: (c) => J(c.pois.length, 200) },
    { id: 'un-rare', fam: 'Collection', titre: 'Trouvaille rare', sceau: '◆',
      cond: 'Découvrir un lieu de rareté Rare', xp: 150,
      mesure: (c) => J(c.parRarete[2], 1) },
    { id: 'un-epique', fam: 'Collection', titre: 'Trouvaille épique', sceau: '◆',
      cond: 'Découvrir un lieu de rareté Épique', xp: 400,
      mesure: (c) => J(c.parRarete[3], 1) },
    { id: 'un-legendaire', fam: 'Collection', titre: 'Trouvaille légendaire', sceau: '★',
      cond: 'Découvrir un lieu de rareté Légendaire', xp: 1000,
      mesure: (c) => J(c.parRarete[4], 1) },
    { id: 'huit-types', fam: 'Collection', titre: 'Toutes les merveilles', sceau: '✧',
      cond: 'Réunir les 8 types de lieux', xp: 700,
      mesure: (c) => J(c.typesDistincts, 8) },
    { id: 'cinq-forteresses', fam: 'Collection', titre: 'Chasseur de forteresses', sceau: '♜',
      cond: 'Découvrir 5 forteresses', xp: 200,
      mesure: (c) => J(c.parType.forteresse, 5) },
    { id: 'cinq-sanctuaires', fam: 'Collection', titre: 'Pèlerin', sceau: '✠',
      cond: 'Découvrir 5 sanctuaires', xp: 200,
      mesure: (c) => J(c.parType.sanctuaire, 5) },
    { id: 'trois-cimes', fam: 'Collection', titre: 'Compteur de cimes', sceau: '▲',
      cond: 'Découvrir 3 cimes', xp: 250,
      mesure: (c) => J(c.parType.cime, 3) },

    // ---------------- Exploits ----------------
    { id: 'mille-den', fam: 'Exploit', titre: 'Mille mètres vers le ciel', sceau: '⛰',
      cond: '1 000 m de dénivelé en une sortie', xp: 250,
      mesure: (c) => J(Math.round(c.maxElev), 1000) },
    { id: 'deux-mille-den', fam: 'Exploit', titre: 'Deux mille mètres vers le ciel', sceau: '⛰',
      cond: '2 000 m de dénivelé en une sortie', xp: 600,
      mesure: (c) => J(Math.round(c.maxElev), 2000) },
    { id: 'marathon', fam: 'Exploit', titre: 'Distance du messager', sceau: '⚔',
      cond: 'Une sortie de 42,2 km ou plus', xp: 300,
      mesure: (c) => J(Math.round(c.maxDist / 100) / 10, 42.2) },
    { id: 'cent-bornes', fam: 'Exploit', titre: 'Chevauchée de cent lieues', sceau: '⚔',
      cond: 'Une sortie de 100 km ou plus', xp: 500,
      mesure: (c) => J(Math.round(c.maxDist / 1000), 100) },
    { id: 'haute-cime', fam: 'Exploit', titre: 'Au-dessus des nuages', sceau: '⛰',
      cond: 'Découvrir un lieu à plus de 2 000 m', xp: 500,
      mesure: (c) => J(Math.round(c.maxAlt), 2000) },
    { id: 'grande-expedition', fam: 'Exploit', titre: 'Grande expédition', sceau: '⚑',
      cond: '500 cellules inédites en une seule sortie', xp: 400,
      mesure: (c) => J(c.maxNewCells, 500) },

    // ---------------- Constance ----------------
    { id: 'sept-jours', fam: 'Constance', titre: 'Sept jours de marche', sceau: '☾',
      cond: 'Sortir 7 jours d\u2019affilée', xp: 300,
      mesure: (c) => J(c.serie, 7) },
    { id: 'quinze-jours', fam: 'Constance', titre: 'Quinze jours de marche', sceau: '☾',
      cond: 'Sortir 15 jours d\u2019affilée', xp: 700,
      mesure: (c) => J(c.serie, 15) },
    { id: 'mois-charge', fam: 'Constance', titre: 'Mois de labeur', sceau: '☾',
      cond: '20 sorties dans un même mois', xp: 350,
      mesure: (c) => J(c.meilleurMois, 20) },
    { id: 'quatre-saisons', fam: 'Constance', titre: 'Les quatre saisons', sceau: '❋',
      cond: 'Sortir au moins une fois à chaque saison', xp: 400,
      mesure: (c) => J(c.saisons, 4) },
    { id: 'cent-sorties', fam: 'Constance', titre: 'Cent chevauchées', sceau: '⚑',
      cond: 'Enregistrer 100 sorties', xp: 400,
      mesure: (c) => J(c.acts.length, 100) },
    { id: 'trois-cents-sorties', fam: 'Constance', titre: 'Trois cents chevauchées', sceau: '♔',
      cond: 'Enregistrer 300 sorties', xp: 1200,
      mesure: (c) => J(c.acts.length, 300) },

    // ---------------- Curiosités ----------------
    { id: 'aube', fam: 'Curiosité', titre: 'Avant le coq', sceau: '☼',
      cond: 'Partir avant 6 h du matin', xp: 150,
      mesure: (c) => J(c.aube ? 1 : 0, 1) },
    { id: 'nuit', fam: 'Curiosité', titre: 'Marcheur de nuit', sceau: '☾',
      cond: 'Partir après 22 h', xp: 150,
      mesure: (c) => J(c.nuit ? 1 : 0, 1) },
    { id: 'trois-sports', fam: 'Curiosité', titre: 'Touche-à-tout', sceau: '✧',
      cond: 'Explorer avec 3 disciplines différentes', xp: 200,
      mesure: (c) => J(c.sports, 3) },
    { id: 'grand-ecart', fam: 'Curiosité', titre: 'Du nord au sud', sceau: '✛',
      cond: 'Étendre ton royaume sur 5 degrés de latitude', xp: 600,
      mesure: (c) => J(Math.round(c.ecartLat * 10) / 10, 5) },
  ];

  // ============================================================
  // Contexte de mesure, construit une fois par évaluation
  // ============================================================
  async function buildContext() {
    const P = window.TI.Progress;
    const [acts, cells, pois] = await Promise.all([
      DB.getAll('activities'), DB.getAll('cells'), DB.getAll('pois'),
    ]);

    const parRarete = [0, 0, 0, 0, 0];
    const parType = {};
    for (const k of Object.keys(window.TI.POI.TYPES)) parType[k] = 0;
    let maxAlt = 0;
    for (const p of pois) {
      if (p.rarete != null) parRarete[p.rarete]++;
      if (parType[p.type] != null) parType[p.type]++;
      if (p.ele != null && p.ele > maxAlt) maxAlt = p.ele;
    }

    let maxElev = 0, maxDist = 0, maxNewCells = 0, aube = false, nuit = false;
    const saisons = new Set(), sports = new Set();
    for (const a of acts) {
      if ((a.elev || 0) > maxElev) maxElev = a.elev || 0;
      if ((a.distance || 0) > maxDist) maxDist = a.distance || 0;
      if ((a.newCells || 0) > maxNewCells) maxNewCells = a.newCells || 0;
      const h = new Date(a.date).getHours();
      if (h < 6) aube = true;
      if (h >= 22) nuit = true;
      saisons.add(saison(a.date));
      if (a.sport) sports.add(a.sport);
    }

    // Étendue en latitude du royaume (sur les cellules révélées)
    let latMin = 90, latMax = -90;
    const h3lib = window.h3;
    const pas = Math.max(1, Math.floor(cells.length / 4000)); // échantillon suffisant
    for (let i = 0; i < cells.length; i += pas) {
      try {
        const ll = h3lib.cellToLatLng(cells[i].h3);
        if (ll[0] < latMin) latMin = ll[0];
        if (ll[0] > latMax) latMax = ll[0];
      } catch (e) { /* cellule illisible : ignorée */ }
    }
    const ecartLat = cells.length ? Math.max(0, latMax - latMin) : 0;

    const deptsTouches = new Set(cells.map((c) => c.d).filter(Boolean)).size;
    const deptsAu = (seuil) => P._index.filter((d) => {
      const s = P.deptStats(d.code);
      return s && s.pct >= seuil;
    }).length;

    return { acts, cells, pois, parRarete, parType,
      typesDistincts: Object.values(parType).filter((n) => n > 0).length,
      maxElev, maxDist, maxNewCells, maxAlt, aube, nuit,
      saisons: saisons.size, sports: sports.size,
      serie: plusLongueSerie(acts), meilleurMois: parMois(acts),
      deptsTouches, deptsAu, ecartLat };
  }

  // ============================================================
  // Évaluation : renvoie la liste des hauts faits NOUVELLEMENT
  // obtenus (pour les annoncer et créditer l'XP une seule fois).
  // ============================================================
  async function evaluate() {
    const ctx = await buildContext();
    const obtenus = await DB.metaGet('feats', {}) || {};
    const nouveaux = [];
    for (const f of FAITS) {
      if (obtenus[f.id]) continue;
      let m;
      try { m = f.mesure(ctx); } catch (e) { continue; }
      if (m && m.cur >= m.max) {
        obtenus[f.id] = new Date().toISOString();
        nouveaux.push(f);
      }
    }
    if (nouveaux.length) await DB.metaSet('feats', obtenus);
    return nouveaux;
  }

  // XP totale déjà acquise via les hauts faits
  async function xpAcquise() {
    const obtenus = await DB.metaGet('feats', {}) || {};
    return FAITS.reduce((s, f) => s + (obtenus[f.id] ? f.xp : 0), 0);
  }

  // État complet pour l'affichage (acquis + à venir, avec jauges)
  async function state() {
    const ctx = await buildContext();
    const obtenus = await DB.metaGet('feats', {}) || {};
    return FAITS.map((f) => {
      let m = { cur: 0, max: 1 };
      try { m = f.mesure(ctx) || m; } catch (e) { /* jauge à zéro */ }
      return { id: f.id, fam: f.fam, titre: f.titre, sceau: f.sceau,
        cond: f.cond, xp: f.xp, acquis: !!obtenus[f.id],
        date: obtenus[f.id] || null, cur: m.cur, max: m.max };
    });
  }

  window.TI.Feats = { FAITS, evaluate, state, xpAcquise };
})();
