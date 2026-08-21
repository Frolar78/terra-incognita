// ============================================================
// nuage.js — la sauvegarde qui se fait toute seule
// Le royaume est enregistré chez Cloudflare après chaque
// changement notable, compressé, sous une clé propre à l'athlète.
// Plus de fichier JSON à trimballer entre les appareils.
// ============================================================
(function () {
  const DB = window.TI.DB;
  const C = window.TI.CONFIG;

  const DELAI = 20000;      // on laisse retomber la poussière avant d'écrire
  let enAttente = null;
  let enCours = false;
  let dernier = { ts: 0, octets: 0 };

  // ---------- compression (divise le poids par ~8) ------------
  async function comprimer(texte) {
    if (typeof CompressionStream === 'undefined') return 'brut:' + texte;
    const flux = new Blob([texte]).stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(flux).arrayBuffer();
    let bin = '';
    const oct = new Uint8Array(buf);
    for (let i = 0; i < oct.length; i += 8192) {
      bin += String.fromCharCode.apply(null, oct.subarray(i, i + 8192));
    }
    return 'gz:' + btoa(bin);
  }

  async function decomprimer(charge) {
    if (charge.startsWith('brut:')) return charge.slice(5);
    if (!charge.startsWith('gz:')) return charge; // format ancien
    const bin = atob(charge.slice(3));
    const oct = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) oct[i] = bin.charCodeAt(i);
    const flux = new Blob([oct]).stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(flux).text();
  }

  async function appel(action, data) {
    const token = await window.TI.Strava.getToken();
    const r = await fetch(C.WORKER_URL + '/sauvegarde', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action, data }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }

  // ---------- écriture ----------------------------------------
  async function sauverMaintenant(silencieux) {
    if (enCours) return null;
    enCours = true;
    try {
      const dump = await DB.exportAll();
      const charge = await comprimer(JSON.stringify(dump));
      const j = await appel('ecrire', charge);
      dernier = j.meta || { ts: Date.now(), octets: charge.length };
      await DB.metaSet('nuageTs', dernier.ts);
      return dernier;
    } catch (e) {
      if (!silencieux && window.TI.UI) {
        window.TI.UI.toast('Sauvegarde en ligne impossible : ' + e.message, 6000);
      }
      throw e;
    } finally { enCours = false; }
  }

  // Sauvegarde différée : appelée souvent, n'écrit qu'une fois
  function planifier() {
    if (enAttente) clearTimeout(enAttente);
    enAttente = setTimeout(() => {
      enAttente = null;
      sauverMaintenant(true).catch(() => { /* on réessaiera */ });
    }, DELAI);
  }

  // Si l'app est fermée avant l'échéance, on écrit tout de suite
  function surFermeture() {
    if (!enAttente) return;
    clearTimeout(enAttente); enAttente = null;
    sauverMaintenant(true).catch(() => {});
  }

  // ---------- lecture -----------------------------------------
  async function etat() {
    try { const j = await appel('etat'); return j.meta || null; }
    catch (e) { return null; }
  }

  async function restaurer() {
    const j = await appel('lire');
    if (j.vide) return null;
    const texte = await decomprimer(j.data);
    const dump = JSON.parse(texte);
    await DB.importAll(dump);
    return j.meta || null;
  }

  // Au démarrage : si l'appareil est vierge alors qu'une sauvegarde
  // existe en ligne, on la récupère sans rien demander.
  async function restaurerSiVide() {
    const cells = await DB.getAllKeys('cells');
    if (cells.length > 0) return null;
    const m = await etat();
    if (!m) return null;
    return await restaurer();
  }

  window.TI.Nuage = {
    sauverMaintenant, planifier, surFermeture, etat, restaurer, restaurerSiVide,
    dernierEtat: () => dernier,
  };
})();
