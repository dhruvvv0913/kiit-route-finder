// The shared step-counting form. Walks come from walks.json; numbers are saved through
// api/counts (see api/counts.js), and anything not yet saved is kept on the phone and retried.
"use strict";

const $ = id => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
const PENDING_KEY = "kiit-count-pending-v1";
const API = "api/counts.js";  // on this Vercel project the function answers at its file name

let plan, walks;
const nodes = {}, roomsAt = {};
const tasks = [];       // the walks, then the short counts, then the one-off counts
let saved = {};         // key -> { value, at }: what everyone has saved
let pending = {};       // key -> value typed on this phone but not saved yet
const state = {};       // key -> "saving" | "saved" | "waiting" | "error: …"

try { pending = JSON.parse(localStorage.getItem(PENDING_KEY) || "{}") || {}; } catch (e) { pending = {}; }
const keepPending = () => { try { localStorage.setItem(PENDING_KEY, JSON.stringify(pending)); } catch (e) {} };

start();

async function start() {
  try {
    [plan, walks] = await Promise.all([getJson("floor-graph.json"), getJson("walks.json")]);
  } catch (err) {
    banner(`The form didn't load (${err.message}). Refresh the page to try again.`);
    return;
  }
  plan.nodes.forEach(n => (nodes[n.id] = n));
  plan.rooms.forEach(r => (roomsAt[r.door] ||= []).push(r.id));
  walks.walks.forEach(w => tasks.push({
    id: w.id, title: w.title, walk: w, where: `Starts at ${w.startText}`,
    stops: w.stops.map((s, i) => ({ key: `${w.id}-${i}`, label: s.label || (roomsAt[s.node] || []).join(" / ") })),
  }));
  tasks.push({ id: "short", title: "Short counts", where: "Toilets, entries and the first step of each staircase",
    stops: walks.short.map(s => ({ key: `short-${s.edge}`, label: s.text })) });
  tasks.push({ id: "once", title: "Two one-off counts", where: "Across a corridor, and one staircase",
    stops: walks.once.map(o => ({ key: `once-${o.id}`, label: o.text })) });

  window.addEventListener("hashchange", show);
  window.addEventListener("online", sendPending);
  show();
  await load();
  sendPending();
  setInterval(() => { load(); sendPending(); }, 15000);
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

function banner(text) {
  const el = $("banner");
  el.hidden = !text;
  el.textContent = text || "";
}

/* ---------- talking to the server ---------- */

async function load() {
  try {
    const res = await fetch(API, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `the server answered ${res.status}`);
    saved = data.counts || {};
    banner("");
  } catch (err) {
    banner(`${err.message} Numbers you type are kept on this phone and will save once it works.`);
  }
  update();
}

async function send(key, value) {
  state[key] = "saving";
  update();
  try {
    const res = await fetch(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 400) {  // the server refused this number; keeping it won't help
      delete pending[key];
      keepPending();
      state[key] = "error: " + data.error;
    } else if (!res.ok) {
      throw new Error(data.error);
    } else {
      if (pending[key] === value) { delete pending[key]; keepPending(); }  // unless a newer number was typed meanwhile
      if (value == null) delete saved[key]; else saved[key] = { value, at: data.at };
      state[key] = "saved";
    }
  } catch (err) {
    state[key] = "waiting";
  }
  update();
}

function sendPending() {
  for (const key in pending) if (state[key] !== "saving") send(key, pending[key]);
}

function save(key, value) {
  pending[key] = value;
  keepPending();
  send(key, value);
}

const valueOf = key => (key in pending ? pending[key] : saved[key] ? saved[key].value : null);

/* ---------- screens ---------- */

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const k in attrs) {
    if (k === "class") el.className = attrs[k];
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), attrs[k]);
    else el.setAttribute(k, attrs[k]);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

function show() {
  const task = tasks.find(t => "#" + t.id === location.hash);
  const screen = $("screen");
  screen.replaceChildren(...(task ? taskScreen(task) : listScreen()));
  window.scrollTo(0, 0);
  update();
}

