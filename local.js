// ============================================================
// local.js — Lot 4 : rendre les objectifs ATTEIGNABLES
// « 0,12 % de la France » ne bouge jamais et ne motive personne.
// On mesure donc ce qui se joue autour de chez soi :
//   • le plus grand domaine d'un seul tenant (les trous comptent) ;
//   • la complétion d'un rayon autour du foyer ;
//   • les hauts lieux tout proches jamais visités.
// Tout est calculé en local, sur des données déjà en base.
// ============================================================
(function () {
  const DB = window.TI.DB;
  const RAYON_M = 5000;     // le « pays » de l'explorateur
  const K_DISQUE = 21;      // anneaux H3 couvrant largement 5 km en res 9

  const h3 = () => window.h3;

  // ----------------------------------------------------------
  // Le foyer : le point d'où partent le plus souvent tes sorties.
  // Déduit des départs, jamais demandé — et jamais transmis.
  async function foyer() {
    const mem = await DB.metaGet('foyer', null);
    if (mem && mem.lat) return mem;

    const acts = await DB.getAll('activities');
    const Strava = window.TI.Strava;
    const paquets = new Map();
    for (const a of acts) {
      if (!a.poly) continue;
      let p;
      try { p = Strava.decodePolyline(a.poly)[0]; } catch (e) { continue; }
      if (!p) continue;
      // Case de ~2 km : on cherche la zone de départ la plus fréquentée
      const cle = Math.round(p[0] / 0.02) + '_' + Math.round(p[1] / 0.02);
      if (!paquets.has(cle)) paquets.set(cle, []);
      paquets.get(cle).push(p);
    }
    if (!paquets.size) return null;

    let meilleur = null;
    for (const pts of paquets.values()) {
      if (!meilleur || pts.length > meilleur.length) meilleur = pts;
    }
    const lat = meilleur.reduce((s, p) => s + p[0], 0) / meilleur.length;
    const lng = meilleur.reduce((s, p) => s + p[1], 0) / meilleur.length;
    const f = { lat, lng, n: meilleur.length };
    await DB.metaSet('foyer', f);
    return f;
  }

  async function oublierFoyer() { await DB.metaSet('foyer', null); }

  // ----------------------------------------------------------
  // Le plus grand domaine d'un seul tenant.
  // C'est LA mesure qui fait dévier d'un parcours habituel : un
  // trou à 300 m coupe le domaine en deux et devient irritant.
  function plusGrandDomaine(cellules) {
    const H = h3();
    const restantes = new Set(cellules);
    let meilleur = [];
    while (restantes.size) {
      const depart = restantes.values().next().value;
      restantes.delete(depart);
      const bloc = [depart];
      const pile = [depart];
      while (pile.length) {
        const c = pile.pop();
        let voisins;
        try { voisins = H.gridDisk(c, 1); } catch (e) { continue; }
        for (const v of voisins) {
          if (restantes.has(v)) {
            restantes.delete(v);
            bloc.push(v);
            pile.push(v);
          }
        }
      }
      if (bloc.length > meilleur.length) meilleur = bloc;
    }
    return meilleur;
  }

  // ----------------------------------------------------------
  // Complétion du rayon : dénominateur exact, pas une estimation.
  function disqueAutour(lat, lng) {
    const H = h3();
    const centre = H.latLngToCell(lat, lng, window.TI.CONFIG.H3_RES);
    const brut = H.gridDisk(centre, K_DISQUE);
    const dedans = [];
    for (const c of brut) {
      const ll = H.cellToLatLng(c);
      if (H.greatCircleDistance([lat, lng], ll, 'm') <= RAYON_M) dedans.push(c);
    }
    return dedans;
  }

  // ----------------------------------------------------------
  // Bilan complet, à afficher
  async function bilan() {
    const H = h3();
    const [cellsRows, f] = await Promise.all([DB.getAll('cells'), foyer()]);
    const cells = new Set(cellsRows.map((c) => c.h3));

    const bloc = plusGrandDomaine(cells);
    let km2 = 0;
    try { km2 = bloc.length * H.cellArea(bloc[0] || '', 'km2'); } catch (e) { km2 = 0; }

    let rayon = null;
    if (f) {
      const disque = disqueAutour(f.lat, f.lng);
      let vues = 0;
      for (const c of disque) if (cells.has(c)) vues++;
      rayon = { total: disque.length, vues,
        pct: disque.length ? (vues / disque.length) * 100 : 0,
        rayonKm: RAYON_M / 1000 };
    }

    return {
      foyer: f,
      domaine: { cellules: bloc.length, km2, total: cells.size,
        eparses: cells.size - bloc.length },
      rayon,
    };
  }

  // ----------------------------------------------------------
  // Les hauts lieux tout proches que tu n'as jamais approchés.
  // Réutilise le cache de secteurs du Lot 2 : aucune requête
  // supplémentaire si la zone a déjà été balayée.
  async function lieuxAConquerir(limite) {
    const f = await foyer();
    if (!f) return [];
    const connus = new Set(await DB.getAllKeys('pois'));
    let candidats = [];
    try {
      candidats = await window.TI.POI.lieuxAutour(f.lat, f.lng, 10000);
    } catch (e) { return []; }

    const H = h3();
    const out = candidats
      .filter((p) => !connus.has(p.id))
      .map((p) => Object.assign({}, p, {
        d: H.greatCircleDistance([f.lat, f.lng], [p.lat, p.lng], 'm'),
      }))
      .sort((a, b) => a.d - b.d);
    return limite ? out.slice(0, limite) : out;
  }

  window.TI.Local = { RAYON_M, foyer, oublierFoyer, bilan, lieuxAConquerir,
    plusGrandDomaine };
})();
