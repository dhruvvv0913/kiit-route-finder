// K Map: the website around the C++ router. Every shortest path comes from Dijkstra in
// cpp/graph.cpp, compiled to router.js + router.wasm. This file turns what people type into
// graph places, asks the C++ for routes, and shows them as directions and on the map.
"use strict";

const FLOOR_NAMES = ["Ground", "1st", "2nd", "3rd"];
const FLOOR_SHORT = ["G", "1", "2", "3"];
const NS = "http://www.w3.org/2000/svg";
const FULL = { x: 160, y: 132, w: 890, h: 680 };  // the whole floor plan, in drawing units
const BLOCK_A = { x: 175, y: 145, w: 360, h: 430 };
const STEPS_PER_MIN = 100;        // relaxed indoor walking pace
const STAIR_STEPS_PER_MIN = 60;   // climbing is slower
const $ = id => document.getElementById(id);

let plan, router, timetable;
const nodeById = {}, roomById = {}, roomsAt = {}, viaFor = {};
const places = new Map();  // what a person can type (upper case) -> graph place id
const state = { floor: 0, route: null, start: null, end: null, focus: null };

const roomOn = (id, floor) => id[0] + floor + id.slice(2);  // A006 on floor 2 -> A206
const groundId = id => id[0] + "0" + id.slice(2);

start();

async function start() {
  try {
    const [planText, graphText, module] = await Promise.all([
      fetch("floor-graph.json").then(okText),
      fetch("graph.txt").then(okText),
      createRouter(),
    ]);
    plan = JSON.parse(planText);
    timetable = await fetch("timetable.json").then(r => (r.ok ? r.json() : null)).catch(() => null);
    router = module;
    const error = router.ccall("load_graph", "string", ["string"], [graphText]);
    if (error) throw new Error(error);
  } catch (err) {
    say(`K Map didn’t load (${err.message}). Refresh the page to try again.`, true);
    return;
  }
  indexPlan();
  listPlaces();
  drawMap();
  buildFloorTabs();
  bindEvents();
  showDataNote();
  $("go").disabled = false;
  say("");
  setupSection();
  openFromHash();
}

function okText(res) {
  if (!res.ok) throw new Error(`${res.url} returned ${res.status}`);
  return res.text();
}

function say(text, isError = false) {
  const el = $("message");
  el.textContent = text;
  el.classList.toggle("error", isError);
}

function openFromHash() {
  const link = decodeURIComponent(location.hash.slice(1)).match(/^([^-]+)-(.+)$/);
  if (!link) {
    showHome();
    if (state.route) return;  // showHome opened the way to a class starting soon
    setFloor(0);
    return fitBox(isPhone() ? BLOCK_A : FULL);  // a whole floor is too small to read on a phone
  }
  $("from").value = labelFor(link[1]);
  $("to").value = labelFor(link[2]);
  findRoute();
}

/* ---------- the plan ---------- */

function indexPlan() {
  plan.nodes.forEach(n => (nodeById[n.id] = n));
  plan.rooms.forEach(r => {
    roomById[r.id] = r;
    (roomsAt[r.door] ||= []).push(r.id);
  });
  plan.edges.forEach(e => {
    if (!e.via) return;
    viaFor[e.from + "|" + e.to] = e.via;
    viaFor[e.to + "|" + e.from] = [...e.via].reverse();
  });
}

const floors = () => plan.meta.floors;
const isMainEntry = n => n.id === "A_ENTRY" || n.id === "B_ENTRY";

function listPlaces() {
  const options = $("places");
  const add = (text, id, show) => {
    places.set(text.toUpperCase(), id);
    if (!show) return;
    const o = document.createElement("option");
    o.value = text;
    options.appendChild(o);
  };
  for (const f of floors()) {
    plan.rooms.forEach(r => add(roomOn(r.id, f), roomOn(r.id, f), true));
    plan.nodes.forEach(n => {
      const named = n.kind === "toilet" || n.kind === "stair" || (n.kind === "entry" && f === 0);
      if (named) add(`${n.label} · ${FLOOR_NAMES[f]} floor`, `${n.id}@${f}`, true);
      if (named || n.kind === "entry") add(`${n.id}@${f}`, `${n.id}@${f}`, false);  // for #links
    });
  }
}

// "A206", "a206", "a 206", "a-206", and short forms like "a6" or "B12" (ground floor).
function resolve(text) {
  const t = text.trim().replace(/\s+/g, " ").toUpperCase();
  if (!t) return null;
  if (places.has(t)) return places.get(t);
  const compact = t.replace(/[\s-]/g, "");
  if (places.has(compact)) return places.get(compact);
  const m = compact.match(/^([AB])(\d{1,2})$/);
  if (m) return places.get(m[1] + "0" + m[2].padStart(2, "0")) || null;
  return null;
}

function labelFor(id) {
  if (!id.includes("@")) return id;
  if (!nodeById[id.split("@")[0]]) return id;
  const p = placeOf(id);
  return p.kind === "room" ? p.label : `${p.label} · ${FLOOR_NAMES[p.floor]} floor`;
}

