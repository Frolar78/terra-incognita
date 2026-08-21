// ============================================================
// codex.js — le Codex des lieux (Lot 2)
// La collection : compteurs par rareté, filtres par type, cartes
// classées (rareté décroissante puis date), fiche parchemin avec
// chronique du chroniqueur — et les marqueurs des lieux découverts
// posés sur la carte (DOM markers, aucun glyphe serveur requis).
// ============================================================
(function () {
  const DB = window.TI.DB;
  const $ = (id) => document.getElementById(id);

  const COULEURS = ['#8C8371', '#6E8A55', '#4E7FA8', '#8E6BA8', '#D8B03C'];
  const ZOOM_MIN = 8.4;   // en deçà, les médaillons se marchent dessus

  let map = null;
  let markers = [];
  let filtre = 'tous';
  let pois = [];
  let masque = false;      // masquage temporaire (cinématique)
  let choixUtilisateur = true; // préférence durable : montrer les lieux ?

  // Les marqueurs n'apparaissent qu'à un zoom où ils sont lisibles.
  // Les Légendaires et Épiques restent visibles un cran plus tôt :
  // ce sont des repères, pas du bruit.
  function appliquerVisibilite() {
    if (!map) return;
    const z = map.getZoom();
    for (const m of markers) {
      const r = m._tiRarete || 0;
      const seuil = r >= 3 ? ZOOM_MIN - 1.6 : ZOOM_MIN;
      const el = m.getElement();
      el.style.display = (choixUtilisateur && !masque && z >= seuil) ? '' : 'none';
    }
    const b = document.getElementById('btn-poi-toggle');
    if (b) {
      b.classList.toggle('eteint', !choixUtilisateur);
      b.setAttribute('aria-pressed', String(choixUtilisateur));
      b.title = choixUtilisateur ? 'Masquer les hauts lieux' : 'Montrer les hauts lieux';
    }
  }

  // Préférence durable, conservée d'une session à l'autre
  async function chargerChoix() {
    choixUtilisateur = await DB.metaGet('poiVisibles', true);
    appliquerVisibilite();
  }
  async function basculer() {
    choixUtilisateur = !choixUtilisateur;
    await DB.metaSet('poiVisibles', choixUtilisateur);
    appliquerVisibilite();
    return choixUtilisateur;
  }

  function setVisible(v) { masque = !v; appliquerVisibilite(); }

  function tri(a, b) {
    if (b.rarete !== a.rarete) return b.rarete - a.rarete;
    return new Date(b.foundDate) - new Date(a.foundDate);
  }

  function renderStats() {
    const el = $('codex-stats');
    if (!el) return;
    if (!pois.length) { el.innerHTML = ''; return; }
    const par = [0, 0, 0, 0, 0];
    for (const p of pois) par[p.rarete]++;
    el.innerHTML =
      `<span class="cx-total">${pois.length} lieu${pois.length > 1 ? 'x' : ''} au Codex</span>` +
      par.map((n, i) => n ?
        `<span class="cx-pastille" style="--rc:${COULEURS[i]}" ` +
        `title="${window.TI.POI.RARETES[i]}">${n}</span>` : '').join('');
    el.querySelectorAll('.cx-total').forEach(() => {});
  }

  function renderFiltres() {
    const el = $('codex-filtres');
    if (!el) return;
    const types = [...new Set(pois.map((p) => p.type))];
    if (!types.length) { el.innerHTML = ''; return; }
    const T = window.TI.POI.TYPES;
    let h = `<button class="cx-filtre${filtre === 'tous' ? ' actif' : ''}" data-f="tous">Tous</button>`;
    for (const t of types) {
      h += `<button class="cx-filtre${filtre === t ? ' actif' : ''}" data-f="${t}">` +
        `${T[t].glyphe}<span>${T[t].nom}</span></button>`;
    }
    el.innerHTML = h;
    el.querySelectorAll('.cx-filtre').forEach((b) =>
      b.addEventListener('click', () => { filtre = b.dataset.f; render(); }));
  }

  function renderGrille() {
    const g = $('codex-grille'), vide = $('codex-vide');
    if (!g) return;
    const liste = pois.filter((p) => filtre === 'tous' || p.type === filtre).sort(tri);
    if (vide) vide.style.display = pois.length ? 'none' : '';
    const T = window.TI.POI.TYPES, R = window.TI.POI.RARETES;
    g.innerHTML = liste.map((p) => `
      <div class="cx-carte" data-id="${p.id}" style="--rc:${COULEURS[p.rarete]}">
        <div class="cx-glyphe">${T[p.type].glyphe}</div>
        <div class="cx-nom">${p.name}</div>
        <div class="cx-meta">
          <span class="cx-rarete">${R[p.rarete]}</span>
          <i class="cx-pt"></i><span>${T[p.type].nom}${
            p.ele != null ? ' · ' + Math.round(p.ele) + ' m' : ''}</span>
        </div>
      </div>`).join('');
    g.querySelectorAll('.cx-carte').forEach((c) =>
      c.addEventListener('click', () => {
        const p = pois.find((x) => x.id === c.dataset.id);
        if (p) openFiche(p);
      }));
  }

  function render() { renderStats(); renderFiltres(); renderGrille(); }

  // --------------------------------------------------------
  // Marqueurs sur la carte
  function renderMarkers() {
    for (const m of markers) m.remove();
    markers = [];
    if (!map) return;
    const T = window.TI.POI.TYPES;
    for (const p of pois) {
      const el = document.createElement('div');
      el.className = 'poi-marker';
      el.style.setProperty('--rc', COULEURS[p.rarete]);
      el.innerHTML = T[p.type].glyphe;
      el.title = p.name;
      el.addEventListener('click', (e) => { e.stopPropagation(); openFiche(p); });
      const mk = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([p.lng, p.lat]).addTo(map);
      mk._tiRarete = p.rarete || 0;
      markers.push(mk);
    }
    appliquerVisibilite();
  }

  // --------------------------------------------------------
  // Fiche parchemin
  async function openFiche(p) {
    const f = $('poi-fiche');
    if (!f) return;
    const T = window.TI.POI.TYPES, R = window.TI.POI.RARETES;
    f.style.setProperty('--rc', COULEURS[p.rarete]);
    f.querySelector('.fiche-glyphe').innerHTML = T[p.type].glyphe;
    f.querySelector('.fiche-nom').textContent = p.name;
    const sous = [T[p.type].nom, R[p.rarete]];
    if (p.deptNom) sous.push(p.deptNom);
    if (p.ele != null) sous.push(Math.round(p.ele) + ' m');
    f.querySelector('.fiche-sous').textContent = sous.join(' · ');
    f.querySelector('.fiche-lore').innerHTML =
      '<span class="fiche-attente">Le chroniqueur consulte les archives…</span>';
    f.querySelector('.fiche-fait').textContent = '';
    f.querySelector('.fiche-attrib').innerHTML = '';
    f.classList.remove('hidden');

    try {
      p = await window.TI.Lore.ensureLore(p);
    } catch (e) {
      p.lore = 'Les archives sont hors d\u2019atteinte pour l\u2019heure — reviens plus tard.';
    }
    // La fiche a pu être fermée entre-temps
    if (f.classList.contains('hidden')) return;
    f.querySelector('.fiche-lore').textContent = p.lore || '';
    f.querySelector('.fiche-fait').textContent = p.fait ? '⚔ Fait d\u2019armes : ' + p.fait : '';
    f.querySelector('.fiche-attrib').innerHTML = p.loreSrc
      ? `Source : <a href="${p.loreSrc.url}" target="_blank" rel="noopener">` +
        `Wikipédia — ${p.loreSrc.titre}</a> (CC BY-SA)` +
        (p.loreBrut ? ' · résumé brut' : '')
      : 'Source : carte OpenStreetMap';
  }

  function init(m) {
    map = m;
    map.on('zoom', appliquerVisibilite);
    chargerChoix();
    const f = $('poi-fiche');
    if (f) {
      f.addEventListener('click', (e) => { if (e.target === f) f.classList.add('hidden'); });
      const btn = $('fiche-fermer');
      if (btn) btn.addEventListener('click', () => f.classList.add('hidden'));
    }
  }

  async function refresh() {
    pois = await DB.getAll('pois');
    render();
    renderMarkers();
  }

  window.TI.Codex = { init, refresh, openFiche, setVisible, basculer, chargerChoix };
})();
