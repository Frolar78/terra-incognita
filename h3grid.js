// ============================================================
// h3grid.js — d'une trace GPS à un ensemble de cellules H3
// (interpolation ~50 m + anneau de vision gridDisk rayon 1)
// ============================================================
(function () {
  const C = window.TI.CONFIG;
  const R = 6371000; // rayon terrestre (m)
  const RAD = Math.PI / 180;

  // Distance approchée (équirectangulaire) — largement suffisante
  // pour des segments de quelques centaines de mètres.
  function distM(a, b) {
    const x = (b[1] - a[1]) * RAD * Math.cos(((a[0] + b[0]) / 2) * RAD);
    const y = (b[0] - a[0]) * RAD;
    return R * Math.sqrt(x * x + y * y);
  }

  const Grid = {
    distM,

    // points : [[lat,lng],...]  →  Set d'index H3 (trace + vision)
    traceToCells(points, res) {
      res = res || C.H3_RES;
      const step = C.STEP_M;
      const core = new Set();
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        core.add(h3.latLngToCell(p[0], p[1], res));
        if (i + 1 < points.length) {
          const q = points[i + 1];
          const d = distM(p, q);
          if (d > step) {
            const n = Math.min(Math.ceil(d / step), 400); // borne les GPS aberrants
            for (let k = 1; k < n; k++) {
              const t = k / n;
              core.add(h3.latLngToCell(
                p[0] + (q[0] - p[0]) * t,
                p[1] + (q[1] - p[1]) * t, res));
            }
          }
        }
      }
      // Champ de vision : anneau de voisines
      const all = new Set(core);
      for (const c of core) for (const n of h3.gridDisk(c, 1)) all.add(n);
      return all;
    },

    // Distance totale d'une trace (m) — pour recouper l'info Strava
    traceLength(points) {
      let d = 0;
      for (let i = 1; i < points.length; i++) d += distM(points[i - 1], points[i]);
      return d;
    },
  };

  window.TI.Grid = Grid;
})();
