// DOM-free layout and orthogonal routing for erd-view.
// Imported by parse.mjs and the tests; erd-view.mjs inlines it into template.html (the layout placeholder)
// (with the `export ` keywords stripped), so this file must not import anything.
//
// layoutDiagram(nodes, edges, groups, opts)
//   nodes  [{id, w, h, kind, group}]   sizes already measured; kind from kindOf()
//   edges  [{id, from(child), to(parent), cardinality}]
//   groups [{name, order}]            left-to-right group order
//   opts   {mode: 'grouped'|'compact', bandBudget, maxLanes, laneMin, base, maxCols, lazy}
//          base is the free width of a gutter (even px); maxCols caps a group's columns; lazy routes nothing up front
//          (paths is empty) and out.reroute(idSet) routes a subset into the existing gutters
//          A gutter grows by LANE px per connector lane up to maxLanes lanes; beyond that the lanes squeeze together,
//          never closer than laneMin px. Use a small laneMin when the connectors are hidden until selected.
// Sets x,y on the nodes and returns {frames, lookup, legend, paths, bounds}.

export const kindOf = (e) => {
  if (e.isLookup) return 'Lookup';
  const k = (e.kind || '').toLowerCase();
  return k.startsWith('lookup') ? 'Lookup' : k.startsWith('core') ? 'Core' : k.startsWith('ref') ? 'Reference' : k.startsWith('junc') ? 'Junction'
    : k.startsWith('hist') || k.startsWith('audit') ? 'History/Audit' : 'Unspecified';
};

// Vertical lanes sit on whole pixels plus a per-band fraction (a quarter pixel from any whole pixel, where ports sit), so runs
// in two adjacent bands that reach into the same inter-band gutter can never land on the same x.
const BASE = 24, LANE = 10, PAD = 12, HDR = 34, BOTTOM = 12, HOP = 4, BAND_OFFSET = [0.25, 0.5, 0.75];
const KIND_TIER = { Junction: 100, Reference: 101, 'History/Audit': 102, Unspecified: 103 };
const DIR = { T: [0, -1], B: [0, 1], L: [-1, 0], R: [1, 0] };
const r1 = (v) => Math.round(v * 10) / 10;