// A graph place id ("A206", "D2@2", "T1@0") with its position and a readable name.
function placeOf(id) {
  if (!id.includes("@")) {
    const [x1, y1, x2, y2] = roomById[groundId(id)].rect;
    return { id, kind: "room", floor: +id[1], x: (x1 + x2) / 2, y: (y1 + y2) / 2, label: id };
  }
  const [base, f] = id.split("@");
  const n = nodeById[base], floor = +f;
  let label = n.label || base;
  if (n.kind === "door" && roomsAt[base]) label = roomsAt[base].map(r => roomOn(r, floor)).join(" / ");
  return { id, base, kind: n.kind, floor, x: n.x, y: n.y, label };
}

function hopPoints(a, b) {
  const pa = placeOf(a), pb = placeOf(b);
  const via = pa.base && pb.base && pa.floor === pb.floor ? viaFor[pa.base + "|" + pb.base] || [] : [];
  return [[pa.x, pa.y], ...via, [pb.x, pb.y]];
}

/* ---------- asking the C++ ---------- */

function route(a, b) {
  return JSON.parse(router.ccall("find_route", "string", ["string", "string"], [a, b]));
}

function findRoute() {
  const fromText = $("from").value, toText = $("to").value;
  const a = resolve(fromText), b = resolve(toText);
  if (!fromText.trim()) return fail("Type where you’re starting from, e.g. A006.");
  if (!a) return fail(`Couldn’t find “${fromText.trim()}”. Try a room number like A207.`);
  if (!toText.trim()) return fail("Type where you’re going, or pick a nearest place below.");
  if (!b) return fail(`Couldn’t find “${toText.trim()}”. Try a room number like B212.`);
  const r = route(a, b);
  if (r.unknown) return fail(`“${r.unknown}” isn’t on the map.`);
  if (!r.found) return fail(`No route found between ${labelFor(a)} and ${labelFor(b)}.`);
  show(r, a, b);
}

// Nearest toilet / stairs / entrance: ask the C++ for a route to every candidate, keep the shortest.
const NEAREST = {
  gents: { name: "Gents toilet", pick: n => n.kind === "toilet" && n.label.startsWith("Gents") },
  ladies: { name: "Ladies toilet", pick: n => n.kind === "toilet" && n.label.startsWith("Ladies") },
  stairs: { name: "staircase", pick: (n, f, start) => n.kind === "stair" && f === start.floor },
  entrance: { name: "main entrance", pick: (n, f) => isMainEntry(n) && f === 0 },
};

function findNearest(kind) {
  const fromText = $("from").value.trim(), a = resolve(fromText);
  if (!a) return fail(fromText ? `Couldn’t find “${fromText}”.` : "Type where you are in From first, then pick what you need.");
  const want = NEAREST[kind], startPlace = placeOf(a);
  let best = null;
  for (const f of floors())
    for (const n of plan.nodes) {
      if (!want.pick(n, f, startPlace)) continue;
      const r = route(a, `${n.id}@${f}`);
      if (r.found && (!best || r.steps < best.r.steps)) best = { r, id: `${n.id}@${f}` };
    }
  if (!best) return fail(`No ${want.name} found from ${labelFor(a)}.`);
  $("to").value = labelFor(best.id);
  show(best.r, a, best.id);
}

function fail(message) {
  Object.assign(state, { route: null, start: null, end: null, focus: null });
  showHome();
  say(message, true);
  setFloor(state.floor);
}

function show(r, a, b) {
  Object.assign(state, { route: r, start: a, end: b, focus: null });
  say("");
  $("summary-empty").hidden = true;
  $("classes").hidden = true;
  $("class-list").hidden = true;
  $("summary-route").hidden = false;
  $("back-classes").hidden = !mySection();
  $("total").textContent = r.steps;
  $("time").textContent = r.steps === 0 ? "You’re already there" : walkTime(r);
  const pa = placeOf(a), pb = placeOf(b);
  const bold = text => { const el = document.createElement("b"); el.textContent = text; return el; };
  $("trip").replaceChildren(bold(labelFor(a)), " to ", bold(labelFor(b)),
    pa.floor !== pb.floor ? `, ${FLOOR_NAMES[pa.floor]} to ${FLOOR_NAMES[pb.floor]} floor` : "");

  const items = directions(r);
  $("directions").replaceChildren(...items.map(item => {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `<span class="ico ${item.icon}"><svg aria-hidden="true"><use href="#i-${item.icon}"/></svg></span><span></span>`;
    button.lastChild.textContent = item.text;
    button.addEventListener("click", () => focusStep(item, button));
    li.appendChild(button);
    return li;
  }));
  $("directions").hidden = false;
  openSheet(false);
  history.replaceState(null, "", "#" + a + "-" + b);
  setFloor(pa.floor, { fit: true, animate: true });
}

function walkTime(r) {
  let flat = 0, stairs = 0;
  for (let i = 1; i < r.path.length; i++) {
    if (placeOf(r.path[i - 1]).floor !== placeOf(r.path[i]).floor) stairs += r.legs[i - 1];
    else flat += r.legs[i - 1];
  }
  const minutes = flat / STEPS_PER_MIN + stairs / STAIR_STEPS_PER_MIN;
  if (minutes < 0.75) return "Under a minute's walk";
  const half = Math.round(minutes * 2) / 2;
  return `About ${Math.floor(half)}${half % 1 ? "½" : ""} min walk`;
}