function listScreen() {
  return [
    h("section", { class: "card" },
      h("p", { class: "done-count" }, h("b", { id: "done-count" }), "counts done"),
      h("div", { class: "meter" }, h("span", { id: "done-bar" }))),
    h("section", { class: "card how" },
      h("h2", {}, "How to measure"),
      h("ol", {},
        h("li", {}, "Walk the way you normally walk. Don't take big steps or small steps."),
        h("li", {}, "Count one step every time a foot touches the floor: left foot 1, right foot 2, left foot 3, and so on."),
        h("li", {}, "Walk in the middle of the corridor."),
        h("li", {}, "Pick a walk below. Go to its start point and stand there. Your count is 0."),
        h("li", {}, "Start walking and keep counting. Don't stop counting and don't start again from 0."),
        h("li", {}, "When you are in front of a door on the list, type the number you are on in its box. Then keep walking and counting."),
        h("li", {}, "If two rooms face each other, like A007 / A008, type the number when you are between the two doors."),
        h("li", {}, "At the end of the walk, type your last number."))),
    h("section", { class: "card how" },
      h("h2", {}, "Example"),
      h("p", {}, "Walk W1 starts at corner J1. You stand at J1: count 0. You walk and reach the A006 door at 6 steps, so type 6. You keep going and reach A007 / A008 at 14, so type 14. Then A009 / A010 at 22: type 22. You reach the end corner J2 at 27: type 27. Done."),
      h("p", { class: "hint" }, "The numbers only go up as you walk. If a number is smaller than the one before, the box will warn you.")),
    h("section", { class: "card how" },
      h("h2", {}, "Good to know"),
      h("ul", {},
        h("li", {}, "Any floor is fine. All floors are the same."),
        h("li", {}, "One person should do one whole walk."),
        h("li", {}, "Typed a wrong number? Type the right one in the same box. It replaces the old one."),
        h("li", {}, "Want to do a walk again from the start? Open it and tap “Clear this walk” two times."),
        h("li", {}, "Numbers save by themselves. “Saved ✓” means it's done. “Not saved yet” means your internet is slow; it will save by itself later, so don't close the page."),
        h("li", {}, "Short counts are different: each one starts again from 0."))),
    h("section", {},
      h("h2", {}, "Pick a walk"),
      h("ul", { class: "tasks" }, tasks.map(t =>
        h("li", {}, h("a", { class: "task", href: "#" + t.id },
          h("span", { class: "tag" }, t.walk ? t.id : t.id === "short" ? "S" : "1×"),
          h("span", { class: "title" }, t.title),
          h("span", { class: "where" }, t.where),
          h("span", { class: "pill", "data-task": t.id })))))),
  ];
}

function taskScreen(task) {
  const steps = task.walk
    ? [
        h("li", {}, "Go to ", h("b", {}, task.walk.startText), "."),
        h("li", {}, "Your count is 0. Walk in the middle of the corridor and count every step."),
        h("li", {}, "When you are in front of each place below, type the number you are on. Don't start again from 0."),
      ]
    : [
        h("li", {}, "Each line is a separate count. Stand at the first place with count 0, walk to the second place, and type the number."),
        h("li", {}, "J1 to J11 are corners. They are the orange dots on the map."),
      ];
  return [
    h("a", { class: "back", href: "#" }, "← All walks"),
    h("h2", { class: "task-title" }, task.walk ? h("span", { class: "tag" }, task.id) : null, task.title),
    h("div", { class: "map-scroll" }, drawMap(task.walk)),
    h("section", { class: "card" }, h("ol", { class: "steps-how" }, steps)),
    h("section", { class: "card" }, h("ol", { class: "stops" }, task.stops.map((s, i) => stopRow(task, s, i)))),
    clearButton(task),
    h("a", { class: "finish", href: "#" }, "Done: back to all walks"),
  ];
}

// Empties every box of a walk so it can be done again. Needs two taps, so it can't happen by accident.
function clearButton(task) {
  const label = task.walk ? "Clear this walk" : "Clear these counts";
  const button = h("button", { type: "button", class: "clear" }, label);
  let armed = false;
  button.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      button.textContent = "Tap again to empty every box";
      setTimeout(() => { armed = false; button.textContent = label; }, 4000);
      return;
    }
    armed = false;
    task.stops.forEach(s => { if (valueOf(s.key) != null) save(s.key, null); });
    button.textContent = label;
  });
  return button;
}

function stopRow(task, stop, i) {
  const input = h("input", {
    id: "in-" + stop.key, type: "text", inputmode: "numeric", pattern: "[0-9]*", autocomplete: "off",
    placeholder: "steps", "aria-label": `Steps at ${stop.label}`,
  });
  input.addEventListener("change", () => {
    const text = input.value.trim();
    if (text !== "" && !/^\d{1,4}$/.test(text)) {
      state[stop.key] = "error: Type a whole number, like 14.";
      update();
      return;
    }
    save(stop.key, text === "" ? null : Number(text));
  });
  input.addEventListener("keydown", ev => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    const next = $("in-" + (task.stops[i + 1] || {}).key);
    if (next) next.focus(); else input.blur();
  });
  return h("li", { class: "stop" },
    h("span", { class: "n" }, String(i + 1)),
    h("label", { for: "in-" + stop.key }, stop.label),
    input,
    h("p", { class: "status", id: "st-" + stop.key }));
}