export function layoutDiagram(nodesIn, edgesIn, groupsIn = [], opts = {}) {
  const compact = opts.mode === 'compact', budget = opts.bandBudget ?? 2600, hdr = compact ? 0 : HDR;
  const maxLanes = opts.maxLanes ?? 6, laneMin = opts.laneMin ?? 3.5, base = opts.base ?? BASE, maxCols = opts.maxCols ?? 6;
  const extra = (n) => Math.ceil(Math.min(n * LANE, Math.max(maxLanes * LANE, (n - 1) * laneMin)));
  const stepOf = (alloc, n) => (n > 1 ? Math.min(LANE, extra(alloc) / (n - 1)) : 0);
  const body = nodesIn.filter((n) => n.kind !== 'Lookup'), lookups = nodesIn.filter((n) => n.kind === 'Lookup');
  const node = new Map(body.map((n) => [n.id, n])), order = new Map(body.map((n, i) => [n.id, i]));
  // Edges to the shared lookup table are never drawn.
  const edges = edgesIn.filter((e) => node.has(e.from) && node.has(e.to));
  const parents = new Map(body.map((n) => [n.id, new Set()])), children = new Map(body.map((n) => [n.id, new Set()]));
  for (const e of edges) if (e.from !== e.to) { parents.get(e.from).add(e.to); children.get(e.to).add(e.from); }

  /* ---- 1. groups (compact: connected components) ---- */
  let groups;
  if (compact) {
    const seen = new Set(), comps = [];
    for (const n of body) {
      if (seen.has(n.id)) continue;
      const comp = [], st = [n.id]; seen.add(n.id);
      while (st.length) { const v = st.pop(); comp.push(v); for (const u of [...parents.get(v), ...children.get(v)]) if (!seen.has(u)) { seen.add(u); st.push(u); } }
      comps.push(comp.sort((a, b) => order.get(a) - order.get(b)).map((id) => node.get(id)));
    }
    comps.sort((a, b) => b.length - a.length);
    groups = comps.map((nodes) => ({ name: '', nodes }));
  } else {
    const names = groupsIn.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((g) => g.name);
    for (const n of body) if (!names.includes(n.group)) names.push(n.group);
    groups = names.map((name) => ({ name, nodes: body.filter((n) => n.group === name) })).filter((g) => g.nodes.length);
  }

  /* ---- 2. per group: tiers, order within rows, columns ---- */
  groups.forEach((g, gi) => {
    g.index = gi; g.ids = new Set(g.nodes.map((n) => n.id));
    const inG = (set, id) => [...set.get(id)].filter((u) => g.ids.has(u)).map((u) => node.get(u));
    const nb = (n) => [...inG(parents, n.id), ...inG(children, n.id)];
    // tier key per node
    const tier = compact ? layerize(g.nodes.map((n) => n.id), parents, children) : coreDepths(g, parents, node);
    const rowsByKey = new Map();
    for (const n of g.nodes) { const k = compact ? tier.get(n.id) : n.kind === 'Core' ? tier.get(n.id) : KIND_TIER[n.kind] ?? 103; n.tier = k; (rowsByKey.get(k) ?? rowsByKey.set(k, []).get(k)).push(n); }
    g.rows = [...rowsByKey.keys()].sort((a, b) => a - b).map((k) => ({ key: k, nodes: rowsByKey.get(k) }));
    sweep(g.rows.map((r) => r.nodes), nb);
    // columns
    const avgW = g.nodes.reduce((s, n) => s + n.w, 0) / g.nodes.length, n = g.nodes.length;
    const cap = Math.max(1, Math.floor((budget * 0.9) / (avgW + base)));
    const want = compact ? Math.ceil(Math.sqrt(n * 1.7)) : n <= 2 ? n : Math.max(2, Math.ceil(Math.sqrt(n * 1.8)));
    const cols = Math.max(1, Math.min(want, cap, compact ? 12 : maxCols, Math.max(...g.rows.map((r) => r.nodes.length))));
    const colOf = new Map();
    for (const row of g.rows) {
      for (let s = 0; s * cols < row.nodes.length; s++) {
        const ch = row.nodes.slice(s * cols, (s + 1) * cols);
        const cs = assignCols(ch, cols, (x) => nb(x).map((u) => colOf.get(u.id)).filter((c) => c !== undefined));
        ch.forEach((x, i) => { colOf.set(x.id, cs[i]); x.gc = cs[i]; x.sub = s; });
      }
    }
    const used = [...new Set(g.nodes.map((x) => x.gc))].sort((a, b) => a - b);
    g.nodes.forEach((x) => (x.gc = used.indexOf(x.gc)));
    g.colW = used.map((_, c) => Math.max(...g.nodes.filter((x) => x.gc === c).map((x) => x.w)));
  });

  /* ---- 3. bands, global rows and columns ---- */
  const bands = []; let cur = null;
  for (const g of groups) {
    const est = g.colW.reduce((a, b) => a + b, 0) + (g.colW.length - 1) * base + 2 * PAD + base;
    if (!cur || (cur.groups.length && cur.w + est > budget)) { cur = { groups: [], w: 0 }; bands.push(cur); }
    cur.groups.push(g); cur.w += est;
  }
  const rowsG = [];
  bands.forEach((b, bi) => {
    b.cols = [];
    for (const g of b.groups) { g.colStart = b.cols.length; g.colW.forEach((w) => b.cols.push({ g, w })); }
    const keys = new Map();
    for (const g of b.groups) for (const n of g.nodes) keys.set(`${n.tier}:${n.sub}`, [n.tier, n.sub]);
    const sorted = [...keys.values()].sort((a, b2) => a[0] - b2[0] || a[1] - b2[1]).map((k) => `${k[0]}:${k[1]}`);
    b.firstRow = rowsG.length;
    sorted.forEach((k) => rowsG.push({ band: bi, key: k, h: 0, first: k === sorted[0], nodes: [] }));
    for (const g of b.groups) for (const n of g.nodes) {
      n._b = bi; n.cb = g.colStart + n.gc; n.r = b.firstRow + sorted.indexOf(`${n.tier}:${n.sub}`);
      rowsG[n.r].nodes.push(n);
    }
    b.lastRow = rowsG.length - 1;
    b.cols.forEach((c, i) => { c.w = Math.max(...b.groups.flatMap((g) => g.nodes).filter((n) => n.cb === i).map((n) => n.w)); });
  });
  for (const r of rowsG) r.h = Math.max(...r.nodes.map((n) => n.h));
  const R = rowsG.length;

  /* ---- 4. place on a grid whose gutters are as wide as their lanes need ---- */
  let width = 0;
  function place(lv, lh) {
    width = 0;
    bands.forEach((b, bi) => {
      const C = b.cols.length; b.v = []; b.colX = []; let x = 0;
      for (let k = 0; k <= C; k++) {
        const L = k > 0 ? b.cols[k - 1].g : null, Rg = k < C ? b.cols[k].g : null;
        const pre = k > 0 && (k === C || L !== Rg) ? PAD : 0, post = k < C && (k === 0 || L !== Rg) ? PAD : 0;
        const alloc = lv.get(`${bi}.${k}`) ?? 0, zw = base + extra(alloc);
        b.v[k] = { x0: x, zx: x + pre, zw, alloc, x1: x + pre + zw + post }; x = b.v[k].x1;
        if (k < C) { b.colX[k] = x; x += b.cols[k].w; }
      }
      b.w = x; width = Math.max(width, x);
    });
    let y = 0; const h = [];
    for (let j = 0; j <= R; j++) {
      const first = j < R && rowsG[j].first;
      const pre = j === R || (j > 0 && first) ? BOTTOM : 0, post = first ? hdr : 0, alloc = lh.get(j) ?? 0, zh = base + extra(alloc);
      h[j] = { y0: y, zy: y + pre, zh, alloc, y1: y + pre + zh + post }; y = h[j].y1;
      if (j < R) { rowsG[j].y = y; y += rowsG[j].h; }
    }
    for (const r of rowsG) for (const n of r.nodes) { const b = bands[r.band]; n.x = b.colX[n.cb] + (b.cols[n.cb].w - n.w) / 2; n.y = r.y + (r.h - n.h) / 2; }
    return h;
  }

  /* ---- 5. route (orthogonal, inside gutters), widening gutters until the lanes fit ---- */
  let lv = new Map(), lh = new Map(), result;
  // lazy: place the grid with tight gutters and route nothing yet; reroute(ids) later routes just those connectors into the
  // existing gutters (for views where connectors only show for the selection, so reserving lanes for all of them is waste)
  const initial = opts.lazy ? [] : edges;
  for (let it = 0; it < 8; it++) {
    const h = place(lv, lh);
    result = route(h, initial, false);
    let grew = false;
    for (const [k, n] of result.lanes) {
      const map = k.startsWith('H') ? lh : lv, key = k.startsWith('H') ? +k.slice(1) : k.slice(1);
      if (n > (map.get(key) ?? 0)) { map.set(key, n); grew = true; }
    }
    if (!grew) break;
    if (it === 7) { result = route(place(lv, lh), initial, false); }
  }
  const hFinal = place(lv, lh);

  // route() works in five phases for the connectors in `list`:
  //   1. ends    which side of each table a connector leaves and enters (top/bottom, or facing sides for neighbours)
  //   2. ports   spread the ends on each side evenly, ordered by where the other end is
  //   3. tracks  the gutters each straight run lives in: one horizontal gutter, or horizontal / vertical / horizontal
  //              (more when it crosses bands); vertical gutters are chosen nearest the source, toward the target
  //   4. lanes   per gutter, greedy interval colouring so no two connectors share a stretch
  //   5. coords  lane positions become polyline vertices, then line hops are added to the drawn path
  // `squeeze` (reroute) spreads lanes evenly inside gutters that were not widened for them.
  function route(h, list, squeeze) {
    const ends = new Map(); // `${node}|${side}` -> [{P, end, o}]
    const addEnd = (n, s, o) => { const k = n.id + '|' + s; (ends.get(k) ?? ends.set(k, []).get(k)).push(o); };
    const plans = [];
    for (const e of list) {
      const c = node.get(e.from), p = node.get(e.to), P = { e, c, p, tracks: [], id: e.id };
      if (c === p) { P.kind = 'self'; P.cs = P.ps = 'R'; P.tracks = [{ t: 'V', b: c._b, k: c.cb + 1 }]; }
      else if (p.r < c.r) { P.kind = 'v'; P.cs = 'T'; P.ps = 'B'; P.gs = c.r; P.gt = p.r + 1; }
      else if (p.r > c.r) { P.kind = 'v'; P.cs = 'B'; P.ps = 'T'; P.gs = c.r + 1; P.gt = p.r; }
      else if (c._b === p._b && Math.abs(c.cb - p.cb) === 1) { P.kind = 'jog'; P.cs = c.cb < p.cb ? 'R' : 'L'; P.ps = c.cb < p.cb ? 'L' : 'R'; P.tracks = [{ t: 'V', b: c._b, k: Math.max(c.cb, p.cb) }]; }
      else { P.kind = 'v'; P.cs = P.ps = 'T'; P.gs = P.gt = c.r; }
      addEnd(c, P.cs, { P, end: 'c', o: p }); addEnd(p, P.ps, { P, end: 'p', o: c });
      plans.push(P);
    }
    // ports, spread evenly along each side and ordered by where the other end is
    for (const [k, list] of ends) {
      const [id, s] = [k.slice(0, k.lastIndexOf('|')), k.slice(k.lastIndexOf('|') + 1)], n = node.get(id), vert = s === 'T' || s === 'B';
      list.sort((a, b) => (vert ? a.o.x + a.o.w / 2 - (b.o.x + b.o.w / 2) : a.o.y + a.o.h / 2 - (b.o.y + b.o.h / 2)) || (a.end === 'c' ? -1 : 1));
      list.forEach((o, i) => {
        const t = (i + 1) / (list.length + 1), [dx, dy] = DIR[s];
        // whole pixels, even for bottom ports and odd for top ports, so a stub leaving one table can never sit on a stub entering the next
        const px = Math.round((n.x + n.w * t - (s === 'T' ? 1 : 0)) / 2) * 2 + (s === 'T' ? 1 : 0);
        const pt = vert ? { x: px, y: s === 'T' ? n.y : n.y + n.h, dx, dy }
          : { x: s === 'L' ? n.x : n.x + n.w, y: n.y + Math.min(n.h - 6, 18 + (n.h - 24) * t), dx, dy };
        o.P[o.end === 'c' ? 'S' : 'T'] = pt;
      });
    }
    // straight connector: adjacent rows, one port on each end, columns overlap
    for (const P of plans) {
      if (P.kind !== 'v' || P.gs !== P.gt || P.cs === P.ps) continue;
      const lo = Math.max(P.c.x, P.p.x), hi = Math.min(P.c.x + P.c.w, P.p.x + P.p.w);
      if (hi - lo >= 16 && ends.get(P.c.id + '|' + P.cs).length === 1 && ends.get(P.p.id + '|' + P.ps).length === 1) { P.straight = true; P.S.x = P.T.x = (lo + hi) / 2; }
    }
    // tracks: which gutter each straight run lives in
    for (const P of plans) {
      if (P.straight || P.kind !== 'v') continue;
      if (P.gs === P.gt) { P.tracks = [{ t: 'H', j: P.gs }]; continue; }
      const lo = Math.min(P.gs, P.gt), hi = Math.max(P.gs, P.gt), bs = [];
      for (let r = lo; r < hi; r++) if (bs[bs.length - 1] !== rowsG[r].band) bs.push(rowsG[r].band);
      if (P.gs > P.gt) bs.reverse();
      P.tracks = [{ t: 'H', j: P.gs }];
      bs.forEach((b, i) => {
        P.tracks.push({ t: 'V', b, k: 0 });
        if (i < bs.length - 1) P.tracks.push({ t: 'H', j: Math.max(bands[b].firstRow, bands[bs[i + 1]].firstRow) });
      });
      P.tracks.push({ t: 'H', j: P.gt });
      const vs = P.tracks.filter((t) => t.t === 'V');
      let from = P.S.x;
      vs.forEach((t, i) => {
        const x = i === vs.length - 1 && vs.length > 1 ? P.T.x : from; // the last hop of a multi-band route lands near the target
        t.k = chooseK(bands[t.b], x, P.T.x); from = bands[t.b].v[t.k].zx + bands[t.b].v[t.k].zw / 2;
      });
    }
    // lanes: each gutter hands out lanes greedily so no two connectors share a stretch
    const gutters = new Map();
    const span = (t, axis) => axis === 'x' ? [bands[t.b].v[t.k].zx, bands[t.b].v[t.k].zx + bands[t.b].v[t.k].zw] : [h[t.j].zy, h[t.j].zy + h[t.j].zh];
    for (const P of plans) {
      if (P.straight) continue;
      const tr = P.tracks;
      tr.forEach((t, i) => {
        const axis = t.t === 'H' ? 'x' : 'y', pt = (q) => (axis === 'x' ? [q.x, q.x] : [q.y, q.y]);
        const a = i === 0 ? pt(P.S) : span(tr[i - 1], axis), b = i === tr.length - 1 ? pt(P.T) : span(tr[i + 1], axis);
        const key = t.t === 'H' ? 'H' + t.j : `V${t.b}.${t.k}`;
        (gutters.get(key) ?? gutters.set(key, []).get(key)).push({ t, lo: Math.min(a[0], b[0]), hi: Math.max(a[1], b[1]), id: P.id });
      });
    }
    const lanes = new Map();
    for (const [key, items] of gutters) {
      items.sort((a, b) => a.lo - b.lo || a.hi - b.hi || (a.id < b.id ? -1 : 1));
      const ends2 = [];
      for (const it of items) {
        let l = ends2.findIndex((end) => end + 3 < it.lo);
        if (l < 0) { l = ends2.length; ends2.push(0); }
        ends2[l] = it.hi; it.t.lane = l;
      }
      lanes.set(key, ends2.length);
    }
    // coordinates
    // Squeezed lanes (reroute) spread evenly inside a gutter that was not widened for them.
    const laneY = (t) => squeeze ? h[t.j].zy + (h[t.j].zh * (t.lane + 1)) / (lanes.get('H' + t.j) + 1) : h[t.j].zy + base / 2 + t.lane * stepOf(h[t.j].alloc, lanes.get('H' + t.j));
    const laneX = (t) => {
      const v = bands[t.b].v[t.k], n = lanes.get(`V${t.b}.${t.k}`);
      return squeeze ? Math.round(((v.zx + (v.zw * (t.lane + 1)) / (n + 1)) * 2)) / 2 + BAND_OFFSET[t.b % 3] / 2 : v.zx + base / 2 + Math.round(t.lane * stepOf(v.alloc, n)) + BAND_OFFSET[t.b % 3];
    };
    const paths = [];
    for (const P of plans) {
      const { S, T, tracks: tr } = P; let pts;
      if (P.straight) pts = [[S.x, S.y], [T.x, T.y]];
      else if (tr.length === 1 && tr[0].t === 'V') { const x = laneX(tr[0]); pts = [[S.x, S.y], [x, S.y], [x, T.y], [T.x, T.y]]; }
      else {
        pts = [[S.x, S.y]]; let x = S.x, y = S.y;
        tr.forEach((t, i) => {
          if (t.t === 'H') { y = laneY(t); pts.push([x, y]); } else { x = laneX(t); pts.push([x, y]); }
          if (i === tr.length - 1) { if (t.t === 'H') pts.push([T.x, y]); }
        });
        pts.push([T.x, T.y]);
      }
      pts = clean(pts);
      let best = 0, label = { x: pts[0][0], y: pts[0][1] };
      for (let i = 1; i < pts.length; i++) { const L = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]); if (L > best) { best = L; label = { x: (pts[i][0] + pts[i - 1][0]) / 2, y: (pts[i][1] + pts[i - 1][1]) / 2 }; } }
      paths.push({ id: P.id, pts, c: S, p: T, self: P.kind === 'self', label });
    }
    jumps(paths);
    return { paths, lanes };
  }

  function chooseK(b, x, toward) {
    const cx = (k) => b.v[k].zx + b.v[k].zw / 2, all = b.v.map((_, k) => k);
    let cand = toward > x + 1 ? all.filter((k) => cx(k) >= x - 1) : toward < x - 1 ? all.filter((k) => cx(k) <= x + 1) : all;
    if (!cand.length) cand = all;
    return cand.reduce((best, k) => (Math.abs(cx(k) - x) < Math.abs(cx(best) - x) ? k : best), cand[0]);
  }

  /* ---- 6. frames, lookup box, legend ---- */
  const frames = [];
  if (!compact) bands.forEach((b) => {
    for (const g of b.groups) {
      const c0 = g.colStart, c1 = g.colStart + g.colW.length - 1, top = rowsG[b.firstRow].y - hdr, bottom = rowsG[b.lastRow].y + rowsG[b.lastRow].h + BOTTOM;
      frames.push({ name: g.name, x: b.colX[c0] - PAD, y: top, w: b.colX[c1] + b.cols[c1].w - b.colX[c0] + 2 * PAD, h: bottom - top, tint: g.index % 6, nodes: g.nodes.map((n) => n.id) });
    }
  });
  let bottomY = hFinal[R].y1 + 20, lookup = null;
  if (lookups.length) {
    let x = PAD; const hh = Math.max(...lookups.map((n) => n.h));
    for (const n of lookups) { n.x = x; n.y = bottomY + 34; x += n.w + 16; }
    lookup = { name: 'Shared lookup', x: 0, y: bottomY, w: x - 16 + PAD, h: hh + 34 + PAD, nodes: lookups.map((n) => n.id) };
  }
  const legend = { x: lookup ? lookup.w + 30 : 0, y: bottomY, w: 740, h: Math.max(lookup ? lookup.h : 0, 132) };
  const paths = result.paths;
  const reroute = (ids) => route(hFinal, edges.filter((e) => ids.has(e.id)), true).paths;
  const bounds = boundsOf([...body, ...lookups], frames, lookup, legend, paths);
  return { frames, lookup, legend, paths, bounds, bands: bands.length, rows: R, reroute };
}