function focusStep(item, button) {
  const same = state.focus && state.focus.from === item.from && state.focus.to === item.to;
  document.querySelectorAll("#directions button").forEach(b => b.setAttribute("aria-pressed", "false"));
  state.focus = same ? null : item;
  if (!same) button.setAttribute("aria-pressed", "true");
  const floor = state.focus ? placeOf(state.route.path[item.to]).floor : state.floor;
  setFloor(floor, { fit: true });
  if (state.focus && isPhone()) openSheet(false);
}

/* ---------- turn-by-turn directions ---------- */

const vec = (p, q) => [q[0] - p[0], q[1] - p[1]];

// The map's y axis points down, so a positive cross product is a clockwise (right) turn.
function turn(a, b) {
  const cross = a[0] * b[1] - a[1] * b[0], dot = a[0] * b[0] + a[1] * b[1];
  const deg = (Math.atan2(cross, dot) * 180) / Math.PI;
  if (Math.abs(deg) < 30) return "straight";
  if (Math.abs(deg) > 150) return "back";
  return deg > 0 ? "right" : "left";
}
const turnWords = t => (t === "straight" ? "go straight on" : t === "back" ? "turn around" : "turn " + t);

// Names a junction after the nearest room, skipping the room the walk started from.
function landmark(p, startRoom) {
  if (p.kind !== "junction") return p.label;
  let best = null, bestDist = Infinity;
  for (const door in roomsAt) {
    if (roomsAt[door].includes(startRoom)) continue;
    const n = nodeById[door], d = Math.hypot(n.x - p.x, n.y - p.y);
    if (d < bestDist) { bestDist = d; best = door; }
  }
  return `the corner by ${roomOn(roomsAt[best][0], p.floor)}`;
}

// Each instruction: { icon, text, from, to } where from..to are the path positions it covers.
function directions(r) {
  const ids = r.path, n = ids.length;
  if (n === 1) return [{ icon: "arrive", text: "You're already there.", from: 0, to: 0 }];
  const P = ids.map(placeOf);
  const hops = [];
  for (let i = 0; i + 1 < n; i++) {
    const pts = hopPoints(ids[i], ids[i + 1]);
    hops.push({
      steps: r.legs[i],
      stairs: P[i].floor !== P[i + 1].floor,
      dep: vec(pts[0], pts[1]),
      arr: vec(pts[pts.length - 2], pts[pts.length - 1]),
    });
  }
  const last = P[n - 1], endsAtRoom = last.kind === "room";
  const startRoom = P[0].kind === "room" ? groundId(P[0].id) : null;
  if (n === 3 && P[0].kind === "room" && endsAtRoom)
    return [{ icon: "arrive", text: `${last.label} is straight across the corridor from ${P[0].label}: ${r.steps} steps.`, from: 0, to: 2 }];

  const out = [];
  let walk = 0, since = 0;  // steps and path position since the last instruction
  for (let k = 1; k <= n - 2; k++) {
    const inHop = hops[k - 1], outHop = hops[k];
    if (inHop.stairs) { since = k; continue; }  // arrived by stairs, already described
    walk += inHop.steps;
    if (outHop.stairs) {
      let j = k, climb = 0;
      while (j < n - 1 && hops[j].stairs) climb += hops[j++].steps;
      out.push({ icon: "straight", text: `Walk ${walk} steps to ${P[k].label}.`, from: since, to: k });
      const up = P[j].floor > P[k].floor;
      out.push({ icon: up ? "up" : "down", text: `Take the stairs ${up ? "up" : "down"} to the ${FLOOR_NAMES[P[j].floor]} floor: ${climb} steps.`, from: k, to: j });
      walk = 0;
      since = j;
      continue;
    }
    const t = turn(inHop.arr, outHop.dep);
    if (k === 1) {
      out.push({ icon: "start", text: k === n - 2 && endsAtRoom ? `Leave ${P[0].label}.` : `Leave ${P[0].label} and ${turnWords(t)}.`, from: 0, to: 1 });
      continue;
    }
    if (k === n - 2 && endsAtRoom) continue;  // the last turn is into the room, described below
    if (t !== "straight") {
      out.push({ icon: t, text: `Walk ${walk} steps to ${landmark(P[k], startRoom)}, then ${turnWords(t)}.`, from: since, to: k });
      walk = 0;
      since = k;
    }
  }
  const lastHop = hops[n - 2];
  if (!lastHop.stairs) walk += lastHop.steps;
  let text;
  if (endsAtRoom && n >= 3 && !hops[n - 3].stairs) {
    const side = turn(hops[n - 3].arr, lastHop.dep);
    text = `Walk ${walk} steps. ${last.label} is ${side === "left" || side === "right" ? "on your " + side : "ahead of you"}.`;
  } else {
    text = walk ? `Walk ${walk} steps to ${last.label}.` : `You’ve arrived at ${last.label}.`;
  }
  out.push({ icon: "arrive", text, from: since, to: n - 1 });
  return out;
}

/* ---------- map ---------- */

const svg = $("map");
const roomEls = {};
let routeLayer, entryLayer;
let view = { ...FULL };

