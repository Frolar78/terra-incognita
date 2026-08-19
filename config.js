// ============================================================
// TERRA INCOGNITA — configuration
// Les deux valeurs ci-dessous sont à remplir (voir README.md).
// ============================================================
window.TI = window.TI || {};
window.TI.CONFIG = {
  // ID client de TON application Strava (portail développeur Strava)
  STRAVA_CLIENT_ID: 'REMPLACE_MOI',

  // URL de TON Worker Cloudflare, sans / final
  // ex. 'https://terra-incognita.jean-dupont.workers.dev'
  WORKER_URL: 'REMPLACE_MOI',

  // Résolution H3 (9 = cellules d'environ 0,1 km²). Ne change pas
  // cette valeur sans recalculer data/dept-cell-counts.json.
  H3_RES: 9,

  // Espacement d'interpolation le long des traces (mètres)
  STEP_M: 50,

  // Emprise de la carte [ouest, sud, est, nord] — interchangeable
  // pour brancher un autre pays plus tard.
  BBOX: [-5.9, 41.0, 10.2, 51.6],

  // Coefficients d'exploration par sport (multiplient l'XP,
  // jamais la révélation elle-même)
  SPORT_COEFF: {
    Run: 1.0, TrailRun: 1.0, VirtualRun: 1.0,
    Hike: 0.9, Walk: 0.9, Snowshoe: 0.9,
    Ride: 0.5, GravelRide: 0.5, MountainBikeRide: 0.5,
    EBikeRide: 0.5, VirtualRide: 0.5,
  },
  SPORT_COEFF_DEFAULT: 0.7,

  // XP : distance(km)*10 + D+(m)/10 + bonus*cellules inédites,
  // le tout multiplié par le coefficient de sport
  XP_PER_KM: 10,
  XP_PER_NEW_CELL: 5,

  // Paliers de statut des départements (% de cellules découvertes).
  // Volontairement bas : à res 9, arpenter 20 % d'un département
  // représente des années d'exploration.
  DEPT_TIERS: [
    { min: 20,  statut: 'Conquis' },
    { min: 8,   statut: 'Domaine familier' },
    { min: 2,   statut: 'Territoire arpenté' },
    { min: 1e-9, statut: 'Terres inconnues' },
    { min: 0,   statut: 'Terra Incognita' },
  ],
};
