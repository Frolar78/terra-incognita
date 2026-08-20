// ============================================================
// lore.js — chroniques des hauts lieux (Lot 2)
// Matériau réel d'abord : résumé Wikipédia (REST) si le lieu en a
// un, sinon recherche géographique à 300 m, sinon les seuls tags
// OSM. Le Worker /lore fait réécrire ce matériau par Claude en
// 3 phrases de chroniqueur médiéval + « Fait d'armes » — sans rien
// inventer. Résultat mis en cache DÉFINITIVEMENT : 1 appel par lieu.
// Attribution CC BY-SA conservée quand Wikipédia est la source.
// ============================================================
(function () {
  const DB = window.TI.DB;
  const C = window.TI.CONFIG;
  const CAP_JOUR = 60; // plafond d'appels Claude par jour (garde-fou)

  function normalize(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  async function wikiSummary(lang, title) {
    const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/` +
      encodeURIComponent(title.replace(/ /g, '_')));
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.extract) return null;
    return {
      texte: j.extract,
      titre: j.title,
      url: (j.content_urls && j.content_urls.desktop && j.content_urls.desktop.page) ||
        `https://${lang}.wikipedia.org/wiki/` + encodeURIComponent(title),
      lang,
    };
  }

  async function geoSearch(poi) {
    try {
      const r = await fetch('https://fr.wikipedia.org/w/api.php?action=query&format=json&origin=*' +
        `&list=geosearch&gscoord=${poi.lat}%7C${poi.lng}&gsradius=300&gslimit=5`);
      const j = await r.json();
      const hits = (j.query && j.query.geosearch) || [];
      const n = normalize(poi.name);
      const best = hits.find((h) => normalize(h.title).includes(n) || n.includes(normalize(h.title)))
        || null;
      return best ? wikiSummary('fr', best.title) : null;
    } catch (e) { return null; }
  }

  // Matériau : résumé encyclopédique + faits sûrs tirés d'OSM
  async function buildMaterial(poi) {
    let wiki = null;
    if (poi.wikipedia) {
      const i = poi.wikipedia.indexOf(':');
      const lang = i > 0 ? poi.wikipedia.slice(0, i) : 'fr';
      const title = i > 0 ? poi.wikipedia.slice(i + 1) : poi.wikipedia;
      try { wiki = await wikiSummary(lang, title); } catch (e) { /* repli plus bas */ }
    }
    if (!wiki) wiki = await geoSearch(poi);

    const faits = [];
    const T = window.TI.POI.TYPES[poi.type];
    faits.push('Type de lieu : ' + (T ? T.nom : poi.type));
    if (poi.ele != null) faits.push('Altitude : ' + Math.round(poi.ele) + ' m');
    if (poi.deptNom) faits.push('Département : ' + poi.deptNom);
    if (poi.commune) faits.push('Commune : ' + poi.commune);
    if (poi.heritage) faits.push('Protégé au titre des monuments historiques');

    const material = (wiki ? wiki.texte + '\n\n' : '') + faits.join('. ') + '.';
    return { material, wiki };
  }

  // Sépare le « Fait d'armes » du corps de la chronique
  function splitFait(text) {
    const m = String(text || '').match(/Fait d'armes\s*:\s*([\s\S]+)$/i);
    if (!m) return { lore: text, fait: null };
    return { lore: text.slice(0, m.index).trim(), fait: m[1].trim() };
  }

  async function ensureLore(poi) {
    if (poi.lore) return poi; // cache définitif : jamais deux appels

    const { material, wiki } = await buildMaterial(poi);
    const src = wiki ? { titre: wiki.titre, url: wiki.url, lang: wiki.lang } : null;

    // Garde-fou quotidien
    const jour = new Date().toISOString().slice(0, 10);
    const compte = await DB.metaGet('loreCalls_' + jour, 0);

    let texte = null;
    if (compte < CAP_JOUR) {
      try {
        const token = await window.TI.Strava.getToken();
        const T = window.TI.POI.TYPES[poi.type];
        const r = await fetch(C.WORKER_URL + '/lore', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, name: poi.name,
            type: T ? T.nom : poi.type, material }),
        });
        if (r.ok) {
          const j = await r.json();
          if (j.lore) {
            texte = j.lore;
            await DB.metaSet('loreCalls_' + jour, compte + 1);
          }
        }
      } catch (e) { /* repli : matériau brut */ }
    }

    if (texte) {
      const s = splitFait(texte);
      poi.lore = s.lore; poi.fait = s.fait;
    } else {
      // Repli honnête : le résumé brut, sans le déguiser en chronique
      poi.lore = wiki ? wiki.texte :
        'Les archives sont muettes sur ce lieu ; seul son nom nous est parvenu.';
      poi.fait = poi.ele != null ? 'Culmine à ' + Math.round(poi.ele) + ' mètres.' : null;
      poi.loreBrut = true;
    }
    poi.loreSrc = src;
    await DB.put('pois', poi);
    return poi;
  }

  window.TI.Lore = { ensureLore };
})();