function S(tag, attrs, parent = svg) {
  const el = document.createElementNS(NS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  parent.appendChild(el);
  return el;
}
function label(text, x, y, cls, parent = svg) {
  const el = S("text", { x, y, "text-anchor": "middle", "dominant-baseline": "central", class: cls }, parent);
  el.textContent = text;
  return el;
}
const pathD = pts => "M" + pts.map(p => p.map(v => +v.toFixed(1)).join(" ")).join(" L");

const ENTRY_LABEL = {
  A_ENTRY: { rot: 0, dx: -11, dy: 3.5, anchor: "end", text: "Entry" },
  N2: { rot: -90, dx: -12, dy: 4, anchor: "end", text: "From C block" },  // left of the passage, clear of C_ENTRY
  N3: { rot: 0, dx: -4, dy: 20, anchor: "middle", text: "From C block" },
  B_ENTRY: { rot: -90, dx: 0, dy: 19, anchor: "middle", text: "Entry" },
  C_ENTRY: { rot: 90, dx: 0, dy: 18, anchor: "middle", text: "C block" },
};

function drawMap() {
  const hatch = S("pattern", { id: "hatch", width: 4, height: 4, patternUnits: "userSpaceOnUse" }, S("defs", {}));
  S("line", { x1: 0, y1: 0, x2: 0, y2: 4, class: "hatch-line" }, hatch);
  S("rect", { x: FULL.x - 900, y: FULL.y - 700, width: FULL.w + 1800, height: FULL.h + 1400, class: "sheet-bg" });

  const bands = S("g", {});
  plan.edges.forEach(e => {
    const pts = [[nodeById[e.from].x, nodeById[e.from].y], ...(e.via || []), [nodeById[e.to].x, nodeById[e.to].y]];
    S("path", { d: pathD(pts), class: "band" }, bands);
  });
  label("A", 365, 352, "court");
  label("B", 794, 607, "court");

  plan.rooms.forEach(r => {
    const [x1, y1, x2, y2] = r.rect, w = x2 - x1, h = y2 - y1, cx = x1 + w / 2, cy = y1 + h / 2;
    const rect = S("rect", { x: x1, y: y1, width: w, height: h, rx: 2, class: "room", "data-room": r.id });
    const text = label("", cx, cy, "room-label");
    if (w < 42 && h > w) text.setAttribute("transform", `rotate(90 ${cx} ${cy})`);
    roomEls[r.id] = { rect, text, title: S("title", {}, rect) };
  });

  entryLayer = S("g", {});
  plan.nodes.forEach(n => {
    if (n.kind === "stair") {
      S("rect", { x: -24, y: -9, width: 48, height: 18, class: "stair", transform: `translate(${n.x} ${n.y}) rotate(${n.rot})` });
    } else if (n.kind === "toilet") {
      S("rect", { x: n.x - 18, y: n.y - 11, width: 36, height: 22, rx: 5, class: "wc" });
      label(n.label.startsWith("Ladies") ? "Ladies" : "Gents", n.x, n.y, "small-label");
    } else if (n.kind === "entry") {
      const c = ENTRY_LABEL[n.id];
      S("path", { d: "M-7 -3.5 L1 -3.5 L1 -7 L7 0 L1 7 L1 3.5 L-7 3.5 Z", transform: `translate(${n.x} ${n.y}) rotate(${c.rot})`, class: "entry" }, entryLayer);
      S("text", { x: n.x + c.dx, y: n.y + c.dy, "text-anchor": c.anchor, class: "entry-label" }, entryLayer).textContent = c.text;
    }
  });
  routeLayer = S("g", {});
}

function buildFloorTabs() {
  const tabs = $("floor-tabs");
  floors().forEach(f => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-label", `${FLOOR_NAMES[f]} floor`);
    b.dataset.floor = f;
    b.textContent = FLOOR_SHORT[f];
    b.addEventListener("click", () => setFloor(f, { fit: true }));
    tabs.appendChild(b);
  });
}

// Floors the route walks on (not the ones it only passes on the stairs), in order.
function routeFloors() {
  if (!state.route) return [];
  const p = state.route.path.map(placeOf), seq = [];
  for (let i = 1; i < p.length; i++)
    if (p[i - 1].floor === p[i].floor && seq[seq.length - 1] !== p[i].floor) seq.push(p[i].floor);
  return seq.length ? seq : [p[0].floor];
}

function setFloor(f, { fit = false, animate = false } = {}) {
  state.floor = f;
  $("map-title").textContent = `${FLOOR_NAMES[f]} floor`;
  const seq = routeFloors();
  document.querySelectorAll("#floor-tabs button").forEach(b => {
    b.setAttribute("aria-selected", String(+b.dataset.floor === f));
    b.classList.toggle("on-route", seq.includes(+b.dataset.floor));
  });
  entryLayer.style.display = f === 0 ? "" : "none";
  for (const id in roomEls) {
    const name = roomOn(id, f), el = roomEls[id];
    el.text.textContent = name;
    el.title.textContent = name;
    el.rect.classList.toggle("start", state.start === name);
    el.rect.classList.toggle("end", state.end === name);
  }
  const at = seq.indexOf(f), next = at >= 0 ? seq[at + 1] : undefined;
  const cont = $("continue");
  cont.hidden = next == null;
  if (next != null) {
    cont.innerHTML = `<svg aria-hidden="true"><use href="#i-${next > f ? "up" : "down"}"/></svg>`;
    cont.append(`Continue on the ${FLOOR_NAMES[next]} floor`);
    cont.onclick = () => setFloor(next, { fit: true, animate: true });
  }
  const box = drawRoute(animate);
  if (fit) fitBox(box || FULL);
}

