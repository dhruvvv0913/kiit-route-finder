// Website glue. The shortest-path work happens in C++ (cpp/graph.cpp), compiled to
// router.js + router.wasm. This file loads the plan, turns what people type into graph
// places, asks the C++ for a route, and shows it as directions and on the map.
"use strict";

const FLOOR_NAMES = ["Ground", "1st", "2nd", "3rd"];
const NS = "http://www.w3.org/2000/svg";
const $ = id => document.getElementById(id);

let plan, router;
const nodeById = {}, roomById = {}, roomsAt = {}, viaFor = {};
const places = new Map();  // what a person can type (upper case) -> graph place id
const state = { floor: 0, route: null, start: null, end: null };

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
    router = module;
    const error = router.ccall("load_graph", "string", ["string"], [graphText]);
    if (error) throw new Error(error);
  } catch (err) {
    say(`The route finder didn't load (${err.message}). Refresh the page to try again.`, true);
    return;
  }
  indexPlan();
  listPlaces();
  drawMap();
  buildTabs();
  bindEvents();
  showDataNote();
  $("go").disabled = false;
  say("");
  const link = decodeURIComponent(location.hash.slice(1)).match(/^([^-]+)-(.+)$/);
  if (link) {
    $("from").value = link[1];
    $("to").value = link[2];
    findRoute();
  } else {
    setFloor(0);
  }
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

function listPlaces() {
  const options = $("places");
  const add = (text, id, show) => {
    places.set(text.toUpperCase(), id);
    if (!show) return;
    const o = document.createElement("option");
    o.value = text;
    options.appendChild(o);
  };
  for (const f of plan.meta.floors) {
    plan.rooms.forEach(r => add(roomOn(r.id, f), roomOn(r.id, f), true));
    plan.nodes.forEach(n => {
      const named = n.kind === "toilet" || n.kind === "stair" || (n.kind === "entry" && f === 0);
      if (named) add(`${n.label} · ${FLOOR_NAMES[f]} floor`, `${n.id}@${f}`, true);
      if (named || n.kind === "entry") add(`${n.id}@${f}`, `${n.id}@${f}`, false);  // for #links
    });
  }
}

function resolve(text) {
  const t = text.trim().replace(/\s+/g, " ").toUpperCase();
  return places.get(t) || places.get(t.replace(/[\s-]/g, "")) || null;
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
const fullLabel = p => (p.kind === "room" ? p.label : `${p.label}, ${FLOOR_NAMES[p.floor]} floor`);

function hopPoints(a, b) {
  const pa = placeOf(a), pb = placeOf(b);
  const via = pa.base && pb.base && pa.floor === pb.floor ? viaFor[pa.base + "|" + pb.base] || [] : [];
  return [[pa.x, pa.y], ...via, [pb.x, pb.y]];
}

/* ---------- finding a route ---------- */

function findRoute() {
  const fromText = $("from").value, toText = $("to").value;
  const a = resolve(fromText), b = resolve(toText);
  if (!a) return fail(`Couldn't find "${fromText.trim()}". Try a room number like A207.`);
  if (!b) return fail(`Couldn't find "${toText.trim()}". Try a room number like B212.`);

  const route = JSON.parse(router.ccall("find_route", "string", ["string", "string"], [a, b]));
  if (route.unknown) return fail(`"${route.unknown}" isn't on the map.`);
  if (!route.found) {
    const pa = placeOf(a), pb = placeOf(b);
    return fail(pa.floor !== pb.floor
      ? `${fullLabel(pa)} and ${fullLabel(pb)} are on different floors. Routes between floors need the stair step counts, which aren't in yet. Pick two places on the same floor for now.`
      : `No route found between ${fullLabel(pa)} and ${fullLabel(pb)}.`);
  }

  Object.assign(state, { route, start: a, end: b });
  const estimated = !plan.meta.final && plan.edges.some(e => e.steps == null);
  $("total").textContent = (estimated ? "≈" : "") + route.steps;
  $("summary-places").textContent = `${fullLabel(placeOf(a))} → ${fullLabel(placeOf(b))}`;
  const list = $("directions");
  list.replaceChildren(...directions(route).map(text => {
    const li = document.createElement("li");
    li.textContent = text;
    return li;
  }));
  const startFloor = placeOf(a).floor, endFloor = placeOf(b).floor;
  const floorsNote = $("floors-note");
  floorsNote.hidden = startFloor === endFloor;
  floorsNote.textContent = `This route starts on the ${FLOOR_NAMES[startFloor]} floor and ends on the ${FLOOR_NAMES[endFloor]} floor. Switch floors above the map to see each part.`;
  $("result").hidden = false;
  say("");
  history.replaceState(null, "", "#" + a + "-" + b);
  setFloor(placeOf(a).floor);
}

function fail(message) {
  Object.assign(state, { route: null, start: null, end: null });
  $("result").hidden = true;
  say(message, true);
  setFloor(state.floor);
}

/* ---------- turn-by-turn directions ---------- */

const vec = (p, q) => [q[0] - p[0], q[1] - p[1]];

// Map y points down, so a positive cross product is a clockwise (right) turn.
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
  return `the junction by ${roomOn(roomsAt[best][0], p.floor)}`;
}

