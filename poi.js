// ============================================================
// poi.js — hauts lieux du royaume (Lot 2)
// 1. Repérage : requêtes Overpass par tuiles (~10 km) le long des
//    corridors d'activités, cache définitif par tuile (les
//    forteresses ne déménagent pas).
// 2. Classification : tags OSM -> types médiévaux.
// 3. Découverte : trace passée à moins de DISCOVER_M du lieu.
// 4. Rareté : wikidata / nb de langues Wikipédia / patrimoine /
//    altitude -> Commun … Légendaire, avec XP à la clé.
// ============================================================
(function () {
  const DB = window.TI.DB;

  const DISCOVER_M = 150;          // distance de découverte (m)
  const TILE_DEG = 0.09;           // ~10 km en latitude
  const THROTTLE_MS = 1100;        // politesse Overpass : 1 requête/s max
  const ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  // Icônes dessinées au trait — un caractère typographique employé
  // comme pictogramme trahit toujours l'amateurisme.
  const ico = (d) => '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const TYPES = {
    forteresse: { nom: 'Forteresse', glyphe: ico(
      '<path d="M5 21V9l3-2 4 2 4-2 3 2v12z"/><path d="M9 21v-5h6v5"/>' +
      '<path d="M5 9V5h3v2M16 7V5h3v4"/>') },
    tour: { nom: 'Tour de guet', glyphe: ico(
      '<path d="M8 21V8l4-4 4 4v13z"/><path d="M8 8h8"/><path d="M11 21v-5h2v5"/>' +
      '<path d="M12 4V2"/>') },
    sanctuaire: { nom: 'Sanctuaire', glyphe: ico(
      '<path d="M12 3v18M7 8h10"/><path d="M6 21h12"/>') },
    vestiges: { nom: 'Vestiges', glyphe: ico(
      '<path d="M4 21V10l3 2V7l4 3V6l4 4V9l5 3v9z"/><path d="M9 21v-4M15 21v-3"/>') },
    cime: { nom: 'Cime', glyphe: ico(
      '<path d="M3 19l6-11 4 6 2.5-3.5L21 19z"/><path d="M9 8l1.5 2.5"/>') },
    caverne: { nom: 'Caverne', glyphe: ico(
      '<path d="M3 21V13a9 9 0 0118 0v8"/><path d="M9 21v-4a3 3 0 016 0v4"/>') },
    fanal: { nom: 'Fanal', glyphe: ico(
      '<path d="M9 9h6l1 12H8z"/><path d="M10 9V5h4v4"/><path d="M12 2v1"/>' +
      '<path d="M4 7l2 1M20 7l-2 1"/>') },
    cascade: { nom: 'Cascade', glyphe: ico(
      '<path d="M4 4c3 0 3 3 6 3s3-3 6-3 4 2 4 2"/>' +
      '<path d="M7 9v11M12 9v11M17 9v11"/>') },
  };
  const RARETES = ['Commun', 'Peu commun', 'Rare', 'Épique', 'Légendaire'];
  const RARETE_XP = [20, 40, 80, 150, 300];

  // ----------------------------------------------------------
  // Classification tags OSM -> type médiéval (null = sans intérêt)
  function classify(t) {
    if (!t || !t.name) return null;
    const h = t.historic || '';
    if (/^(castle|fort|citywalls|city_gate|manor)$/.test(h)) return 'forteresse';
    if (h === 'tower') return 'tour';
    if (t.man_made === 'tower' &&
        /^(observation|watchtower|defensive)$/.test(t['tower:type'] || '')) return 'tour';
    if (/^(ruins|archaeological_site)$/.test(h)) return 'vestiges';
    if (/^(monastery|abbey|wayside_shrine|chapel|church|hermitage)$/.test(h)) return 'sanctuaire';
    if (t.amenity === 'place_of_worship') return 'sanctuaire';
    if (/^(church|chapel|cathedral|basilica)$/.test(t.building || '')) return 'sanctuaire';
    if (/^(peak|volcano)$/.test(t.natural || '')) return 'cime';
    if (t.natural === 'cave_entrance') return 'caverne';
    if (t.man_made === 'lighthouse') return 'fanal';
    if (t.waterway === 'waterfall') return 'cascade';
    return null;
  }

  // ----------------------------------------------------------
  // Tuiles couvrant une trace (avec marge d'une tuile près des bords)
  function tileOf(lat, lng) {
    return Math.floor(lat / TILE_DEG) + '_' + Math.floor(lng / TILE_DEG);
  }
  function tilesForTrace(pts) {
    const m = DISCOVER_M / 111000; // marge en degrés
    const set = new Set();
    for (const p of pts) {
      set.add(tileOf(p[0], p[1]));
      set.add(tileOf(p[0] + m, p[1])); set.add(tileOf(p[0] - m, p[1]));
      set.add(tileOf(p[0], p[1] + m)); set.add(tileOf(p[0], p[1] - m));
    }
    return set;
  }

  // ----------------------------------------------------------
  // Overpass : une tuile = une requête, cache définitif en base
  let lastCall = 0;
  async function fetchTile(key) {
    const cached = await DB.get('poitiles', key);
    if (cached) return cached.pois;

    const [ty, tx] = key.split('_').map(Number);
    const S = (ty * TILE_DEG).toFixed(5), N = ((ty + 1) * TILE_DEG).toFixed(5);
    const W = (tx * TILE_DEG).toFixed(5), E = ((tx + 1) * TILE_DEG).toFixed(5);
    const bb = `(${S},${W},${N},${E})`;
    const q = `[out:json][timeout:25];(
      nwr["historic"~"^(castle|fort|tower|ruins|archaeological_site|monastery|abbey|city_gate|citywalls|wayside_shrine|chapel|church|manor|hermitage)$"]["name"]${bb};
      nwr["man_made"="lighthouse"]["name"]${bb};
      nwr["man_made"="tower"]["tower:type"~"^(observation|watchtower|defensive)$"]["name"]${bb};
      node["natural"~"^(peak|volcano)$"]["name"]${bb};
      node["natural"="cave_entrance"]["name"]${bb};
      nwr["building"~"^(church|chapel|cathedral|basilica)$"]["name"]${bb};
      nwr["amenity"="place_of_worship"]["name"]${bb};
      nwr["waterway"="waterfall"]["name"]${bb};
    );out center tags;`;

    // Politesse : jamais plus d'une requête par seconde
    const wait = lastCall + THROTTLE_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();

    // Deux tournées sur les deux miroirs : les secteurs denses
    // (Paris, Lyon…) font souvent saturer la première tentative.
    let data = null, lastErr = null;
    for (let tour = 0; tour < 2 && !data; tour++) {
      if (tour) await new Promise((r) => setTimeout(r, 3000));
      for (const ep of ENDPOINTS) {
        try {
          const r = await fetch(ep, { method: 'POST', body: 'data=' + encodeURIComponent(q),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
          if (r.status === 429 || r.status === 504) { lastErr = new Error('Overpass saturé'); continue; }
          if (!r.ok) { lastErr = new Error('Overpass HTTP ' + r.status); continue; }
          data = await r.json(); break;
        } catch (e) { lastErr = e; }
      }
    }
    if (!data) throw lastErr || new Error('Overpass injoignable');

    const pois = [];
    const seen = new Set();
    for (const el of data.elements || []) {
      const t = el.tags || {};
      const type = classify(t);
      if (!type) continue;
      const id = el.type + '/' + el.id;
      if (seen.has(id)) continue;
      seen.add(id);
      const lat = el.lat != null ? el.lat : (el.center && el.center.lat);
      const lng = el.lon != null ? el.lon : (el.center && el.center.lon);
      if (lat == null) continue;
      pois.push({
        id, type, name: t.name, lat, lng,
        ele: t.ele ? parseFloat(t.ele) : null,
        wikidata: t.wikidata || null,
        wikipedia: t.wikipedia || null,
        heritage: !!(t.heritage || t['ref:mhs'] || t['mhs:inscription_date']),
        commune: t['addr:city'] || null,
      });
    }
    await DB.put('poitiles', { key, ts: Date.now(), pois });
    return pois;
  }

  // ----------------------------------------------------------
  // Distance (m) d'un point à un segment, approx. équirectangulaire
  function distPointSeg(la, lo, la1, lo1, la2, lo2) {
    const kx = 111320 * Math.cos(la * Math.PI / 180), ky = 110540;
    const x = (lo - lo1) * kx, y = (la - la1) * ky;
    const dx = (lo2 - lo1) * kx, dy = (la2 - la1) * ky;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? (x * dx + y * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const ex = x - t * dx, ey = y - t * dy;
    return Math.sqrt(ex * ex + ey * ey);
  }
  function nearTrace(poi, pts) {
    // Préfiltre grossier puis distance exacte aux segments proches
    const m = (DISCOVER_M + 60) / 111000;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (Math.max(a[0], b[0]) < poi.lat - m || Math.min(a[0], b[0]) > poi.lat + m ||
          Math.max(a[1], b[1]) < poi.lng - m * 2 || Math.min(a[1], b[1]) > poi.lng + m * 2) continue;
      if (distPointSeg(poi.lat, poi.lng, a[0], a[1], b[0], b[1]) <= DISCOVER_M) return true;
    }
    return false;
  }

  // ----------------------------------------------------------
  // Rareté : wikidata +1, patrimoine +1, langues Wikipédia (≥8 +1,
  // ≥25 +1), altitude (≥1200 +1, ≥2200 +1) — plafonné à Légendaire.
  async function sitelinksCounts(qids) {
    const out = {};
    for (let i = 0; i < qids.length; i += 50) {
      const lot = qids.slice(i, i + 50);
      try {
        const r = await fetch('https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&origin=*' +
          '&props=sitelinks&ids=' + lot.join('|'));
        const j = await r.json();
        for (const q of lot) {
          const e = j.entities && j.entities[q];
          const sl = e && e.sitelinks ? e.sitelinks : {};
          const langs = Object.keys(sl).filter((k) => k.endsWith('wiki'));
          out[q] = { n: langs.length, fr: sl.frwiki ? sl.frwiki.title : null,
                     en: sl.enwiki ? sl.enwiki.title : null };
        }
      } catch (e) { /* la rareté restera calculée sans les langues */ }
    }
    return out;
  }
  function rarete(poi, langues) {
    let s = 0;
    if (poi.wikidata) s++;
    if (poi.heritage) s++;
    if (langues >= 8) s++;
    if (langues >= 25) s++;
    if (poi.ele != null && poi.ele >= 1200) s++;
    if (poi.ele != null && poi.ele >= 2200) s++;
    return Math.min(4, s);
  }

  // ----------------------------------------------------------
  // Rareté + persistance d'une fournée de lieux (une sortie)
  async function finalize(lot) {
    if (!lot.length) return [];
    const P = window.TI.Progress;
    const qids = lot.filter((p) => p.wikidata).map((p) => p.wikidata);
    let links = {};
    try { links = qids.length ? await sitelinksCounts(qids) : {}; }
    catch (e) { /* la rareté se calculera sans le compte de langues */ }
    for (const p of lot) {
      const l = p.wikidata && links[p.wikidata] ? links[p.wikidata] : null;
      if (l && !p.wikipedia) p.wikipedia = l.fr ? 'fr:' + l.fr : (l.en ? 'en:' + l.en : null);
      p.rarete = rarete(p, l ? l.n : 0);
      p.xp = RARETE_XP[p.rarete];
      const d = P.deptOfPoint(p.lat, p.lng);
      p.dept = d ? d.code : null;
      p.deptNom = d ? d.nom : null;
      p.lore = null; p.loreSrc = null; p.fait = null;
      await DB.put('pois', p);
    }
    return lot;
  }

  // ----------------------------------------------------------
  // Balayage : activités jamais passées au crible des hauts lieux
  // Règle d'or : on n'enregistre JAMAIS une sortie comme balayée
  // avant d'avoir sauvegardé ses trouvailles, et une tuile en échec
  // ne fait pas tomber tout le balayage — la sortie est simplement
  // laissée en attente pour la prochaine fois.
  let scanning = false;
  async function scanPending(onMsg) {
    if (scanning) return [];
    scanning = true;
    const say = onMsg || (() => {});
    try {
      const acts = (await DB.getAll('activities')).filter((a) => !a.poiScanned && a.poly);
      if (!acts.length) return [];
      const Strava = window.TI.Strava;
      const known = new Set(await DB.getAllKeys('pois'));
      const total = [];
      let echecs = 0;

      for (let i = 0; i < acts.length; i++) {
        const a = acts[i];
        const pts = Strava.decodePolyline(a.poly);
        const lot = [];
        let complet = true;

        if (pts.length >= 2) {
          const tiles = tilesForTrace(pts);
          let done = 0;
          for (const key of tiles) {
            say(`Repérage des hauts lieux — sortie ${i + 1}/${acts.length}, ` +
              `secteur ${++done}/${tiles.size}…`);
            let pois;
            try {
              pois = await fetchTile(key);
            } catch (e) {
              // Cartothèque saturée : on note et on continue, la sortie
              // restera en attente et sera reprise plus tard.
              complet = false; echecs++;
              continue;
            }
            for (const poi of pois) {
              if (known.has(poi.id)) continue;
              if (!nearTrace(poi, pts)) continue;
              known.add(poi.id);
              lot.push(Object.assign({}, poi, { act: a.id, foundDate: a.date }));
            }
          }
        }

        // 1. Sauvegarder les trouvailles AVANT toute chose
        try {
          await finalize(lot);
          total.push.apply(total, lot);
        } catch (e) {
          // Rien n'est perdu : la sortie reste en attente
          for (const p of lot) known.delete(p.id);
          complet = false;
          continue;
        }

        // 2. Seulement alors, marquer la sortie comme balayée
        if (complet) {
          a.poiScanned = true;
          await DB.put('activities', a);
        }
      }

      return total;
    } finally { scanning = false; }
  }

  // Combien de sorties restent à passer au crible
  async function pendingCount() {
    const acts = await DB.getAll('activities');
    return acts.filter((a) => !a.poiScanned && a.poly).length;
  }

  // Remet toutes les sorties en attente (le cache des tuiles rend
  // le nouveau balayage quasi instantané et sans requête réseau).
  async function resetScan() {
    const acts = await DB.getAll('activities');
    for (const a of acts) {
      if (a.poiScanned) { delete a.poiScanned; await DB.put('activities', a); }
    }
    return acts.length;
  }

  window.TI.POI = { TYPES, RARETES, RARETE_XP, DISCOVER_M,
    scanPending, pendingCount, resetScan };
})();