// Draws the route's parts on this floor; returns their bounding box, if any.
function drawRoute(animate) {
  routeLayer.replaceChildren();
  const r = state.route;
  if (!r) return null;
  const ids = r.path, pts = [], lines = [];
  let line = [];
  const flush = () => { if (line.length > 1) lines.push(line); line = []; };
  for (let i = 0; i + 1 < ids.length; i++) {
    const a = placeOf(ids[i]), b = placeOf(ids[i + 1]);
    if (a.floor !== state.floor || b.floor !== state.floor) {
      for (const s of [a, b]) if (s.floor === state.floor && s.kind === "stair") S("circle", { cx: s.x, cy: s.y, r: 7, class: "pin-stairs" }, routeLayer);
      flush();
      continue;
    }
    if (a.kind === "room" || b.kind === "room") continue;  // the line runs door to door; rooms are highlighted
    const hop = hopPoints(ids[i], ids[i + 1]);
    line.push(...(line.length ? hop.slice(1) : hop));
  }
  flush();
  for (const l of lines) {
    S("path", { d: pathD(l), class: "route-casing" }, routeLayer);
    const path = S("path", { d: pathD(l), class: "route-line" }, routeLayer);
    if (animate) {
      const len = path.getTotalLength();
      path.style.strokeDasharray = len;
      path.style.setProperty("--len", len);
      path.classList.add("draw");
    }
    pts.push(...l);
  }
  // The direction step tapped in the list, if any.
  if (state.focus) {
    const part = [];
    for (let i = state.focus.from; i < state.focus.to; i++) {
      const a = placeOf(ids[i]), b = placeOf(ids[i + 1]);
      if (a.floor !== state.floor || b.floor !== state.floor) continue;
      const hop = hopPoints(ids[i], ids[i + 1]);
      part.push(...(part.length ? hop.slice(1) : hop));
    }
    if (part.length > 1) {
      S("path", { d: pathD(part), class: "route-focus" }, routeLayer);
      pts.length = 0;
      pts.push(...part);
    }
  }
  // Pins sit at the start and end doors, so the room numbers stay readable.
  const ends = ids.map(placeOf);
  const first = ends[0].kind === "room" && ends.length > 1 ? ends[1] : ends[0];
  const last = ends[ends.length - 1].kind === "room" && ends.length > 1 ? ends[ends.length - 2] : ends[ends.length - 1];
  if (first.floor === state.floor) {
    S("circle", { cx: first.x, cy: first.y, r: 8, class: "pin-start" }, routeLayer);
    if (!state.focus) pts.push([first.x, first.y]);
  }
  if (last.floor === state.floor) {
    S("path", { d: `M${last.x} ${last.y} l-9 -16 a10 10 0 1 1 18 0 z`, class: "pin-end" }, routeLayer);
    if (!state.focus) pts.push([last.x, last.y - 22]);
  }
  if (!state.focus)  // keep the highlighted start and end rooms in view too
    for (const p of [ends[0], ends[ends.length - 1]])
      if (p.kind === "room" && p.floor === state.floor) {
        const [x1, y1, x2, y2] = roomById[groundId(p.id)].rect;
        pts.push([x1, y1], [x2, y2]);
      }
  if (!pts.length) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/* ---------- pan and zoom ---------- */

function aspect() {
  const r = svg.getBoundingClientRect();
  return r.width && r.height ? r.height / r.width : FULL.h / FULL.w;
}
function applyView() {
  svg.setAttribute("viewBox", `${view.x.toFixed(1)} ${view.y.toFixed(1)} ${view.w.toFixed(1)} ${view.h.toFixed(1)}`);
}
// The part of the map not covered by the floating search and the bottom sheet (phones).
function openArea() {
  const r = svg.getBoundingClientRect();
  const area = { left: 12, right: 64, top: 12, bottom: 12 };
  if (isPhone()) {
    area.top = Math.max(area.top, $("panel-top").getBoundingClientRect().bottom - r.top + 8);
    area.bottom = Math.max(area.bottom, r.bottom - $("sheet").getBoundingClientRect().top + 8);
    area.bottom += 52;  // the zoom row
    if (!$("continue").hidden) area.bottom += 50;  // room for "Continue on the … floor"
  } else {
    area.top = 56;
  }
  return { x: area.left, y: area.top, w: Math.max(r.width - area.left - area.right, 80), h: Math.max(r.height - area.top - area.bottom, 80), width: r.width, height: r.height };
}
function fitBox(b) {
  const pad = b === FULL ? 0 : 24, o = openArea();
  if (!o.width) return;
  const bw = Math.max(b.w + pad * 2, 160), bh = Math.max(b.h + pad * 2, 120);
  // drawing units per screen pixel; capped so short routes keep their surroundings in view
  const scale = Math.max(bw / o.w, bh / o.h, isPhone() ? 0.9 : 0.55);
  view = {
    x: b.x + b.w / 2 - (o.x + o.w / 2) * scale,
    y: b.y + b.h / 2 - (o.y + o.h / 2) * scale,
    w: o.width * scale,
    h: o.height * scale,
  };
  applyView();
}
function zoomAt(factor, cx, cy) {
  const w = Math.min(Math.max(view.w * factor, 120), FULL.w * 1.4), h = w * aspect();
  view = { x: cx - ((cx - view.x) * w) / view.w, y: cy - ((cy - view.y) * h) / view.h, w, h };
  keepInside();
  applyView();
}
function keepInside() {
  const mx = view.w * 0.6, my = view.h * 0.6;
  view.x = Math.min(Math.max(view.x, FULL.x - mx), FULL.x + FULL.w - view.w + mx);
  view.y = Math.min(Math.max(view.y, FULL.y - my), FULL.y + FULL.h - view.h + my);
}
function toMap(clientX, clientY) {
  const r = svg.getBoundingClientRect();
  return [view.x + ((clientX - r.left) / r.width) * view.w, view.y + ((clientY - r.top) / r.height) * view.h];
}

function bindMapGestures() {
  const pointers = new Map();
  let moved = 0, pinch = null, dragRect = null;
  svg.addEventListener("pointerdown", e => {
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) { moved = 0; dragRect = null; }
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      pinch = { d: Math.hypot(p[0] - q[0], p[1] - q[1]), w: view.w };
    }
  });
  svg.addEventListener("pointermove", e => {
    if (!pointers.has(e.pointerId)) return;
    const [px, py] = pointers.get(e.pointerId);
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
    if (pointers.size === 1) {
      const r = dragRect || (dragRect = svg.getBoundingClientRect());
      view.x -= ((e.clientX - px) / r.width) * view.w;
      view.y -= ((e.clientY - py) / r.height) * view.h;
      moved += Math.abs(e.clientX - px) + Math.abs(e.clientY - py);
      if (moved > 4) svg.classList.add("dragging");
      keepInside();
      applyView();
    } else if (pointers.size === 2 && pinch) {
      const [p, q] = [...pointers.values()];
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      const [cx, cy] = toMap((p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
      zoomAt((pinch.w * (pinch.d / d)) / view.w, cx, cy);
      moved = 99;
    }
  });
  const end = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    svg.classList.remove("dragging");
    if (e.type === "pointerup" && pointers.size === 0 && moved <= 4) {
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const room = hit && hit.closest && hit.closest("[data-room]");
      if (room) pickRoom(roomOn(room.dataset.room, state.floor));
    }
  };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    const [cx, cy] = toMap(e.clientX, e.clientY);
    zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, cx, cy);
  }, { passive: false });
  const center = () => [view.x + view.w / 2, view.y + view.h / 2];
  $("zoom-in").addEventListener("click", () => zoomAt(1 / 1.35, ...center()));
  $("zoom-out").addEventListener("click", () => zoomAt(1.35, ...center()));
  $("zoom-fit").addEventListener("click", () => fitBox(drawRoute(false) || (isPhone() ? BLOCK_A : FULL)));
  let lastWidth = svg.getBoundingClientRect().width;
  new ResizeObserver(() => {
    const w = svg.getBoundingClientRect().width;
    if (!w) return;
    if (Math.abs(w - lastWidth) > 40) {
      fitBox(drawRoute(false) || FULL);
    } else {
      const cx = view.x + view.w / 2, cy = view.y + view.h / 2;
      view.h = view.w * aspect();
      view.x = cx - view.w / 2;
      view.y = cy - view.h / 2;
      applyView();
    }
    lastWidth = w;
  }).observe(svg);
}