// Try several band widths and keep the one that shows the most when fitted into `view` ({w, h} in px).
// Nodes are laid out on copies, so only the winner is written back to `nodes`.
export function layoutBest(nodes, edges, groups, opts = {}, view = { w: 1250, h: 720 }) {
  const budgets = [1600, 2200, 3000, 4000, 5400];
  let best = null;
  for (const bandBudget of budgets) {
    const copy = nodes.map((n) => ({ ...n }));
    const out = layoutDiagram(copy, edges, groups, { ...opts, bandBudget });
    const scale = Math.min(view.w / out.bounds.w, view.h / out.bounds.h, 1);
    // prefer fewer bands on a tie, and don't bother with wider budgets once nothing changes
    if (!best || scale > best.scale * 1.02) best = { bandBudget, scale, bands: out.bands };
  }
  return layoutDiagram(nodes, edges, groups, { ...opts, bandBudget: best.bandBudget });
}

function boundsOf(nodes, frames, lookup, legend, paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, w = 0, h = 0) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x + w); y1 = Math.max(y1, y + h); };
  for (const n of nodes) add(n.x, n.y, n.w, n.h);
  for (const f of frames) add(f.x, f.y, f.w, f.h);
  if (lookup) add(lookup.x, lookup.y, lookup.w, lookup.h);
  add(legend.x, legend.y, legend.w, legend.h);
  for (const p of paths) for (const [x, y] of p.pts) add(x, y);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Drop repeated and collinear vertices.
