// ============================================================
// ui.js — HUD, panneaux, journal, réglages, ornements
// ============================================================
(function () {
  const P = window.TI.Progress;
  const $ = (id) => document.getElementById(id);

  const UI = {
    deptMarkers: [],

    // --- Toasts ----------------------------------------------
    toast(msg, ms) {
      const t = $('toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(UI._tt);
      UI._tt = setTimeout(() => t.classList.remove('show'), ms || 4200);
    },

    // --- Bandeau de synchronisation --------------------------
    syncBanner(text) {
      const b = $('sync-banner');
      if (!text) { b.classList.remove('show'); return; }
      b.textContent = text;
      b.classList.add('show');
    },

    // --- HUD -------------------------------------------------
    updateHUD(xp) {
      const li = P.levelInfo(xp);
      $('seal-level').textContent = li.level;
      $('hud-xp-val').textContent =
        `${li.into.toLocaleString('fr-FR')} / ${li.next.toLocaleString('fr-FR')} XP`;
      $('hud-xp-fill').style.width = Math.min(100, (li.into / li.next) * 100) + '%';
      // Le bloc de droite n'est réécrit que s'il affiche bien la France :
      // l'explorateur a pu choisir d'y lire son domaine ou son foyer.
      const lib = $('hud-france-lib');
      if (!lib || lib.textContent === 'France') {
        $('hud-france').textContent = P.formatPct(P.francePct());
      }
      return li;
    },

    updateHUDDept(dept) {
      const el = $('hud-dept');
      if (!dept) { el.classList.add('hidden'); return; }
      const s = P.deptStats(dept.code);
      $('hud-dept-name').textContent = s.pct > 0 ? dept.nom : 'Terra Incognita';
      $('hud-dept-status').textContent = s.statut;
      $('hud-dept-pct').textContent = P.formatPct(s.pct);
      $('hud-dept-fill').style.width = Math.min(100, s.pct * 5) + '%';
      el.classList.remove('hidden');
    },

    // --- Panneau de département (au clic) --------------------
    showDeptPanel(dept) {
      const s = P.deptStats(dept.code);
      $('dp-name').textContent = s.pct > 0 ? dept.nom : 'Terra Incognita';
      $('dp-status').textContent = s.statut;
      $('dp-pct').textContent = P.formatPct(s.pct);
      $('dp-cells').textContent =
        `${s.found.toLocaleString('fr-FR')} cellules arpentées sur ${s.total.toLocaleString('fr-FR')}`;
      $('dp-fill').style.width = Math.min(100, s.pct * 5) + '%';
      $('dept-panel').classList.add('open');
    },

    // --- Onglets et panneaux ---------------------------------
    initTabs() {
      document.querySelectorAll('.tab').forEach((b) => {
        b.addEventListener('click', () => {
          const target = b.dataset.panel;
          document.querySelectorAll('.tab').forEach((x) =>
            x.classList.toggle('active', x === b));
          document.querySelectorAll('.panel').forEach((p) =>
            p.classList.toggle('open', p.id === target));
          $('dept-panel').classList.remove('open');
        });
      });
      document.querySelectorAll('[data-close]').forEach((b) =>
        b.addEventListener('click', () => {
          b.closest('.panel, .sheet').classList.remove('open');
          document.querySelectorAll('.tab').forEach((x) =>
            x.classList.toggle('active', x.dataset.panel === 'panel-carte'));
        }));
    },

    // --- Journal ---------------------------------------------
    renderJournal(entries) {
      const box = $('journal-list');
      if (!entries.length) {
        box.innerHTML = '<p class="empty">Le journal est vierge. Lance une synchronisation pour y consigner tes explorations.</p>';
        return;
      }
      box.innerHTML = '';
      for (const e of entries.slice().reverse().slice(0, 300)) {
        const div = document.createElement('div');
        div.className = 'journal-entry ' + (e.type || '');
        const d = new Date(e.date);
        div.innerHTML = `<span class="j-date">${d.toLocaleDateString('fr-FR')}</span>
          <span class="j-text"></span>`;
        div.querySelector('.j-text').textContent = e.text;
        box.appendChild(div);
      }
    },

    // --- Étiquettes calligraphiées des départements ----------
    buildDeptLabels(map) {
      for (const d of P._index) {
        const el = document.createElement('div');
        el.className = 'dept-label';
        const b = d.bbox;
        const m = new maplibregl.Marker({ element: el })
          .setLngLat([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2])
          .addTo(map);
        UI.deptMarkers.push({ marker: m, dept: d, el });
      }
      const vis = () => {
        const z = map.getZoom();
        const show = z >= 6.4 && z <= 9.2;
        for (const { el } of UI.deptMarkers)
          el.style.display = show ? '' : 'none';
      };
      map.on('zoom', vis); vis();
      UI.updateDeptLabels();
    },

    updateDeptLabels() {
      for (const { dept, el } of UI.deptMarkers) {
        const s = P.deptStats(dept.code);
        if (s.pct <= 0) {
          el.textContent = 'hic sunt dracones';
          el.classList.add('unknown');
        } else {
          el.textContent = dept.nom;
          el.classList.remove('unknown');
          el.classList.toggle('conquered', s.statut === 'Conquis');
        }
      }
    },

    // --- Ornements de mer (galion + serpent) -----------------
    addSeaOrnaments(map) {
      const mk = (svg, lnglat, cls) => {
        const el = document.createElement('div');
        el.className = 'sea-ornament ' + cls;
        el.innerHTML = svg;
        new maplibregl.Marker({ element: el }).setLngLat(lnglat).addTo(map);
      };
      // Galion à l'encre, golfe de Gascogne
      mk(`<svg viewBox="0 0 120 90" width="74" height="55">
        <g fill="none" stroke="#1C2A2E" stroke-width="2" stroke-linecap="round">
          <path d="M18 62 Q60 74 102 60 L94 74 Q60 84 26 74 Z" fill="#1C2A2E" fill-opacity=".10"/>
          <path d="M18 62 Q60 74 102 60"/>
          <path d="M26 74 Q60 84 94 74"/>
          <path d="M45 62 V20 M75 60 V14"/>
          <path d="M45 22 Q28 32 45 44 Z" fill="#DCE4E2" fill-opacity=".55"/>
          <path d="M75 16 Q56 28 75 42 Z" fill="#DCE4E2" fill-opacity=".55"/>
          <path d="M75 16 L86 20" stroke-width="1.6"/>
          <path d="M8 70 q6 -4 12 0 q6 4 12 0 M88 76 q6 -4 12 0" stroke-width="1.4" opacity=".7"/>
        </g></svg>`, [-4.6, 46.1], 'galion');
      // Serpent de mer, Méditerranée
      mk(`<svg viewBox="0 0 140 70" width="86" height="43">
        <g fill="none" stroke="#1C2A2E" stroke-width="2.4" stroke-linecap="round">
          <path d="M8 46 q14 -26 28 0 t28 0 t28 0 t28 0" />
          <path d="M120 46 q8 -14 14 -6 q-2 8 -12 10 M124 38 l6 -10" stroke-width="2"/>
          <circle cx="129" cy="37" r="1.6" fill="#1C2A2E"/>
          <path d="M22 34 l4 -8 M50 34 l4 -8 M78 34 l4 -8" stroke-width="1.6" opacity=".8"/>
          <path d="M4 58 q8 -5 16 0 M116 60 q8 -5 16 0" stroke-width="1.3" opacity=".6"/>
        </g></svg>`, [5.6, 42.35], 'serpent');
    },

    // --- Écrans de vie ---------------------------------------
    hideLoading() {
      const l = $('loading');
      l.classList.add('done');
      setTimeout(() => l.remove(), 1600);
    },
    showConnect(show) {
      $('connect').classList.toggle('hidden', !show);
    },
    showFatal(msg) {
      const l = $('loading');
      l.querySelector('.load-hint').textContent = msg;
      l.classList.add('fatal');
    },
  };

  window.TI.UI = UI;
})();