// Refreshes numbers and labels in place, so typing isn't interrupted.
function update() {
  const all = tasks.flatMap(t => t.stops);
  const done = all.filter(s => valueOf(s.key) != null).length;
  if ($("done-count")) {
    $("done-count").textContent = `${done} of ${all.length}`;
    $("done-bar").style.width = `${(done / all.length) * 100}%`;
  }
  tasks.forEach(t => {
    const pill = document.querySelector(`[data-task="${t.id}"]`);
    if (!pill) return;
    const n = t.stops.filter(s => valueOf(s.key) != null).length;
    pill.textContent = n === t.stops.length ? "Done ✓" : n ? `${n} of ${t.stops.length}` : "Not started";
    pill.className = "pill" + (n === t.stops.length ? " done" : n ? " part" : "");
  });
  for (const task of tasks) task.stops.forEach((s, i) => {
    const input = $("in-" + s.key);
    if (!input) return;
    const v = valueOf(s.key);
    if (document.activeElement !== input && !(state[s.key] || "").startsWith("error")) input.value = v == null ? "" : v;
    const st = $("st-" + s.key);
    const [text, tone] = statusOf(task, s, i, v);
    st.textContent = text;
    st.className = "status" + (tone ? " " + tone : "");
  });
}

function statusOf(task, stop, i, v) {
  const s = state[stop.key] || "";
  if (s.startsWith("error: ")) return [s.slice(7), "bad"];
  if (s === "saving") return ["Saving…", ""];
  if (s === "waiting") return ["Not saved yet. It's kept on this phone and will save by itself.", "warn"];
  if (v != null && task.walk && i > 0) {
    const before = valueOf(task.stops[i - 1].key);
    if (before != null && v < before) return [`Lower than the stop before (${before}). Did the count restart?`, "warn"];
  }
  if (s === "saved") return [v == null ? "Cleared" : "Saved ✓", "ok"];
  if (saved[stop.key]) return [`Saved ${ago(saved[stop.key].at)}`, "ok"];
  return ["", ""];
}

function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return new Date(t).toLocaleDateString();
}

/* ---------- map ---------- */

function drawMap(walk) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("id", "walk-map");
  svg.setAttribute("viewBox", "160 132 890 680");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", walk ? `Map of ${walk.title}` : "Map with the corners J1 to J11");
  const S = (tag, attrs, parent = svg) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    parent.appendChild(el);
    return el;
  };
  const T = (text, x, y, cls) => {
    const el = S("text", { x, y, "text-anchor": "middle", "dominant-baseline": "central", class: cls });
    el.textContent = text;
    return el;
  };
  const P = id => [nodes[id].x, nodes[id].y];
  const defs = S("defs", {});
  const hatch = S("pattern", { id: "hatch", width: 4, height: 4, patternUnits: "userSpaceOnUse" }, defs);
  S("line", { x1: 0, y1: 0, x2: 0, y2: 4, class: "hatch-line" }, hatch);
  const marker = S("marker", { id: "arrow", viewBox: "0 0 10 10", refX: 7, refY: 5, markerWidth: 4, markerHeight: 4, orient: "auto" }, defs);
  S("path", { d: "M0 0 L10 5 L0 10 Z", class: "arrow" }, marker);

  S("rect", { x: 160, y: 132, width: 890, height: 680, class: "sheet-bg" });
  plan.edges.forEach(e => S("path", { d: "M" + [P(e.from), ...(e.via || []), P(e.to)].map(p => p.join(" ")).join(" L"), class: "band" }));
  plan.rooms.forEach(r => {
    const [x1, y1, x2, y2] = r.rect, w = x2 - x1, ht = y2 - y1, cx = x1 + w / 2, cy = y1 + ht / 2;
    S("rect", { x: x1, y: y1, width: w, height: ht, class: "room" });
    const t = T(r.id, cx, cy, "room-label");
    if (w < 42 && ht > w) t.setAttribute("transform", `rotate(90 ${cx} ${cy})`);
  });
  plan.nodes.forEach(n => {
    if (n.kind === "stair") S("rect", { x: -24, y: -9, width: 48, height: 18, class: "stair", transform: `translate(${n.x} ${n.y}) rotate(${n.rot})` });
    if (n.kind === "toilet") {
      S("rect", { x: n.x - 18, y: n.y - 11, width: 36, height: 22, rx: 4, class: "wc" });
      T(n.label.startsWith("Ladies") ? "Ladies" : "Gents", n.x, n.y, "small-label");
    }
  });
  if (walk) {
    const pts = [walk.start, ...walk.stops.map(s => s.node)].map(P);
    S("path", { d: "M" + pts.map(p => p.join(" ")).join(" L"), class: "walkline", "marker-end": "url(#arrow)" });
    S("circle", { cx: pts[0][0], cy: pts[0][1], r: 8, class: "startdot" });
    T("start", pts[0][0], pts[0][1] - 16, "jlabel");
  } else {
    plan.nodes.filter(n => n.kind === "junction").forEach(n => {
      S("circle", { cx: n.x, cy: n.y, r: 5, class: "jdot" });
      T(n.id, n.x + 12, n.y - 9, "jlabel");
    });
  }
  return svg;
}
