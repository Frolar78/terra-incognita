// Précalcul hors ligne : nombre de cellules H3 (res 9) par département.
// Usage : node tools/compute-counts.mjs [res]
// Produit data/dept-cell-counts.json — à ne relancer que si les contours
// ou la résolution changent.
import { readFileSync, writeFileSync } from 'node:fs';
import { polygonToCells } from 'h3-js';

const RES = Number(process.argv[2] || 9);
const geo = JSON.parse(readFileSync(new URL('../data/departements.geojson', import.meta.url), 'utf8'));

const counts = {};
let total = 0;
for (const f of geo.features) {
  const code = f.properties.code;
  const g = f.geometry;
  const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
  let n = 0;
  for (const poly of polys) {
    // poly = [anneauExtérieur, ...trous], coordonnées GeoJSON [lng, lat]
    n += polygonToCells(poly, RES, true).length;
  }
  counts[code] = n;
  total += n;
  console.error(code, f.properties.nom, n);
}
writeFileSync(new URL('../data/dept-cell-counts.json', import.meta.url),
  JSON.stringify({ res: RES, total, counts }));
console.error('TOTAL France', total, 'cellules res', RES);