/* ---------- events ---------- */

const isPhone = () => window.matchMedia("(max-width: 899px)").matches;

function openSheet(open) {
  $("sheet").classList.toggle("open", open);
  $("map-frame").classList.toggle("sheet-open", open);
  $("handle").setAttribute("aria-expanded", String(open));
}

function bindEvents() {
  const toggle = () => openSheet(!$("sheet").classList.contains("open"));
  $("handle").addEventListener("click", toggle);
  $("summary-route").addEventListener("click", () => isPhone() && toggle());
  // Route as soon as both boxes name a known place (picking from the suggestions, or leaving a box).
  for (const id of ["from", "to"])
    $(id).addEventListener("change", () => { if (resolve($("from").value) && resolve($("to").value)) findRoute(); });
  new ResizeObserver(() => $("map-frame").style.setProperty("--sheet-h", $("sheet").offsetHeight + "px")).observe($("sheet"));
  new ResizeObserver(() => $("map-frame").style.setProperty("--panel-h", $("panel-top").getBoundingClientRect().bottom + "px")).observe($("panel-top"));
  $("route-form").addEventListener("submit", ev => {
    ev.preventDefault();
    findRoute();
  });
  $("swap").addEventListener("click", () => {
    const from = $("from"), to = $("to");
    [from.value, to.value] = [to.value, from.value];
    if (from.value && to.value) findRoute();
  });
  document.querySelectorAll("[data-near]").forEach(b => b.addEventListener("click", () => findNearest(b.dataset.near)));
  window.addEventListener("hashchange", openFromHash);
  bindMapGestures();
}

