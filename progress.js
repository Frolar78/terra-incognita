// ============================================================
// progress.js — départements, statuts, XP, niveaux
// Les ensembles complets de cellules par département ne sont
// JAMAIS matérialisés : seuls les comptes précalculés
// (data/dept-cell-counts.json) servent de dénominateurs ;
// chaque cellule découverte est affectée à son département par
// point-in-polygon au moment de la découverte.
// ============================================================
(function () {
  const C = window.TI.CONFIG;

  const P = {
    depts: null,        // GeoJSON départements
    counts: null,       // { res, total, counts: {code: n} }
    _index: [],         // [{code, nom, bbox, polys}]
    perDept: new Map(), // code -> nb cellules découvertes
    franceCells: 0,
    xp: 0,

    async load() {
      const [d, c] = await Promise.all([
        fetch('data/departements.geojson').then((r) => r.json()),
        fetch('data/dept-cell-counts.json').then((r) => r.json()),
      ]);
      P.depts = d; P.counts = c;
      for (const f of d.features) {
        const polys = f.geometry.type === 'MultiPolygon'
          ? f.geometry.coordinates : [f.geometry.coordinates];
        let minX = 180, minY = 90, maxX = -180, maxY = -90;
        for (const poly of polys) for (const pt of poly[0]) {
          if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0];
          if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1];
        }
        P._index.push({
          code: f.properties.code, nom: f.properties.nom,
          bbox: [minX, minY, maxX, maxY], polys,
        });
      }
    },

    // --- Point-in-polygon (ray casting, trous inclus) --------
    _inRing(x, y, ring) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
      }
      return inside;
    },

    deptOfPoint(lat, lng) {
      for (const d of P._index) {
        const b = d.bbox;
        if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
        for (const poly of d.polys) {
          if (!P._inRing(lng, lat, poly[0])) continue;
          let inHole = false;
          for (let h = 1; h < poly.length; h++)
            if (P._inRing(lng, lat, poly[h])) { inHole = true; break; }
          if (!inHole) return d;
        }
      }
      return null;
    },

    // --- Comptes ---------------------------------------------
    addCellForDept(code) {
      if (!code) return;
      P.perDept.set(code, (P.perDept.get(code) || 0) + 1);
      P.franceCells += 1;
    },

    deptStats(code) {
      const total = P.counts.counts[code] || 1;
      const found = P.perDept.get(code) || 0;
      const pct = (found / total) * 100;
      return { found, total, pct, statut: P.statusOf(pct) };
    },

    statusOf(pct) {
      for (const t of C.DEPT_TIERS) if (pct >= t.min) return t.statut;
      return 'Terra Incognita';
    },

    francePct() { return (P.franceCells / P.counts.total) * 100; },

    // --- XP et niveaux ---------------------------------------
    xpForActivity(distanceM, elevM, newCells, coeff) {
      return Math.round(
        ((distanceM / 1000) * C.XP_PER_KM + (elevM || 0) / 10 +
         newCells * C.XP_PER_NEW_CELL) * coeff);
    },

    sportCoeff(sportType) {
      return C.SPORT_COEFF[sportType] !== undefined
        ? C.SPORT_COEFF[sportType] : C.SPORT_COEFF_DEFAULT;
    },

    // Coût du niveau n (progressif) ; renvoie {level, cur, next, into}
    levelInfo(xp) {
      let level = 1, cum = 0;
      for (;;) {
        const cost = Math.round(150 * Math.pow(level, 1.8));
        if (xp < cum + cost) return { level, into: xp - cum, next: cost };
        cum += cost; level += 1;
        if (level > 200) return { level: 200, into: 0, next: 1 };
      }
    },

    formatPct(p) {
      if (p === 0) return '0 %';
      if (p < 0.1) return p.toFixed(3).replace('.', ',') + ' %';
      if (p < 1) return p.toFixed(2).replace('.', ',') + ' %';
      return p.toFixed(1).replace('.', ',') + ' %';
    },
  };

  window.TI.Progress = P;
})();
