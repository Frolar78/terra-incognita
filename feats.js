// ============================================================
// feats.js — les hauts faits (Lot 3)
// Tout est évalué en local, sur les données déjà en base :
// activités, cellules révélées, lieux du Codex. Aucun réseau.
// Les hauts faits sont VISIBLES À L'AVANCE : chacun affiche sa
// condition et, quand c'est mesurable, sa jauge de progression.
// ============================================================
(function () {
  const DB = window.TI.DB;

  // Sceaux dessinés au trait
  const S = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const SCEAUX = {
    banniere: S('<path d="M6 3v18"/><path d="M6 4h12l-3 4 3 4H6"/>'),
    couronne: S('<path d="M4 8l3 4 5-7 5 7 3-4v10H4z"/><path d="M4 21h16"/>'),
    grille:   S('<path d="M4 4h16v16H4z"/><path d="M4 10h16M4 15h16M10 4v16M15 4v16"/>'),
    etoile:   S('<path d="M12 3l2.1 5.2 5.6.4-4.3 3.6 1.4 5.4L12 14.7 7.2 17.6l1.4-5.4-4.3-3.6 5.6-.4z"/>'),
    losange:  S('<path d="M12 2l6 10-6 10-6-10z"/>'),
    gemmes:   S('<path d="M12 2l6 10-6 10-6-10z"/><path d="M6 12h12"/>'),
    tour:     S('<path d="M5 21V9l3-2 4 2 4-2 3 2v12z"/><path d="M9 21v-5h6v5"/>'),
    croix:    S('<path d="M12 3v18M7 8h10"/><path d="M6 21h12"/>'),
    cime:     S('<path d="M3 19l6-11 4 6 2.5-3.5L21 19z"/>'),
    montagne: S('<path d="M2 20l7-13 4 7 3-4 6 10z"/><path d="M9 7l1.6 3"/>'),
    epees:    S('<path d="M4 4l10 10M20 4L10 14"/><path d="M14 14l6 6M10 14l-6 6"/>'),
    lune:     S('<path d="M20 14a8 8 0 11-9-11 7 7 0 009 11z"/>'),
    fleur:    S('<path d="M12 3v18M3 12h18M6 6l12 12M18 6L6 18"/>'),
    soleil:   S('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M6 6l1.5 1.5M16.5 16.5L18 18M18 6l-1.5 1.5M7.5 16.5L6 18"/>'),
    boussole: S('<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 5-4 1 2-5z"/>'),
  };

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
    { id: 'premier-pas', fam: 'Conquête', titre: 'Premier pas hors des murs', sceau: SCEAUX.banniere,
      cond: 'Révéler ta toute première cellule', xp: 30,
      mesure: (c) => J(c.cells.length, 1) },
    { id: 'terre-arpentee', fam: 'Conquête', titre: 'Territoire arpenté', sceau: SCEAUX.banniere,
      cond: 'Porter un département à 2 %', xp: 80,
      mesure: (c) => J(c.deptsAu(2), 1) },
    { id: 'domaine-familier', fam: 'Conquête', titre: 'Domaine familier', sceau: SCEAUX.banniere,
      cond: 'Porter un département à 8 %', xp: 200,
      mesure: (c) => J(c.deptsAu(8), 1) },
    { id: 'departement-conquis', fam: 'Conquête', titre: 'Département conquis', sceau: SCEAUX.couronne,
      cond: 'Porter un département à 20 %', xp: 600,
      mesure: (c) => J(c.deptsAu(20), 1) },
    { id: 'cinq-contrees', fam: 'Conquête', titre: 'Cinq contrées foulées', sceau: SCEAUX.banniere,
      cond: 'Fouler 5 départements différents', xp: 120,
      mesure: (c) => J(c.deptsTouches, 5) },
    { id: 'vingt-contrees', fam: 'Conquête', titre: 'Vingt contrées foulées', sceau: SCEAUX.banniere,
      cond: 'Fouler 20 départements différents', xp: 400,
      mesure: (c) => J(c.deptsTouches, 20) },
    { id: 'mille-cellules', fam: 'Conquête', titre: 'Mille arpents', sceau: SCEAUX.grille,
      cond: 'Révéler 1 000 cellules', xp: 100,
      mesure: (c) => J(c.cells.length, 1000) },
    { id: 'dix-mille-cellules', fam: 'Conquête', titre: 'Dix mille arpents', sceau: SCEAUX.grille,
      cond: 'Révéler 10 000 cellules', xp: 350,
      mesure: (c) => J(c.cells.length, 10000) },
    { id: 'cinquante-mille', fam: 'Conquête', titre: 'Cinquante mille arpents', sceau: SCEAUX.grille,
      cond: 'Révéler 50 000 cellules', xp: 900,
      mesure: (c) => J(c.cells.length, 50000) },

    // ---------------- Collection ----------------
    { id: 'dix-lieux', fam: 'Collection', titre: 'Premier codex', sceau: SCEAUX.losange,
      cond: 'Inscrire 10 lieux au Codex', xp: 100,
      mesure: (c) => J(c.pois.length, 10) },
    { id: 'cinquante-lieux', fam: 'Collection', titre: 'Codex fourni', sceau: SCEAUX.losange,
      cond: 'Inscrire 50 lieux au Codex', xp: 300,
      mesure: (c) => J(c.pois.length, 50) },
    { id: 'deux-cents-lieux', fam: 'Collection', titre: 'Grand cartulaire', sceau: SCEAUX.losange,
      cond: 'Inscrire 200 lieux au Codex', xp: 800,
      mesure: (c) => J(c.pois.length, 200) },
    { id: 'un-rare', fam: 'Collection', titre: 'Trouvaille rare', sceau: SCEAUX.gemmes,
      cond: 'Découvrir un lieu de rareté Rare', xp: 150,
      mesure: (c) => J(c.parRarete[2], 1) },
    { id: 'un-epique', fam: 'Collection', titre: 'Trouvaille épique', sceau: SCEAUX.gemmes,
      cond: 'Découvrir un lieu de rareté Épique', xp: 400,
      mesure: (c) => J(c.parRarete[3], 1) },
    { id: 'un-legendaire', fam: 'Collection', titre: 'Trouvaille légendaire', sceau: SCEAUX.etoile,
      cond: 'Découvrir un lieu de rareté Légendaire', xp: 1000,
      mesure: (c) => J(c.parRarete[4], 1) },
    { id: 'huit-types', fam: 'Collection', titre: 'Toutes les merveilles', sceau: SCEAUX.boussole,
      cond: 'Réunir les 8 types de lieux', xp: 700,
      mesure: (c) => J(c.typesDistincts, 8) },
    { id: 'cinq-forteresses', fam: 'Collection', titre: 'Chasseur de forteresses', sceau: SCEAUX.tour,
      cond: 'Découvrir 5 forteresses', xp: 200,
      mesure: (c) => J(c.parType.forteresse, 5) },
    { id: 'cinq-sanctuaires', fam: 'Collection', titre: 'Pèlerin', sceau: SCEAUX.croix,
      cond: 'Découvrir 5 sanctuaires', xp: 200,
      mesure: (c) => J(c.parType.sanctuaire, 5) },
    { id: 'trois-cimes', fam: 'Collection', titre: 'Compteur de cimes', sceau: SCEAUX.cime,
      cond: 'Découvrir 3 cimes', xp: 250,
      mesure: (c) => J(c.parType.cime, 3) },

    // ---------------- Exploits ----------------
    { id: 'mille-den', fam: 'Exploit', titre: 'Mille mètres vers le ciel', sceau: SCEAUX.montagne,
      cond: '1 000 m de dénivelé en une sortie', xp: 250,
      mesure: (c) => J(Math.round(c.maxElev), 1000) },
    { id: 'deux-mille-den', fam: 'Exploit', titre: 'Deux mille mètres vers le ciel', sceau: SCEAUX.montagne,
      cond: '2 000 m de dénivelé en une sortie', xp: 600,
      mesure: (c) => J(Math.round(c.maxElev), 2000) },
    { id: 'marathon', fam: 'Exploit', titre: 'Distance du messager', sceau: SCEAUX.epees,
      cond: 'Une sortie de 42,2 km ou plus', xp: 300,
      mesure: (c) => J(Math.round(c.maxDist / 100) / 10, 42.2) },
    { id: 'cent-bornes', fam: 'Exploit', titre: 'Chevauchée de cent lieues', sceau: SCEAUX.epees,
      cond: 'Une sortie de 100 km ou plus', xp: 500,
      mesure: (c) => J(Math.round(c.maxDist / 1000), 100) },
    { id: 'haute-cime', fam: 'Exploit', titre: 'Au-dessus des nuages', sceau: SCEAUX.montagne,
      cond: 'Découvrir un lieu à plus de 2 000 m', xp: 500,
      mesure: (c) => J(Math.round(c.maxAlt), 2000) },
    { id: 'grande-expedition', fam: 'Exploit', titre: 'Grande expédition', sceau: SCEAUX.banniere,
      cond: '500 cellules inédites en une seule sortie', xp: 400,
      mesure: (c) => J(c.maxNewCells, 500) },

    // ---------------- Constance ----------------
    { id: 'sept-jours', fam: 'Constance', titre: 'Sept jours de marche', sceau: SCEAUX.lune,
      cond: 'Sortir 7 jours d\u2019affilée', xp: 300,
      mesure: (c) => J(c.serie, 7) },
    { id: 'quinze-jours', fam: 'Constance', titre: 'Quinze jours de marche', sceau: SCEAUX.lune,
      cond: 'Sortir 15 jours d\u2019affilée', xp: 700,
      mesure: (c) => J(c.serie, 15) },
    { id: 'mois-charge', fam: 'Constance', titre: 'Mois de labeur', sceau: SCEAUX.lune,
      cond: '20 sorties dans un même mois', xp: 350,
      mesure: (c) => J(c.meilleurMois, 20) },
    { id: 'quatre-saisons', fam: 'Constance', titre: 'Les quatre saisons', sceau: SCEAUX.fleur,
      cond: 'Sortir au moins une fois à chaque saison', xp: 400,
      mesure: (c) => J(c.saisons, 4) },
    { id: 'cent-sorties', fam: 'Constance', titre: 'Cent chevauchées', sceau: SCEAUX.banniere,
      cond: 'Enregistrer 100 sorties', xp: 400,
      mesure: (c) => J(c.acts.length, 100) },
    { id: 'trois-cents-sorties', fam: 'Constance', titre: 'Trois cents chevauchées', sceau: SCEAUX.couronne,
      cond: 'Enregistrer 300 sorties', xp: 1200,
      mesure: (c) => J(c.acts.length, 300) },

    // ---------------- Curiosités ----------------
    { id: 'aube', fam: 'Curiosité', titre: 'Avant le coq', sceau: SCEAUX.soleil,
      cond: 'Partir avant 6 h du matin', xp: 150,
      mesure: (c) => J(c.aube ? 1 : 0, 1) },
    { id: 'nuit', fam: 'Curiosité', titre: 'Marcheur de nuit', sceau: SCEAUX.lune,
      cond: 'Partir après 22 h', xp: 150,
      mesure: (c) => J(c.nuit ? 1 : 0, 1) },
    { id: 'trois-sports', fam: 'Curiosité', titre: 'Touche-à-tout', sceau: SCEAUX.boussole,
      cond: 'Explorer avec 3 disciplines différentes', xp: 200,
      mesure: (c) => J(c.sports, 3) },
    { id: 'grand-ecart', fam: 'Curiosité', titre: 'Du nord au sud', sceau: SCEAUX.boussole,
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