function directions(route) {
  const ids = route.path, n = ids.length;
  if (n === 1) return ["You're already there."];
  const P = ids.map(placeOf);
  const hops = [];
  for (let i = 0; i + 1 < n; i++) {
    const pts = hopPoints(ids[i], ids[i + 1]);
    hops.push({
      steps: route.legs[i],
      stairs: P[i].floor !== P[i + 1].floor,
      dep: vec(pts[0], pts[1]),
      arr: vec(pts[pts.length - 2], pts[pts.length - 1]),
    });
  }
  const last = P[n - 1], endsAtRoom = last.kind === "room";
  if (n === 3 && P[0].kind === "room" && endsAtRoom)
    return [`${last.label} is straight across the corridor from ${P[0].label}: ${route.steps} steps.`];

  const out = [];
  let walk = 0;  // steps since the last instruction
  for (let k = 1; k <= n - 2; k++) {
    const inHop = hops[k - 1], outHop = hops[k];
    if (inHop.stairs) continue;  // arrived by stairs, already described
    walk += inHop.steps;
    if (outHop.stairs) {
      let j = k, climb = 0;
      while (j < n - 1 && hops[j].stairs) climb += hops[j++].steps;
      out.push(`Walk ${walk} steps to ${P[k].label}.`);
      out.push(`Take the stairs ${P[j].floor > P[k].floor ? "up" : "down"} to the ${FLOOR_NAMES[P[j].floor]} floor: ${climb} steps.`);
      walk = 0;
      continue;
    }
    const t = turn(inHop.arr, outHop.dep);
    if (k === 1) {
      out.push(k === n - 2 && endsAtRoom ? `Leave ${P[0].label}.` : `Leave ${P[0].label} and ${turnWords(t)}.`);
      continue;
    }
    if (k === n - 2 && endsAtRoom) continue;  // the last turn is into the room, described below
    if (t !== "straight") {
      out.push(`Walk ${walk} steps to ${landmark(P[k], P[0].kind === "room" ? groundId(P[0].id) : null)}, then ${turnWords(t)}.`);
      walk = 0;
    }
  }
  const lastHop = hops[n - 2];
  if (!lastHop.stairs) walk += lastHop.steps;
  if (endsAtRoom && n >= 3 && !hops[n - 3].stairs) {
    const side = turn(hops[n - 3].arr, lastHop.dep);
    out.push(`Walk ${walk} steps. ${last.label} is ${side === "left" || side === "right" ? "on your " + side : "ahead of you"}.`);
  } else {
    out.push(walk ? `Walk ${walk} steps to ${last.label}.` : `You've arrived at ${last.label}.`);
  }
  return out;
}

/* ---------- map ---------- */

const svg = $("map");
const roomEls = {};
let routeLayer, entryLayer;

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
const pathD = pts => "M" + pts.map(p => p.join(" ")).join(" L");

const ENTRY_LABEL = {
  N1: { rot: 0, dx: -11, dy: 3.5, anchor: "end", text: "Entry" },
  N2: { rot: -90, dx: 0, dy: 19, anchor: "middle", text: "From C block" },
  N3: { rot: 0, dx: -4, dy: 20, anchor: "middle", text: "From C block" },  // below the C-block passage
  N4: { rot: -90, dx: 0, dy: 19, anchor: "middle", text: "Entry" },
};

function drawMap() {
  const hatch = S("pattern", { id: "hatch", width: 4, height: 4, patternUnits: "userSpaceOnUse" }, S("defs", {}));
  S("line", { x1: 0, y1: 0, x2: 0, y2: 4, class: "hatch-line" }, hatch);
  S("rect", { x: 160, y: 132, width: 890, height: 680, class: "sheet-bg" });

  const bands = S("g", {});
  plan.edges.forEach(e => {
    const pts = [[nodeById[e.from].x, nodeById[e.from].y], ...(e.via || []), [nodeById[e.to].x, nodeById[e.to].y]];
    S("path", { d: pathD(pts), class: "band" }, bands);
  });
  label("A", 365, 352, "court");
  label("B", 794, 607, "court");

  plan.rooms.forEach(r => {
    const [x1, y1, x2, y2] = r.rect, w = x2 - x1, h = y2 - y1, cx = x1 + w / 2, cy = y1 + h / 2;
    const rect = S("rect", { x: x1, y: y1, width: w, height: h, class: "room", "data-room": r.id });
    const text = label("", cx, cy, "room-label");
    if (w < 42 && h > w) text.setAttribute("transform", `rotate(90 ${cx} ${cy})`);
    roomEls[r.id] = { rect, text, title: S("title", {}, rect) };
  });

  entryLayer = S("g", {});
  plan.nodes.forEach(n => {
    if (n.kind === "stair") {
      S("rect", { x: -24, y: -9, width: 48, height: 18, class: "stair", transform: `translate(${n.x} ${n.y}) rotate(${n.rot})` });
    } else if (n.kind === "toilet") {
      S("rect", { x: n.x - 18, y: n.y - 11, width: 36, height: 22, rx: 4, class: "wc" });
      label(n.label.startsWith("Ladies") ? "WC · L" : "WC · G", n.x, n.y, "small-label");
    } else if (n.kind === "entry") {
      const c = ENTRY_LABEL[n.id];
      S("path", { d: "M-7 -3.5 L1 -3.5 L1 -7 L7 0 L1 7 L1 3.5 L-7 3.5 Z", transform: `translate(${n.x} ${n.y}) rotate(${c.rot})`, class: "entry" }, entryLayer);
      S("text", { x: n.x + c.dx, y: n.y + c.dy, "text-anchor": c.anchor, class: "entry-label" }, entryLayer).textContent = c.text;
    }
  });
  routeLayer = S("g", {});
}