function clean(pts) {
  const out = [];
  for (const p of pts) { const q = out[out.length - 1]; if (!q || q[0] !== p[0] || q[1] !== p[1]) out.push([p[0], p[1]]); }
  for (let i = out.length - 2; i > 0; i--) {
    const a = out[i - 1], b = out[i], c = out[i + 1];
    if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) out.splice(i, 1);
  }
  return out;
}

// Line jumps: a horizontal run that crosses another connector's vertical run steps over it with a small square bump.
// The path stays M…L…L (straight segments only). `pts` keep the clean route; `d` carries the bumps.
function jumps(paths) {
  const vs = [];
  for (const p of paths) for (let i = 1; i < p.pts.length; i++) {
    const [ax, ay] = p.pts[i - 1], [bx, by] = p.pts[i];
    if (ax === bx && ay !== by) vs.push({ x: ax, y0: Math.min(ay, by), y1: Math.max(ay, by), p });
  }
  for (const p of paths) {
    let d = `M${r1(p.pts[0][0])},${r1(p.pts[0][1])}`;
    for (let i = 1; i < p.pts.length; i++) {
      const [ax, ay] = p.pts[i - 1], [bx, by] = p.pts[i];
      if (ay === by && ax !== bx) {
        const dir = bx > ax ? 1 : -1, lo = Math.min(ax, bx) + HOP + 1, hi = Math.max(ax, bx) - HOP - 1;
        const xs = vs.filter((v) => v.p !== p && v.x > lo && v.x < hi && v.y0 + 0.5 < ay && ay < v.y1 - 0.5).map((v) => v.x).sort((a, b) => dir * (a - b));
        let last = -Infinity;
        for (const x of xs) {
          if (dir * x - last < 2 * HOP + 2) continue; last = dir * x;
          d += `L${r1(x - dir * HOP)},${r1(ay)}L${r1(x - dir * HOP)},${r1(ay - HOP)}L${r1(x + dir * HOP)},${r1(ay - HOP)}L${r1(x + dir * HOP)},${r1(ay)}`;
        }
      }
      d += `L${r1(bx)},${r1(by)}`;
    }
    p.d = d;
  }
}

