// ============================================================
// fog.js — brouillard de guerre
// Principe de rendu (jamais d'opérations booléennes vectorielles) :
//   1. nappe de fumée gris-violet : fond + deux textures de bruit
//      fractal tuilables qui dérivent lentement en sens opposés ;
//   2. masque : les hexagones révélés sont rasterisés dans un
//      canvas hors écran, flouté pour l'effilochage, puis
//      soustrait de la nappe (destination-out) ;
//   3. liseré doré : halo = masque flouté moins masque net, teinté or.
// Le masque n'est recalculé qu'au moveend / resize / après sync ;
// la dérive de la fumée ne fait que recomposer des drawImage.
// ============================================================
(function () {
  const COL_CORE = '110,101,122';  // #6E657A cœur de brume (clair)
  const COL_EDGE = '152,142,158';  // #988E9E lisière (plus claire encore)
  const GOLD = '227,179,65';       // #E3B341 liseré
  const FOG_ALPHA = 0.55;          // voile : la carte reste lisible dessous
  const REVEAL_LIGHT = 0.10;       // clarté ajoutée sur les terres révélées
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function mercX(lng) { return (lng + 180) / 360; }
  function mercY(lat) {
    const s = Math.sin(lat * Math.PI / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }

  class Fog {
    constructor(map) {
      this.map = map;
      this.cells = new Set();
      this.pts = new Map();          // h3 -> [lat, lng] (cache)
      this.newCells = null;          // cellules en cours de dissipation
      this.newAlpha = 1;
      this.dpr = Math.min(devicePixelRatio || 1, 1.5);
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.maskSharp = document.createElement('canvas');
      this.maskBlur = document.createElement('canvas');
      this.rim = document.createElement('canvas');
      this.glow = document.createElement('canvas');
      this.tex1 = null; this.tex2 = null;
      this.o1 = 0; this.o2 = 0;
      this._raf = null; this._last = 0;
    }

    async attach() {
      const load = (src) => new Promise((res, rej) => {
        const i = new Image(); i.onload = () => res(i);
        i.onerror = rej; i.src = src;
      });
      [this.tex1, this.tex2] = await Promise.all([
        load('brume1.png'),
        load('brume2.png'),
      ]);
      this._resize();
      this.map.addSource('fog', {
        type: 'canvas', canvas: this.canvas,
        coordinates: this._quad(), animate: true,
      });
      this.map.addLayer({
        id: 'fog', type: 'raster', source: 'fog',
        paint: { 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
      });
      this.map.on('moveend', () => this.refresh());
      this.map.on('resize', () => { this._resize(); this.refresh(); });
      this.refresh();
      if (!REDUCED) this._animate();
    }

    setCells(iterable) {
      this.cells = new Set(iterable);
      this.pts.clear();
    }
    addCells(iterable) {
      for (const c of iterable) this.cells.add(c);
    }

    _quad() {
      const b = this.map.getBounds();
      return [
        [b.getWest(), b.getNorth()], [b.getEast(), b.getNorth()],
        [b.getEast(), b.getSouth()], [b.getWest(), b.getSouth()],
      ];
    }

    _resize() {
      const el = this.map.getContainer();
      const w = Math.max(1, Math.round(el.clientWidth * this.dpr));
      const h = Math.max(1, Math.round(el.clientHeight * this.dpr));
      for (const c of [this.canvas, this.maskSharp, this.maskBlur, this.rim, this.glow]) {
        c.width = w; c.height = h;
      }
    }

    // Recalcule le masque et les coordonnées de la source (moveend/sync)
    refresh() {
      const src = this.map.getSource('fog');
      if (src) src.setCoordinates(this._quad());
      this._buildMask();
      this._composite();
    }

    _project() {
      const b = this.map.getBounds();
      const x0 = mercX(b.getWest()), x1 = mercX(b.getEast());
      const y0 = mercY(b.getNorth()), y1 = mercY(b.getSouth());
      const w = this.canvas.width, h = this.canvas.height;
      const sx = w / (x1 - x0), sy = h / (y1 - y0);
      return {
        b, w, h,
        px: (lng) => (mercX(lng) - x0) * sx,
        py: (lat) => (mercY(lat) - y0) * sy,
      };
    }

    _cellPx(pr) {
      // Diamètre écran approximatif d'une cellule au centre de la vue
      const c = this.map.getCenter();
      const cell = h3.latLngToCell(c.lat, c.lng, window.TI.CONFIG.H3_RES);
      const bd = h3.cellToBoundary(cell);
      let minX = 1e9, maxX = -1e9;
      for (const p of bd) { const x = pr.px(p[1]); if (x < minX) minX = x; if (x > maxX) maxX = x; }
      return maxX - minX;
    }

    _drawCells(ctx, pr, cells, sizePx, marginPx) {
      const b = pr.b;
      const west = b.getWest() - 0.3, east = b.getEast() + 0.3;
      const south = b.getSouth() - 0.2, north = b.getNorth() + 0.2;
      ctx.fillStyle = '#fff';
      if (sizePx < 4.5) {
        // Mode point : un carré par cellule (rapide au-delà de 100 000)
        const r = Math.max(2, sizePx * 0.9);
        ctx.beginPath();
        for (const c of cells) {
          let p = this.pts.get(c);
          if (!p) { p = h3.cellToLatLng(c); this.pts.set(c, p); }
          if (p[0] < south || p[0] > north || p[1] < west || p[1] > east) continue;
          ctx.rect(pr.px(p[1]) - r / 2, pr.py(p[0]) - r / 2, r, r);
        }
        ctx.fill();
      } else {
        // Mode hexagone : contours réels
        ctx.beginPath();
        for (const c of cells) {
          let p = this.pts.get(c);
          if (!p) { p = h3.cellToLatLng(c); this.pts.set(c, p); }
          if (p[0] < south || p[0] > north || p[1] < west || p[1] > east) continue;
          const bd = h3.cellToBoundary(c);
          ctx.moveTo(pr.px(bd[0][1]), pr.py(bd[0][0]));
          for (let i = 1; i < bd.length; i++) ctx.lineTo(pr.px(bd[i][1]), pr.py(bd[i][0]));
          ctx.closePath();
        }
        ctx.fill();
      }
    }

    _buildMask() {
      const pr = this._project();
      const size = this._cellPx(pr);
      const blurPx = Math.max(3, Math.min(14, size * 0.8)) * this.dpr / 1.5;

      const ms = this.maskSharp.getContext('2d');
      ms.clearRect(0, 0, pr.w, pr.h);
      const stable = this.newCells
        ? [...this.cells].filter((c) => !this.newCells.has(c))
        : this.cells;
      this._drawCells(ms, pr, stable, size);
      if (this.newCells) {
        ms.globalAlpha = this.newAlpha;
        this._drawCells(ms, pr, this.newCells, size);
        ms.globalAlpha = 1;
      }

      const mb = this.maskBlur.getContext('2d');
      mb.clearRect(0, 0, pr.w, pr.h);
      mb.filter = `blur(${blurPx}px)`;
      mb.drawImage(this.maskSharp, 0, 0);
      mb.filter = 'none';

      // Liseré en deux passes :
      //  fil : (flou léger − net) teinté or clair
      const rc = this.rim.getContext('2d');
      rc.clearRect(0, 0, pr.w, pr.h);
      rc.filter = `blur(${Math.max(4, blurPx * 1.2)}px)`;
      rc.drawImage(this.maskSharp, 0, 0);
      rc.filter = 'none';
      rc.globalCompositeOperation = 'destination-out';
      rc.drawImage(this.maskSharp, 0, 0);
      rc.globalCompositeOperation = 'source-in';
      rc.fillStyle = '#E9C86B';
      rc.fillRect(0, 0, pr.w, pr.h);
      rc.globalCompositeOperation = 'source-over';
      //  halo : (flou large − flou léger) teinté or profond
      const gc = this.glow.getContext('2d');
      gc.clearRect(0, 0, pr.w, pr.h);
      gc.filter = `blur(${Math.max(12, blurPx * 3)}px)`;
      gc.drawImage(this.maskSharp, 0, 0);
      gc.filter = 'none';
      gc.globalCompositeOperation = 'destination-out';
      gc.drawImage(this.maskBlur, 0, 0);
      gc.globalCompositeOperation = 'source-in';
      gc.fillStyle = `rgb(${GOLD})`;
      gc.fillRect(0, 0, pr.w, pr.h);
      gc.globalCompositeOperation = 'source-over';
    }

    _composite() {
      const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, w, h);

      // 1. Nappe : dégradé radial cœur sombre → lisière violette
      const g = ctx.createRadialGradient(w * .45, h * .42, w * .1,
        w * .5, h * .5, Math.max(w, h) * .8);
      g.addColorStop(0, `rgba(${COL_CORE},${FOG_ALPHA})`);
      g.addColorStop(.6, 'rgba(130,120,140,' + FOG_ALPHA + ')');
      g.addColorStop(1, `rgba(${COL_EDGE},${FOG_ALPHA})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      // 2. Deux voiles de bruit qui dérivent en sens opposés
      ctx.globalCompositeOperation = 'multiply';
      this._tile(ctx, this.tex1, this.o1, this.o1 * 0.6, 0.22);
      this._tile(ctx, this.tex2, -this.o2, this.o2 * 0.4, 0.16);

      // 2 bis. Pointe de violet dans les creux
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = '#4A3E5E';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;

      // 3. Soustraction des zones révélées (bords effilochés)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(this.maskBlur, 0, 0);

      // 3 bis. Lumière : léger lavis clair sur les terres révélées,
      // pour qu'elles paraissent éclairées face au voile alentour
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = REVEAL_LIGHT;
      ctx.drawImage(this.maskBlur, 0, 0);
      ctx.globalAlpha = 1;

      // 4. Liseré : halo diffus puis fil doré
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.20;
      ctx.drawImage(this.glow, 0, 0);
      ctx.globalAlpha = 0.50;
      ctx.drawImage(this.rim, 0, 0);
      ctx.globalAlpha = 1;
    }

    _tile(ctx, img, ox, oy, alpha) {
      const s = img.width * this.dpr;
      ctx.globalAlpha = alpha;
      const x0 = ((ox % s) + s) % s, y0 = ((oy % s) + s) % s;
      for (let x = -x0; x < this.canvas.width; x += s)
        for (let y = -y0; y < this.canvas.height; y += s)
          ctx.drawImage(img, x, y, s, s);
      ctx.globalAlpha = 1;
    }

    _animate() {
      const loop = (t) => {
        this._raf = requestAnimationFrame(loop);
        if (t - this._last < 90) return;   // ~11 recompositions/s suffisent
        this._last = t;
        this.o1 += 0.35; this.o2 += 0.22;
        this._composite();
      };
      this._raf = requestAnimationFrame(loop);
    }

    // Dissipation animée sur les cellules nouvellement révélées
    dissipate(newCellsSet, done) {
      if (REDUCED || !newCellsSet.size) {
        this.refresh(); if (done) done(); return;
      }
      this.newCells = newCellsSet;
      const t0 = performance.now(), DUR = 1800;
      const step = (t) => {
        const k = Math.min(1, (t - t0) / DUR);
        this.newAlpha = k * k * (3 - 2 * k); // smoothstep
        this._buildMask();
        this._composite();
        if (k < 1) requestAnimationFrame(step);
        else { this.newCells = null; this.newAlpha = 1; this.refresh(); if (done) done(); }
      };
      requestAnimationFrame(step);
    }
  }

  window.TI.Fog = Fog;
})();
