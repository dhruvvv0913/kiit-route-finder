// Copies the team's counts from the counting form into data/floor-graph.json.
//   node scripts/import-counts.mjs            reads https://kiit-route-finder.vercel.app/api/counts.js
//   node scripts/import-counts.mjs file.json  reads a saved copy of that answer instead
//
// A walk's running counts become one step count per segment (count at a stop minus the count
// at the stop before). A count lower than the one before it is a typo: the segments next to
// the stop that breaks the order are left out and reported. Short counts are single segments,
// "once-cross" is the corridor crossing and "once-flight" is the steps of every staircase.
// Missing segments get an estimate in real steps (edge.estSteps), never mixed up with real counts:
//   - next to a typo, the trusted counts on either side give the real total for that stretch,
//     which is shared out in proportion to the drawing;
//   - anything else is drawing length x meta.estFactor (real steps per drawing estimate,
//     measured over all counted segments).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const planFile = path.join(root, "data", "floor-graph.json");
const G = JSON.parse(fs.readFileSync(planFile, "utf8"));
const W = JSON.parse(fs.readFileSync(path.join(root, "data", "walks.json"), "utf8"));

const source = process.argv[2];
const answer = source
  ? JSON.parse(fs.readFileSync(source, "utf8"))
  : await (await fetch("https://kiit-route-finder.vercel.app/api/counts.js", { cache: "no-store" })).json();
if (!answer.counts) throw new Error("No counts in the answer: " + JSON.stringify(answer).slice(0, 200));
const count = key => answer.counts[key]?.value ?? null;

// Counts that go up in order but don't fit the building. Each is ignored only while it still
// holds this exact value, so a corrected number is used automatically.
const DISTRUST = {
  "W9-3": { value: 35, why: "W9 ends ~36% short of the identical B top corridor (W7, 55 steps)" },
};
const distrusted = key => DISTRUST[key] && count(key) === DISTRUST[key].value;

const nodeOf = {};
G.nodes.forEach(n => (nodeOf[n.id] = n));
const drawn = e => {  // drawing length of an edge, bends included
  const pts = [[nodeOf[e.from].x, nodeOf[e.from].y], ...(e.via || []), [nodeOf[e.to].x, nodeOf[e.to].y]];
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return s;
};

const pairKey = (a, b) => [a, b].sort().join("|");
const edgeOf = {};
G.edges.forEach(e => (edgeOf[pairKey(e.from, e.to)] = e));
const measured = {};  // edge id -> steps
const estSteps = {};  // edge id -> estimated steps, for segments next to a typo
const problems = [];

// Each walk as running counts (index 0 = the start, count 0) and the drawing distance to each stop.
const walkData = W.walks.map(w => {
  const nodes = [w.start, ...w.stops.map(s => s.node)];
  const edges = nodes.slice(1).map((n, i) => edgeOf[pairKey(nodes[i], n)]);
  const values = [0, ...w.stops.map((s, i) => count(`${w.id}-${i}`))];
  const along = [0];
  edges.forEach(e => along.push(along[along.length - 1] + drawn(e)));
  return { w, edges, values, along };
});
// Typical real steps per drawing unit, from the walks whose counts are complete and in order.
const rates = walkData
  .filter(d => d.values.every((v, i) => v != null && (i === 0 || v >= d.values[i - 1])))
  .map(d => d.values[d.values.length - 1] / d.along[d.along.length - 1])
  .sort((a, b) => a - b);
const rate = rates.length ? rates[rates.length >> 1] : null;

