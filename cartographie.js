// ============================================================
// cartographie.js — ce qui fait qu'une carte est une carte
// Villes dessinées en petites habitations, reliefs semés sur les
// massifs, noms de massifs à l'encre. Les symboles sont peints au
// canvas puis confiés à MapLibre : aucune police serveur, aucun
// jeu de tuiles à héberger.
// ============================================================
(function () {
  let map = null;
  let villes = [];      // [nom, lat, lng, population]
  let reliefs = null;
  const etiquettes = [];   // marqueurs de villes, recyclés au fil du zoom
  const massifsDOM = [];

  // ----------------------------------------------------------
  // Symboles peints au canvas (encre sépia, trait d'époque)
  function peindre(taille, dessin) {
    const r = Math.ceil(window.devicePixelRatio || 2);
    const c = document.createElement('canvas');
    c.width = c.height = taille * r;
    const x = c.getContext('2d');
    x.scale(r, r);
    x.strokeStyle = '#3A2D1C';
    x.fillStyle = '#3A2D1C';
    x.lineWidth = 1.1;
    x.lineJoin = 'round';
    x.lineCap = 'round';
    dessin(x);
    return { width: c.width, height: c.height,
      data: x.getImageData(0, 0, c.width, c.height).data };
  }

  // Une chaumière : un toit, un mur, rien de plus
  function maison(x, dx, dy, h) {
    const l = h * 0.9;
    x.beginPath();
    x.moveTo(dx - l / 2, dy);
    x.lineTo(dx - l / 2, dy - h * 0.55);
    x.lineTo(dx, dy - h);
    x.lineTo(dx + l / 2, dy - h * 0.55);
    x.lineTo(dx + l / 2, dy);
    x.closePath();
    x.fillStyle = 'rgba(58,45,28,.14)';
    x.fill();
    x.stroke();
  }
  // Une tour : le signe des villes qui comptent
  function tour(x, dx, dy, h) {
    const l = h * 0.44;
    x.beginPath();
    x.rect(dx - l / 2, dy - h, l, h);
    x.fillStyle = 'rgba(58,45,28,.16)';
    x.fill(); x.stroke();
    x.beginPath(); // créneaux
    x.moveTo(dx - l / 2, dy - h);
    x.lineTo(dx - l / 2, dy - h - 2);
    x.lineTo(dx - l / 6, dy - h - 2);
    x.lineTo(dx - l / 6, dy - h);
    x.lineTo(dx + l / 6, dy - h);
    x.lineTo(dx + l / 6, dy - h - 2);
    x.lineTo(dx + l / 2, dy - h - 2);
    x.lineTo(dx + l / 2, dy - h);
    x.stroke();
  }

  function symboles() {
    return {
      // Village : une seule chaumière
      'ti-village': peindre(16, (x) => maison(x, 8, 13, 7)),
      // Bourg : deux chaumières
      'ti-bourg': peindre(22, (x) => { maison(x, 7, 17, 8); maison(x, 15, 17, 6); }),
      // Ville : chaumières et tour
      'ti-ville': peindre(28, (x) => {
        maison(x, 7, 22, 8); tour(x, 15, 22, 13); maison(x, 22, 22, 7);
      }),
      // Cité : muraille, tours, une flèche
      'ti-cite': peindre(36, (x) => {
        maison(x, 8, 28, 8); tour(x, 15, 28, 15); tour(x, 24, 28, 12);
        maison(x, 30, 28, 8);
        x.beginPath(); x.moveTo(15, 13); x.lineTo(15, 9); x.stroke();
      }),
      // Relief : le mont dessiné des cartes anciennes
      'ti-mont': peindre(20, (x) => {
        x.beginPath();
        x.moveTo(2, 15); x.lineTo(7, 6); x.lineTo(10.5, 11);
        x.lineTo(13.5, 5); x.lineTo(18, 15);
        x.closePath();
        x.fillStyle = 'rgba(58,45,28,.13)'; x.fill();
        x.stroke();
        x.beginPath(); // hachures des versants
        x.moveTo(7, 6); x.lineTo(5.5, 11);
        x.moveTo(13.5, 5); x.lineTo(12, 10);
        x.strokeStyle = 'rgba(58,45,28,.55)';
        x.stroke();
      }),
    };
  }

  // ----------------------------------------------------------
  async function charger() {
    // Même numéro de version que les scripts : sans cela, le
    // navigateur ressert obstinément l'ancien jeu de données.
    const v0 = (document.querySelector('script[src*="cartographie.js"]') || {}).src || '';
    const ver = v0.includes('?v=') ? '?v=' + v0.split('?v=')[1] : '';
    const [v, r] = await Promise.all([
      fetch('villes.json' + ver).then((x) => x.json()),
      fetch('reliefs.json' + ver).then((x) => x.json()),
    ]);
    villes = v; reliefs = r;
    indexer();
  }

  // Index spatial : sans lui, chaque mouvement projetterait
  // 18 000 villes — c'est ce qui faisait ramer le zoom.
  const CASE = 0.2;
  const grille = new Map();
  function cle(lat, lng) {
    return Math.floor(lat / CASE) + '_' + Math.floor(lng / CASE);
  }
  function indexer() {
    grille.clear();
    for (const t of villes) {
      const k = cle(t[1], t[2]);
      if (!grille.has(k)) grille.set(k, []);
      grille.get(k).push(t);
    }
  }

  function geoVilles(min, max) {
    return { type: 'FeatureCollection', features: villes
      .filter((t) => t[3] >= min && (max == null || t[3] < max))
      .map((t) => ({ type: 'Feature',
        geometry: { type: 'Point', coordinates: [t[2], t[1]] },
        properties: { nom: t[0], pop: t[3] } })) };
  }

  // ----------------------------------------------------------
  async function poser(carte) {
    map = carte;
    await charger();

    const img = symboles();
    for (const [nom, im] of Object.entries(img)) {
      if (!map.hasImage(nom)) map.addImage(nom, im, { pixelRatio: Math.ceil(window.devicePixelRatio || 2) });
    }

    // Les reliefs se posent sous les villes : le pays d'abord, les hommes ensuite
    map.addSource('reliefs', { type: 'geojson', data: {
      type: 'FeatureCollection', features: reliefs.reliefs.map((p) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [p[1], p[0]] },
        properties: {} })) } });
    map.addLayer({
      id: 'reliefs', type: 'symbol', source: 'reliefs',
      layout: { 'icon-image': 'ti-mont', 'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 5, 0.55, 8, 0.9, 11, 1.15] },
      paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 4.8, 0, 5.6, 0.75, 10, 0.5, 12, 0.18] },
    }, 'dept-fill');

    // Quatre rangs de villes, chacun apparaissant à son échelle
    const rangs = [
      ['villes-cite', 'ti-cite', 150000, null, 4.8],
      ['villes-ville', 'ti-ville', 40000, 150000, 6.2],
      ['villes-bourg', 'ti-bourg', 8000, 40000, 7.6],
      ['villes-village', 'ti-village', 400, 8000, 9.2],
    ];
    for (const [id, icone, min, max, zMin] of rangs) {
      map.addSource(id, { type: 'geojson', data: geoVilles(min, max) });
      map.addLayer({
        id, type: 'symbol', source: id, minzoom: zMin,
        layout: { 'icon-image': icone, 'icon-anchor': 'bottom',
          'icon-allow-overlap': false, 'icon-padding': 2,
          'icon-size': ['interpolate', ['linear'], ['zoom'], zMin, 0.75, zMin + 4, 1] },
        paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'],
          zMin, 0, zMin + 0.7, 0.95] },
      }, 'dept-fill');
    }

    posesMassifs();
    // « moveend » couvre déjà la fin d'un zoom ou d'un déplacement.
    // Écouter « zoom » image par image faisait ramer la carte : les
    // marqueurs suivent tout seuls, seul le choix des noms attend.
    let enFile = null;
    const differer = () => {
      if (enFile) cancelAnimationFrame(enFile);
      enFile = requestAnimationFrame(() => { enFile = null; majEtiquettes(); });
    };
    map.on('moveend', differer);
    map.on('zoomend', differer);
    majEtiquettes();
  }

  // ----------------------------------------------------------
  // Noms de massifs : à l'encre, espacés, comme gravés
  function posesMassifs() {
    for (const [nom, lat, lng] of reliefs.massifs) {
      const el = document.createElement('div');
      el.className = 'massif-label';
      el.textContent = nom;
      massifsDOM.push({ el, marker: new maplibregl.Marker({ element: el })
        .setLngLat([lng, lat]).addTo(map) });
    }
  }

  // ----------------------------------------------------------
  // Étiquettes de villes : seulement celles qui tiennent à l'écran,
  // les plus peuplées d'abord. Recyclées, jamais recréées.
  function majEtiquettes() {
    if (!map) return;
    const z = map.getZoom();
    const seuil = z >= 11.5 ? 400 : z >= 10 ? 4000 : z >= 8.5 ? 15000
      : z >= 7 ? 60000 : z >= 5.8 ? 150000 : 400000;
    const b = map.getBounds();
    const w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();

    // On retient les plus peuplées visibles, puis on écarte celles
    // dont l'étiquette viendrait en chevaucher une autre : sur une
    // carte, deux noms superposés valent moins qu'un seul lisible.
    const pris = [];
    // Candidates : seulement les cases de la grille visibles à l'écran
    const cand = [];
    for (let la = Math.floor(s / CASE); la <= Math.floor(n / CASE); la++) {
      for (let lo = Math.floor(w / CASE); lo <= Math.floor(e / CASE); lo++) {
        const lot = grille.get(la + '_' + lo);
        if (!lot) continue;
        for (const t of lot) if (t[3] >= seuil) cand.push(t);
      }
    }
    cand.sort((a, b) => b[3] - a[3]);
    if (cand.length > 300) cand.length = 300;

    const choisies = [];
    for (const t of cand) {             // les plus peuplées d'abord
      const pt = map.project([t[2], t[1]]);
      const large = t[3] >= 150000;
      const larg = t[0].length * (large ? 8.2 : 5.9) + 10;
      const haut = large ? 20 : 16;
      const r = { x1: pt.x - larg / 2, x2: pt.x + larg / 2,
        y1: pt.y + 2, y2: pt.y + 2 + haut };
      let libre = true;
      for (const o of pris) {
        if (r.x1 < o.x2 && r.x2 > o.x1 && r.y1 < o.y2 && r.y2 > o.y1) { libre = false; break; }
      }
      if (!libre) continue;
      pris.push(r);
      choisies.push(t);
      if (choisies.length >= 40) break;
    }

    for (let i = 0; i < choisies.length; i++) {
      const t = choisies[i];
      let m = etiquettes[i];
      if (!m) {
        const el = document.createElement('div');
        el.className = 'ville-label';
        m = { el, marker: new maplibregl.Marker({ element: el, anchor: 'top' })
          .setLngLat([t[2], t[1]]).addTo(map) };
        etiquettes.push(m);
      }
      m.el.textContent = t[0];
      m.el.className = 'ville-label' + (t[3] >= 150000 ? ' cite' : '');
      m.el.style.display = '';
      m.marker.setLngLat([t[2], t[1]]);
    }
    for (let i = choisies.length; i < etiquettes.length; i++) {
      etiquettes[i].el.style.display = 'none';
    }

    const montrerMassifs = z >= 5.2 && z <= 8.6;
    for (const m of massifsDOM) m.el.style.display = montrerMassifs ? '' : 'none';
  }

  window.TI.Carto = { poser, majEtiquettes };
})();