// Core depth within a group: longest path from an in-group Core root over Core→Core (child→parent) edges.
function coreDepths(g, parents, node) {
  const depth = new Map(), visiting = new Set();
  const d = (id) => {
    if (depth.has(id)) return depth.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id); let m = 0;
    for (const p of parents.get(id)) if (g.ids.has(p) && node.get(p).kind === 'Core' && p !== id) m = Math.max(m, d(p) + 1);
    visiting.delete(id); depth.set(id, m); return m;
  };
  for (const n of g.nodes) if (n.kind === 'Core') d(n.id);
  return depth;
}

// Longest-path layering with cycle breaking; pure roots are pulled down next to their lowest child.
function layerize(ids, parents, children) {
  const set = new Set(ids), layer = new Map(), st = new Map(), order = [];
  const dfs = (v) => { st.set(v, 1); for (const c of children.get(v)) { if (!set.has(c)) continue; const s = st.get(c); if (s === 1) continue; if (!s) dfs(c); } st.set(v, 2); order.push(v); };
  ids.filter((v) => ![...parents.get(v)].some((p) => set.has(p))).concat(ids).forEach((v) => { if (!st.get(v)) dfs(v); });
  const topo = order.reverse(), pos = new Map(topo.map((v, i) => [v, i]));
  for (const v of topo) {
    let l = 0;
    for (const p of parents.get(v)) if (set.has(p) && pos.get(p) < pos.get(v)) l = Math.max(l, (layer.get(p) ?? 0) + 1);
    layer.set(v, l);
  }
  for (const v of topo) if (![...parents.get(v)].some((p) => set.has(p) && pos.get(p) < pos.get(v))) {
    const cs = [...children.get(v)].filter((c) => set.has(c) && pos.get(c) > pos.get(v));
    if (cs.length) layer.set(v, Math.min(...cs.map((c) => layer.get(c))) - 1);
  }
  const minL = Math.min(...layer.values()); layer.forEach((l, v) => layer.set(v, l - minL));
  return layer;
}