function buildTabs() {
  const tabs = $("floor-tabs");
  FLOOR_NAMES.forEach((name, f) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.dataset.floor = f;
    b.textContent = name;
    b.addEventListener("click", () => setFloor(f));
    tabs.appendChild(b);
  });
}

function setFloor(f) {
  state.floor = f;
  $("map-title").textContent = `${FLOOR_NAMES[f]} floor`;
  const routeFloors = new Set(state.route ? state.route.path.map(id => placeOf(id).floor) : []);
  document.querySelectorAll("#floor-tabs button").forEach(b => {
    b.setAttribute("aria-selected", String(+b.dataset.floor === f));
    b.classList.toggle("on-route", routeFloors.has(+b.dataset.floor));
  });
  entryLayer.style.display = f === 0 ? "" : "none";
  for (const id in roomEls) {
    const name = roomOn(id, f), el = roomEls[id];
    el.text.textContent = name;
    el.title.textContent = `${name}: click to route from or to this room`;
    el.rect.classList.toggle("start", state.start === name);
    el.rect.classList.toggle("end", state.end === name);
  }
  drawRoute();
}

function drawRoute() {
  routeLayer.replaceChildren();
  const route = state.route;
  if (!route) return;
  const ids = route.path;
  let line = [];
  const flush = () => {
    if (line.length > 1) S("path", { d: pathD(line), class: "route-line" }, routeLayer);
    line = [];
  };
  for (let i = 0; i + 1 < ids.length; i++) {
    const a = placeOf(ids[i]), b = placeOf(ids[i + 1]);
    if (a.floor !== state.floor || b.floor !== state.floor) { flush(); continue; }
    const pts = hopPoints(ids[i], ids[i + 1]);
    line.push(...(line.length ? pts.slice(1) : pts));
  }
  flush();
  // Rooms are already highlighted; other start/end places (toilets, entries, stairs) get a dot.
  const first = placeOf(ids[0]), last = placeOf(ids[ids.length - 1]);
  if (first.kind !== "room" && first.floor === state.floor) S("circle", { cx: first.x, cy: first.y, r: 7, class: "marker start" }, routeLayer);
  if (last.kind !== "room" && last.floor === state.floor) S("circle", { cx: last.x, cy: last.y, r: 7, class: "marker end" }, routeLayer);
}

/* ---------- events ---------- */

function bindEvents() {
  $("route-form").addEventListener("submit", ev => {
    ev.preventDefault();
    findRoute();
  });
  $("swap").addEventListener("click", () => {
    const from = $("from"), to = $("to");
    [from.value, to.value] = [to.value, from.value];
    if (from.value && to.value) findRoute();
  });
  svg.addEventListener("click", ev => {
    const rect = ev.target.closest("[data-room]");
    if (rect) pickRoom(roomOn(rect.dataset.room, state.floor));
  });
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
  Object.assign(state, { route: null, start: name, end: null });
  $("result").hidden = true;
  say(`Starting from ${name}. Now click or type where you're going.`);
  setFloor(state.floor);
}

function showDataNote() {
  const measured = plan.edges.filter(e => e.steps != null).length;
  const stairs = plan.nodes.filter(n => n.kind === "stair");
  const counted = stairs.filter(n => n.flightSteps != null).length;
  const demo = !plan.meta.final && (measured < plan.edges.length || counted < stairs.length);
  $("demo-badge").hidden = !demo;
  if (!demo) {
    $("data-note").textContent =
      `Distances are walking steps. ${measured} of ${plan.edges.length} corridor segments were counted on foot by our team; ` +
      `the rest are worked out from those counts. Stairs are about ${plan.meta.stairFlightEst} steps per floor.`;
    return;
  }
  $("data-note").textContent =
    `${demo ? "Demo mode. " : ""}${measured} of ${plan.edges.length} corridor segments have been measured; the rest are estimated from the floor plan. ` +
    `${counted} of ${stairs.length} staircases counted; the rest use about ${plan.meta.stairFlightEst} steps per floor.`;
}