function pickRoom(name) {
  const from = $("from"), to = $("to");
  if (from.value && !to.value) {
    to.value = name;
    findRoute();
    return;
  }
  from.value = name;
  to.value = "";
  Object.assign(state, { route: null, start: name, end: null, focus: null });
  showHome();
  say(`Starting from ${name}. Now tap or type where you’re going.`);
  setFloor(state.floor);
}

function showDataNote() {
  const measured = plan.edges.filter(e => e.steps != null).length;
  $("data-note").textContent =
    `Distances are walking steps: ${measured} of ${plan.edges.length} corridor segments were counted on foot by our team, the rest worked out from those counts. ` +
    `Stairs are about ${plan.meta.stairFlightEst} steps per floor. Times assume about ${STEPS_PER_MIN} steps a minute.`;
}

/* ---------- your section's classes ---------- */

const SECTION_KEY = "kmap-section";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ENTRANCE = "A_ENTRY@0";  // where the first class of the day is walked from
const AUTO_ROUTE_MINUTES = 10;  // open the way to the next class this close to its start
let shownDay = null;
let autoRouted = false;

function mySection() {
  let id = null;
  try { id = localStorage.getItem(SECTION_KEY); } catch (e) {}
  return timetable && timetable.sections[id] ? timetable.sections[id] : null;
}

function setupSection() {
  if (!timetable) return;
  const dialog = $("section-dialog"), options = $("section-options");
  for (const id in timetable.sections) {
    const s = timetable.sections[id], b = document.createElement("button");
    b.value = id;
    b.className = "section-option";
    b.innerHTML = "<b></b><span></span>";
    b.firstChild.textContent = s.name;
    b.lastChild.textContent = s.semester;
    options.appendChild(b);
  }
  dialog.addEventListener("close", () => {
    try { localStorage.setItem(SECTION_KEY, dialog.returnValue || "none"); } catch (e) {}
    shownDay = null;
    if (!state.route) showHome();
    updateChip();
  });
  $("section-chip").addEventListener("click", () => dialog.showModal());
  $("back-classes").addEventListener("click", () => {
    history.replaceState(null, "", location.pathname);
    Object.assign(state, { route: null, start: null, end: null, focus: null });
    $("from").value = $("to").value = "";
    showHome();
    setFloor(state.floor);
  });
  updateChip();
  let asked = null;
  try { asked = localStorage.getItem(SECTION_KEY); } catch (e) {}
  if (asked == null && !location.hash) dialog.showModal();
}

function updateChip() {
  const s = mySection(), chip = $("section-chip");
  chip.hidden = !timetable;
  chip.textContent = s ? s.name : "Pick section";
}

// The home state of the panel: your classes if a section is chosen, else the examples.
function showHome() {
  const s = mySection();
  $("summary-route").hidden = true;
  $("directions").hidden = true;
  $("summary-empty").hidden = !!s;
  $("classes").hidden = !s;
  $("class-list").hidden = !s;
  if (s) showClasses(s);
}

const minutes = hhmm => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3);
const subjectName = (s, code) => s.subjects[code] || code;
const walkMinutes = steps => (steps < 75 ? "under 1 min" : `about ${Math.round(steps / STEPS_PER_MIN)} min`);

// A day's classes with back-to-back periods of the same subject and room joined into one
// block (the 2-hour labs), and the walk to each block from the one before it.
function dayPlan(s, day) {
  const blocks = [];
  for (const c of s.days[day] || []) {
    const last = blocks[blocks.length - 1];
    if (last && last.subject === c.subject && last.room === c.room && last.end === c.start) last.end = c.end;
    else blocks.push({ ...c });
  }
  blocks.forEach((b, i) => {
    b.from = i ? blocks[i - 1].room : ENTRANCE;
    const r = b.from === b.room ? { found: true, steps: 0 } : route(b.from, b.room);
    b.steps = r.found ? r.steps : null;
    b.gapBefore = i ? minutes(b.start) - minutes(blocks[i - 1].end) : 0;  // free time before it
  });
  return blocks;
}

function showClasses(s) {
  const now = new Date(), today = now.getDay();
  if (shownDay == null) shownDay = s.days[today] ? today : +Object.keys(s.days)[0];
  const isToday = shownDay === today;

  // day chips
  $("days").replaceChildren(...Object.keys(s.days).map(d => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(+d === shownDay));
    b.setAttribute("aria-label", DAY_NAMES[d]);
    b.textContent = DAY_NAMES[d].slice(0, 3);
    if (+d === today) b.classList.add("today");
    b.addEventListener("click", () => { shownDay = +d; showClasses(s); });
    return b;
  }));

  const plan = dayPlan(s, shownDay);
  const total = plan.reduce((sum, b) => sum + (b.steps || 0), 0);
  $("classes-title").textContent = isToday ? "Your classes today" : `Your classes on ${DAY_NAMES[shownDay]}`;
  $("day-walk").textContent = plan.length ? `About ${total} steps of walking between classes, ${walkMinutes(total).replace("about ", "")} in all.` : "";

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const current = isToday ? plan.findIndex(b => minutes(b.start) <= nowMin && nowMin < minutes(b.end)) : -1;
  const next = isToday ? plan.findIndex(b => minutes(b.start) > nowMin) : -1;
  showNextCard(s, plan, isToday, today, current, next);
  showDay(s, plan, current, next);

  // Opening K Map just before a class goes straight to the way there (once per visit).
  if (isToday && next >= 0 && !autoRouted && !location.hash && minutes(plan[next].start) - nowMin <= AUTO_ROUTE_MINUTES && plan[next].steps) {
    autoRouted = true;
    goTo(plan[next]);
    say(`${plan[next].subject} starts at ${plan[next].start}. Here’s the way to ${plan[next].room}.`);
  }
}