// Barycentre sweeps over rows of nodes, using in-group neighbours in the rows above and below.
function sweep(rows, nb) {
  const rowOf = new Map(), frac = new Map();
  rows.forEach((r, i) => r.forEach((n) => rowOf.set(n.id, i)));
  const setFrac = () => rows.forEach((r) => r.forEach((n, i) => frac.set(n.id, (i + 0.5) / r.length)));
  setFrac();
  for (let it = 0; it < 8; it++) {
    const down = it % 2 === 0, idx = rows.map((_, i) => i);
    if (!down) idx.reverse();
    for (const i of idx) {
      const key = new Map();
      for (const n of rows[i]) {
        const ref = nb(n).filter((u) => (down ? rowOf.get(u.id) < i : rowOf.get(u.id) > i));
        key.set(n.id, ref.length ? ref.reduce((s, u) => s + frac.get(u.id), 0) / ref.length : frac.get(n.id));
      }
      rows[i].sort((a, b) => key.get(a.id) - key.get(b.id));
      rows[i].forEach((n, j) => frac.set(n.id, (j + 0.5) / rows[i].length));
    }
  }
}

// Columns for one chunk of a row: children sit side by side under their parents, never stacked.
function assignCols(chunk, cols, parentCols) {
  const k = chunk.length;
  const des = chunk.map((n) => { const c = parentCols(n); return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null; });
  const ideal = chunk.map((_, i) => des[i] ?? ((i + 0.5) / k) * cols - 0.5);
  for (let i = 0; i < k;) {
    if (des[i] === null) { i++; continue; }
    let j = i; while (j + 1 < k && des[j + 1] === des[i]) j++;
    for (let t = 0; t <= j - i; t++) ideal[i + t] = des[i] - (j - i) / 2 + t;
    i = j + 1;
  }
  const c = []; let prev = -1;
  for (let i = 0; i < k; i++) { c[i] = Math.max(prev + 1, Math.round(ideal[i])); prev = c[i]; }
  c[k - 1] = Math.min(c[k - 1], cols - 1);
  for (let i = k - 2; i >= 0; i--) c[i] = Math.min(c[i], c[i + 1] - 1);
  return c;
}