for (const { w, edges, values, along } of walkData) {
  // A stop is suspect if dropping it makes the walk's counts go up in order again. If either
  // of two stops would do, the suspect is the one further from where the drawing puts it.
  const suspect = new Set();
  for (let i = 1; i < values.length; i++) {
    if (values[i] == null || values[i - 1] == null || values[i] >= values[i - 1]) continue;
    const fixes = [i - 1, i].filter(j => {
      if (j === 0) return false;
      const rest = values.filter((v, k) => k !== j && v != null);
      return rest.every((v, k) => k === 0 || v >= rest[k - 1]);
    });
    const off = j => Math.abs(values[j] - rate * along[j]);
    if (fixes.length === 2 && rate) fixes.sort((x, y) => off(y) - off(x)).pop();
    (fixes.length ? fixes : [i - 1, i]).forEach(j => suspect.add(j));
    problems.push(`${w.id}: ${values.slice(1).join(", ")}: ${values[i]} comes after ${values[i - 1]}; distrusting ${[...suspect].map(j => values[j]).join(" and ")}`);
  }
  for (let i = 1; i < values.length; i++)
    if (distrusted(`${w.id}-${i - 1}`)) {
      suspect.add(i);
      problems.push(`${w.id}: ignoring ${values[i]}: ${DISTRUST[`${w.id}-${i - 1}`].why}`);
    }
  for (let i = 1; i < values.length; i++) {
    if (values[i] == null || values[i - 1] == null || suspect.has(i) || suspect.has(i - 1)) continue;
    measured[edges[i - 1].id] = values[i] - values[i - 1];
  }
  // A run of suspect stops between two trusted ones: share the trusted total out by drawing length.
  for (let a = 0; a < values.length; a++) {
    if (suspect.has(a) || values[a] == null || !suspect.has(a + 1)) continue;
    let b = a + 1;
    while (b < values.length && suspect.has(b)) b++;
    if (b >= values.length || values[b] == null || values[b] < values[a]) continue;
    const span = edges.slice(a, b), total = values[b] - values[a];
    const lengths = span.map(drawn), sum = lengths.reduce((x, y) => x + y, 0);
    let given = 0;
    span.forEach((e, k) => {
      const share = k === span.length - 1 ? total - given : Math.round((total * lengths[k]) / sum);
      estSteps[e.id] = share;
      given += share;
    });
  }
}
for (const s of W.short) if (count(`short-${s.edge}`) != null) measured[s.edge] = count(`short-${s.edge}`);

// Real steps per drawing estimate, over all counted segments together (door positions in the
// drawing are rough, so one segment can be off; whole corridors match the drawing within ~7%).
const ids = Object.keys(measured);
const realSum = ids.reduce((s, id) => s + measured[id], 0);
const estSum = ids.reduce((s, id) => s + G.edges.find(e => e.id === id).est, 0);
if (estSum) G.meta.estFactor = Math.round((realSum / estSum) * 100) / 100;
G.meta.estFactorNote = "segments without a count or estSteps use round(est x estFactor), estFactor = total counted steps / total drawing estimate over the counted segments";

G.edges.forEach(e => {
  e.steps = measured[e.id] ?? null;
  if (estSteps[e.id] != null && e.steps == null) e.estSteps = estSteps[e.id];
  else delete e.estSteps;
});
G.meta.corridorCrossSteps = count("once-cross");
G.nodes.forEach(n => { if (n.kind === "stair") n.flightSteps = count("once-flight"); });

// Same layout as the hand-written file: one node, room or edge per line.
const line = o => "    " + JSON.stringify(o).replace(/":/g, '": ').replace(/,"/g, ', "').replace(/^\{/, "{ ").replace(/\}$/, " }");
const out = "{\n  \"meta\": " + JSON.stringify(G.meta, null, 2).replace(/\n/g, "\n  ") + ",\n" +
  ["nodes", "rooms", "edges"].map(k => `  "${k}": [\n` + G[k].map(line).join(",\n") + "\n  ]").join(",\n") + "\n}\n";
fs.writeFileSync(planFile, out);

const missing = W.short.filter(s => count(`short-${s.edge}`) == null).map(s => s.edge);
console.log(`measured segments: ${Object.keys(measured).length} of ${G.edges.length}; estimate factor ${G.meta.estFactor}`);
for (const id in estSteps) console.log(`  ${id} estimated from the trusted counts around a typo: ${estSteps[id]}`);
console.log(`corridor crossing: ${G.meta.corridorCrossSteps ?? "not counted"}; staircase: ${count("once-flight") ?? "not counted"}`);
if (problems.length) console.log("left out (counts go down):\n  " + problems.join("\n  "));
if (missing.length) console.log(`short counts not done: ${missing.join(", ")}`);
