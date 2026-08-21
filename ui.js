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
      const marqueurs = [];
      const mk = (svg, lnglat, cls) => {
        const el = document.createElement('div');
        el.className = 'sea-ornament ' + cls;
        el.innerHTML = svg;
        marqueurs.push(el);
        new maplibregl.Marker({ element: el }).setLngLat(lnglat).addTo(map);
      };
      const E = '#1B2A2F';      // encre de mer
      const V = '#DCE4E2';      // voile

      // --- Le galion : coque hachuree, trois mats, pavillons ---
      mk(`<svg viewBox="0 0 170 130" width="96" height="73">
        <g fill="none" stroke="${E}" stroke-linecap="round" stroke-linejoin="round">
          <g stroke-width="0.9" opacity=".7">
            <path d="M52 84 L20 96 M52 84 L34 60 M96 82 L150 96 M96 82 L128 58"/>
            <path d="M52 30 L96 34 M96 24 L134 44 M52 30 L18 52"/>
          </g>
          <g stroke-width="2">
            <path d="M52 86 V26 M96 84 V20 M132 88 V46"/>
            <path d="M96 84 L162 66"/>
          </g>
          <g fill="${V}" fill-opacity=".5" stroke-width="1.6">
            <path d="M52 34 Q26 44 30 60 Q40 56 52 58 Z"/>
            <path d="M52 62 Q24 74 30 88 Q40 82 52 84 Z"/>
            <path d="M96 28 Q68 40 72 58 Q84 52 96 54 Z"/>
            <path d="M96 58 Q66 72 72 88 Q84 82 96 84 Z"/>
            <path d="M132 50 Q112 60 116 74 Q124 70 132 72 Z"/>
          </g>
          <g stroke-width="0.8" opacity=".6">
            <path d="M31 52 Q41 49 52 50 M31 80 Q41 77 52 78"/>
            <path d="M73 48 Q84 45 96 46 M73 80 Q84 77 96 78"/>
          </g>
          <g stroke-width="1.4" fill="${E}" fill-opacity=".18">
            <path d="M96 20 L114 25 L96 30 Z"/>
            <path d="M52 26 L66 30 L52 34 Z"/>
          </g>
          <path d="M18 92 Q26 88 40 88 L142 88 Q152 88 158 92 Q150 110 128 116 L46 116 Q26 110 18 92 Z"
                fill="${E}" fill-opacity=".14" stroke-width="2.2"/>
          <path d="M142 88 Q150 78 156 80 L158 92" stroke-width="1.8"/>
          <g stroke-width="1.1" opacity=".8">
            <path d="M30 98 L146 98"/>
            <circle cx="52" cy="105" r="2.6"/><circle cx="70" cy="106" r="2.6"/>
            <circle cx="88" cy="106" r="2.6"/><circle cx="106" cy="106" r="2.6"/>
            <circle cx="124" cy="105" r="2.6"/>
          </g>
          <g stroke-width="0.7" opacity=".45">
            <path d="M36 94 L44 114 M48 94 L56 115 M60 94 L68 115 M72 94 L80 115 M84 94 L92 115 M96 94 L104 115 M108 94 L116 115 M120 94 L128 114"/>
          </g>
          <g stroke-width="1.2" opacity=".55">
            <path d="M6 120 q10 -6 20 0 q10 6 20 0 M110 122 q10 -6 20 0 q10 6 20 0"/>
            <path d="M28 126 q12 -5 24 0 M96 128 q12 -5 24 0" opacity=".6"/>
          </g>
        </g></svg>`, [-5.2, 46.6], 'galion');

      // --- Le serpent : anneaux, ecailles, gueule ouverte ---
      mk(`<svg viewBox="0 0 230 105" width="128" height="58">
        <g fill="none" stroke="${E}" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6.6 59.2 L8.7 58.6 L10.8 57.8 L12.8 56.8 L14.8 55.7 L16.9 54.5 L18.9 53.1 L20.9 51.6 L22.8 50.1 L24.8 48.5 L26.8 46.9 L28.7 45.2 L30.6 43.6 L32.6 41.9 L34.5 40.3 L36.4 38.8 L38.2 37.3 L40.1 36.0 L41.1 35.1 L41.8 35.4 L43.4 35.6 L45.0 35.9 L46.7 36.3 L48.3 36.9 L50.0 37.5 L51.7 38.3 L53.3 39.2 L55.0 40.2 L56.8 41.3 L58.5 42.6 L60.2 43.9 L62.0 45.3 L63.8 46.8 L65.5 48.4 L67.3 50.1 L69.1 51.8 L70.9 53.6 L72.7 55.5 L74.6 57.4 L76.4 59.3 L78.2 61.2 L80.1 63.1 L81.9 65.1 L83.8 67.0 L85.7 68.9 L87.6 70.8 L89.5 72.6 L91.4 74.4 L93.3 76.1 L95.3 77.8 L97.3 79.4 L99.2 80.9 L101.3 82.4 L103.3 83.7 L105.4 85.0 L107.5 86.1 L109.7 87.1 L111.8 88.0 L114.1 88.7 L116.3 89.3 L118.6 89.7 L120.9 90.0 L123.2 90.0 L125.6 90.0 L127.9 89.7 L130.2 89.3 L132.5 88.8 L134.8 88.0 L137.0 87.2 L139.3 86.2 L141.5 85.1 L143.6 83.9 L145.8 82.6 L147.9 81.1 L150.0 79.6 L152.0 78.1 L154.1 76.4 L156.1 74.7 L158.1 73.0 L160.1 71.2 L162.1 69.3 L164.1 67.5 L166.0 65.6 L168.0 63.8 L169.9 62.0 L171.8 60.1 L173.7 58.3 L175.6 56.6 L177.5 54.9 L179.3 53.3 L181.2 51.7 L170.8 40.0 L168.9 41.8 L167.0 43.7 L165.0 45.6 L163.2 47.6 L161.3 49.5 L159.4 51.4 L157.6 53.4 L155.7 55.3 L153.9 57.2 L152.1 59.0 L150.3 60.9 L148.5 62.6 L146.8 64.3 L145.0 65.9 L143.3 67.5 L141.6 68.9 L139.9 70.3 L138.2 71.5 L136.6 72.7 L135.0 73.7 L133.4 74.6 L131.8 75.4 L130.3 76.1 L128.8 76.7 L127.3 77.2 L125.9 77.5 L124.4 77.8 L123.0 77.9 L121.5 78.0 L120.1 77.9 L118.6 77.7 L117.0 77.5 L115.5 77.1 L113.9 76.5 L112.3 75.9 L110.6 75.1 L108.9 74.3 L107.2 73.3 L105.4 72.1 L103.6 70.9 L101.8 69.6 L100.0 68.2 L98.2 66.7 L96.3 65.1 L94.4 63.5 L92.5 61.8 L90.6 60.0 L88.7 58.2 L86.8 56.4 L84.9 54.6 L82.9 52.7 L81.0 50.9 L79.0 49.0 L77.1 47.2 L75.1 45.4 L73.1 43.7 L71.1 42.0 L69.1 40.4 L67.1 38.8 L65.1 37.4 L63.1 36.0 L61.0 34.7 L59.0 33.5 L56.9 32.4 L54.8 31.5 L52.7 30.7 L50.6 30.0 L48.4 29.4 L46.3 29.0 L44.2 28.7 L42.0 28.6 L38.9 28.9 L36.2 30.8 L34.2 32.3 L32.3 34.0 L30.4 35.7 L28.6 37.4 L26.7 39.2 L24.8 40.9 L23.0 42.7 L21.2 44.3 L19.4 46.0 L17.6 47.5 L15.8 49.0 L14.0 50.3 L12.3 51.5 L10.5 52.6 L8.8 53.6 L7.1 54.4 L5.4 55.0 Z" fill="${E}" fill-opacity=".17" stroke-width="1.9"/>
          <g stroke-width="1.5"><path d="M13 51 L9 45 M19 46 L14 40 M26 40 L21 34 M33 33 L28 28 M42 29 L42 21 M50 30 L52 23 M58 33 L61 26 M65 38 L70 32 M73 44 L78 38 M80 50 L85 45"/></g>
          <g stroke-width="0.9" opacity=".6"><path d="M80 62 q4 3 8 0 M87 69 q4 3 8 0 M94 75 q4 3 8 0 M101 80 q4 3 8 0 M108 84 q4 3 8 0 M115 86 q4 3 8 0 M122 86 q4 3 8 0 M129 84 q4 3 8 0 M136 80 q4 3 8 0 M143 75 q4 3 8 0 M150 69 q4 3 8 0 M157 62 q4 3 8 0"/></g>
          <path d="M181.2 51.7 Q190.1 46.7 196.6 33.0 Q194.8 27.9 189.0 30.4 Q180.7 39.1 170.8 40.0 Z" fill="${E}" fill-opacity=".24" stroke-width="1.9"/>
          <path d="M175.5 42.3 Q177.7 29.7 188.0 23.2 Q184.7 31.5 176.3 40.2 Z" fill="${E}" fill-opacity=".3" stroke-width="1.6"/>
          <path d="M182.2 48.4 Q191.0 44.6 192.8 37.7" stroke-width="1.1" opacity=".7"/>
          <g stroke-width="1.5"><path d="M185.1 47.1 L186.8 55.0"/><path d="M188.9 43.8 L192.7 51.1"/></g>
          <g stroke-width="1.2" opacity=".8"><path d="M188.5 26.8 L190.5 17.0"/><path d="M192.7 28.5 L198.7 21.7"/></g>
          <circle cx="185.1" cy="42.5" r="1.9" fill="${E}"/>
          <g stroke-width="1.6"><path d="M8 60 q-6 -8 -4 -18 M8 60 q-9 2 -12 10"/></g>
          <g stroke-width="1.3" opacity=".5">
            <path d="M2 88 q11 -6 22 0 q11 6 22 0 q11 -6 22 0"/>
            <path d="M104 90 q11 -6 22 0 q11 6 22 0"/>
            <path d="M44 98 q13 -5 26 0" opacity=".7"/>
          </g>
        </g></svg>`, [4.9, 41.6], 'serpent');

      // --- Le tourbillon : spirale calculee, gouffre au centre ---
      mk(`<svg viewBox="0 0 120 120" width="82" height="82">
        <g fill="none" stroke="${E}" stroke-linecap="round">
          <path d="M61.5 60.0 L62.0 60.3 L62.4 60.7 L62.5 61.3 L62.4 61.9 L62.0 62.5 L61.2 63.1 L60.2 63.6 L58.9 63.9 L57.4 64.0 L55.8 63.8 L54.2 63.3 L52.8 62.6 L51.6 61.6 L50.7 60.4 L50.2 59.0 L50.3 57.4 L50.9 55.9 L52.1 54.4 L53.8 53.1 L56.1 52.0 L58.8 51.3 L61.8 50.9 L64.9 51.1 L68.0 51.7 L71.0 52.8 L73.6 54.3 L75.7 56.3 L77.1 58.6 L77.7 61.1 L77.4 63.8 L76.2 66.4 L74.1 68.8 L71.2 70.9 L67.5 72.6 L63.2 73.8 L58.6 74.3 L53.7 74.1 L48.9 73.2 L44.5 71.5 L40.6 69.2 L37.5 66.4 L35.4 63.0 L34.4 59.4 L34.7 55.6 L36.2 51.9 L39.0 48.5 L43.0 45.4 L48.0 43.0 L53.8 41.3 L60.1 40.5 L66.7 40.6 L73.2 41.7 L79.3 43.8 L84.6 46.7 L88.9 50.4 L91.9 54.7 L93.5 59.4 L93.4 64.3 L91.7 69.2 L88.3 73.7 L83.5 77.8 L77.3 81.0 L70.1 83.4 L62.1 84.6 L53.8 84.7" stroke-width="2.1"/>
          <path d="M50.5 60.0 L50.2 58.5 L50.4 57.0 L51.2 55.5 L52.5 54.0 L54.4 52.8 L56.8 51.8 L59.6 51.1 L62.6 50.9 L65.8 51.2 L68.9 51.9 L71.8 53.2 L74.2 54.8 L76.1 56.9 L77.3 59.3 L77.7 61.9 L77.2 64.5 L75.7 67.1 L73.4 69.4 L70.2 71.5 L66.4 73.0 L62.0 74.0 L57.2 74.3 L52.4 73.9 L47.6 72.8 L43.3 71.0 L39.6 68.5 L36.8 65.5 L35.0 62.0 L34.3 58.4 L35.0 54.6 L36.9 50.9 L40.0 47.6 L44.3 44.7 L49.6 42.4 L55.5 41.0 L62.0 40.4 L68.5 40.8 L74.9 42.2 L80.8 44.5 L85.9 47.7 L89.9 51.5 L92.5 56.0 L93.6 60.8 L93.1 65.7 L90.9 70.5 L87.1 74.9 L81.9 78.8" stroke-width="1.2" opacity=".62"/>
          <g stroke-width="1" opacity=".5">
            <path d="M60 24 q11 5 14 14 M98 58 q-3 12 -13 19 M60 96 q-13 -5 -16 -14 M22 60 q3 -12 13 -18"/>
          </g>
          <ellipse cx="60" cy="60" rx="3.4" ry="2.2" fill="${E}" fill-opacity=".5" stroke="none"/>
          <g stroke-width="1.2" opacity=".45">
            <path d="M4 96 q12 -6 24 0 q12 6 24 0 M70 100 q12 -6 24 0 q12 6 24 0"/>
          </g>
        </g></svg>`, [-8.0, 44.4], 'tourbillon');

      // --- La bete des abysses : tentacules et ventouses ---
      mk(`<svg viewBox="0 0 150 110" width="88" height="65">
        <g fill="none" stroke="${E}" stroke-linecap="round" stroke-linejoin="round">
          <g stroke-width="3">
            <path d="M18 96 Q30 60 56 52 Q78 46 84 24 Q88 10 76 6"/>
            <path d="M60 98 Q66 70 92 62 Q116 54 122 32 Q126 18 116 12"/>
            <path d="M104 100 Q104 82 118 74 Q132 66 132 52"/>
          </g>
          <g stroke-width="1.1" opacity=".7">
            <circle cx="34" cy="76" r="2.2"/><circle cx="48" cy="60" r="2.2"/>
            <circle cx="66" cy="49" r="2"/><circle cx="80" cy="32" r="1.8"/>
            <circle cx="76" cy="80" r="2.2"/><circle cx="96" cy="63" r="2"/>
            <circle cx="114" cy="48" r="1.8"/><circle cx="120" cy="70" r="1.8"/>
          </g>
          <g stroke-width="1.6" fill="${E}" fill-opacity=".18">
            <path d="M83.0 14.0 L82.3 16.7 L80.9 19.0 L78.9 20.7 L76.5 21.6 L74.0 21.8 L71.7 21.2 L69.7 19.9 L68.3 18.1 L67.5 16.1 L67.5 14.0 L68.0 12.1 L69.1 10.4 L70.6 9.3 L72.3 8.7 L74.0 8.7 L75.6 9.2 L76.8 10.1 L77.7 11.3 L78.1 12.7 L78.1 14.0 L77.6 15.2 L76.9 16.1 L76.0 16.7 L75.0 16.9 L74.0 16.9 L73.2 16.5 L72.6 15.9 L72.3 15.2 L72.2 14.6 L72.4 14.0" fill="none" stroke-width="2"/>
            <path d="M110.0 18.0 L110.6 20.4 L111.9 22.4 L113.7 23.9 L115.8 24.7 L118.0 24.8 L120.0 24.3 L121.7 23.1 L123.0 21.6 L123.6 19.8 L123.7 18.0 L123.2 16.3 L122.2 15.0 L120.9 14.0 L119.5 13.5 L118.0 13.5 L116.7 14.0 L115.6 14.8 L114.9 15.8 L114.6 16.9 L114.7 18.0 L115.1 19.0 L115.7 19.7 L116.5 20.1 L117.3 20.3 L118.0 20.1 L118.6 19.8 L119.0 19.4 L119.2 18.8" fill="none" stroke-width="2"/>
          </g>
          <g stroke-width="1.3" opacity=".5">
            <path d="M4 104 q12 -6 24 0 q12 6 24 0 M84 106 q12 -6 24 0 q12 6 24 0"/>
          </g>
        </g></svg>`, [-2.6, 43.3], 'kraken');

      // Les ornements habillent le large : ils se retirent des qu'on approche.
      const visibilite = () => {
        const z = map.getZoom();
        const v = z <= 7.2 ? '' : 'none';
        for (const el of marqueurs) el.style.display = v;
      };
      map.on('zoomend', visibilite);
      visibilite();
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