// The card for what matters right now.
function showNextCard(s, plan, isToday, today, current, next) {
  const card = $("next-class");
  card.replaceChildren();
  if (!isToday) return;
  const add = (text, label, onClick) => {
    const p = document.createElement("p");
    p.className = "next-text";
    p.textContent = text;
    card.appendChild(p);
    if (!label) return;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "next-go";
    b.textContent = label;
    b.addEventListener("click", onClick);
    card.appendChild(b);
  };
  if (next >= 0) {
    const n = plan[next];
    const now = current >= 0 ? `Now ${plan[current].subject} in ${plan[current].room}. ` : "";
    const label = n.steps ? `Show the way, ${n.steps} steps (${walkMinutes(n.steps)})` : "Same room, no need to move";
    const who = (s.teachers || {})[n.subject];
    add(`${now}Next ${n.subject}${who ? ` with ${who}` : ""} at ${n.start} in ${n.room}.`, label, () => n.steps && goTo(n));
    return;
  }
  if (current >= 0) return add(`Now ${plan[current].subject} in ${plan[current].room}, until ${plan[current].end}. It’s the last class today.`);
  // Today is over: point at the next day with classes.
  for (let k = 1; k <= 7; k++) {
    const d = (today + k) % 7, first = (s.days[d] || [])[0];
    if (!first) continue;
    const when = k === 1 ? "Tomorrow" : DAY_NAMES[d];
    const start = plan.length ? "No more classes today." : "No classes today.";
    add(`${start} ${when}, ${first.subject} at ${first.start} in ${first.room}.`, `See ${k === 1 ? "tomorrow" : DAY_NAMES[d]}’s classes`,
        () => { shownDay = d; showClasses(s); openSheet(true); });
    return;
  }
  add("No classes this week.");
}

// The full list of the chosen day: classes, with free periods between them.
function showDay(s, plan, current, next) {
  const rows = [];
  plan.forEach((b, i) => {
    if (b.gapBefore >= 30) {
      const free = document.createElement("li");
      free.className = "free";
      free.textContent = `Free, ${plan[i - 1].end} to ${b.start}`;
      rows.push(free);
    }
    const li = document.createElement("li");
    if (i === current) li.classList.add("now");
    if (i === next) li.classList.add("next");
    const row = document.createElement("button");
    row.type = "button";
    row.className = "class-row";
    row.innerHTML = '<span class="when"><b></b><small></small></span><span class="what"><b></b><small></small></span><span class="walk"><b></b><small></small></span>';
    const [when, what, walk] = row.children;
    when.firstChild.textContent = b.start;
    when.lastChild.textContent = b.end;
    what.firstChild.textContent = `${b.subject} in ${b.room}`;
    const teacher = (s.teachers || {})[b.subject];
    what.lastChild.textContent = subjectName(s, b.subject) + (teacher ? `, ${teacher}` : "") + (minutes(b.end) - minutes(b.start) > 60 ? ", 2 periods" : "");
    if (b.steps === 0) walk.firstChild.textContent = "same room";
    else if (b.steps != null) {
      walk.firstChild.textContent = `${b.steps} steps`;
      walk.lastChild.textContent = walkMinutes(b.steps);
    }
    row.addEventListener("click", () => (b.steps ? goTo(b) : say(`${b.subject} is in the same room as the class before, ${b.room}.`)));
    li.appendChild(row);
    rows.push(li);
  });
  $("class-list").replaceChildren(...rows);
}

// Shows the route to a class from the class before it (or from the main entrance).
function goTo(b) {
  $("from").value = labelFor(b.from);
  $("to").value = b.room;
  findRoute();
}

/* ---------- arrow keys on the day and floor tabs ---------- */

function arrowKeysOn(list) {
  list.addEventListener("keydown", e => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(e.key in keys)) return;
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    // the floor picker is drawn bottom-up (G at the bottom), so up means the next floor
    const step = list.id === "floor-tabs" && (e.key === "ArrowUp" || e.key === "ArrowDown") ? -keys[e.key] : keys[e.key];
    const next = tabs[(i + step + tabs.length) % tabs.length];
    next.click();
    const again = list.querySelector(`[role="tab"][aria-label="${next.getAttribute("aria-label")}"]`);
    (again || next).focus();
  });
}
arrowKeysOn($("days"));
arrowKeysOn($("floor-tabs"));
