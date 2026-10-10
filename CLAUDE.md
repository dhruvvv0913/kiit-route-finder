# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DAA (Design & Analysis of Algorithms) assignment, named **K Map**: a website that takes two rooms in Block A & B of KIIT School of Computer Engineering and returns the shortest walking route between them. Distance is measured in **walking steps**.

The site is live at https://kiit-route-finder.vercel.app. Vercel deploys every push to `main` of github.com/dhruvvv0913/kiit-route-finder (private). Push only when the user asks.

The students present and explain **only the C++ algorithm code** (`cpp/graph.*`). The website code is just glue.

The user asked for Dijkstra to stay **simple and easy to explain**, so keep it that way:
- the O(V²) array version (`dist` / `prev` / `done`, pick the closest unfinished place, relax its neighbours)
- no heap, no clever C++

Don't "optimise" it back to `priority_queue`, and keep the comments written for someone explaining the code in a viva.

The site is in **demo mode**: it shows a DEMO badge while any step count is still an estimate.

## Commands

All commands go through `node scripts/build.mjs <step>`; the npm scripts wrap them.

| Command | What it does |
|---|---|
| `npm test` | Regenerates `web/graph.txt`, then compiles and runs `cpp/tests.cpp` with g++ |
| `npm run graph` | Only regenerates `web/graph.txt` and `web/floor-graph.json` from `data/floor-graph.json` |
| `npm run cli` | Builds `build/router(.exe)` |
| `npm run wasm` | Compiles the C++ with Emscripten `em++` into `web/router.js` + `web/router.wasm` |
| `npm run build:all` | test + cli + wasm |
| `npm run serve` | Serves `web/` at http://localhost:8080 (`PORT` overrides) |

- **Terminal program:** `build/router web/graph.txt A006 B012` prints one route. With no rooms given, it reads `FROM TO` pairs from stdin.
- **No single-test filter.** `tests.cpp` is one executable of `CHECK`s. Comment out calls in its `main()` to narrow a run.
- **Toolchain:**
  - g++ is MinGW.org 6.3 at `C:\MinGW\bin`, so the native build is `-std=c++14`. Don't use C++17 features in `cpp/`.
  - Emscripten lives in `~/emsdk`; `build.mjs` finds `em++` there or through `EMSDK`. emsdk needs `EMSDK_PYTHON=/c/Users/KIIT/anaconda3/python.exe`, because the `python3` on PATH is the Windows Store stub.
- **Deep links:** `#<from>-<to>` (e.g. `#A006-B012`, `#T1@0-A012`) opens a route directly. This makes headless-browser checks easy:
  ```
  chrome --headless=new --virtual-time-budget=8000 --dump-dom http://localhost:8080/#A006-B012
  ```

## Architecture

The pipeline is `data/floor-graph.json` → `scripts/build.mjs graph` → `web/graph.txt` → C++ `Graph`. The C++ runs natively (tests, CLI) and as WebAssembly (website).

- **`data/floor-graph.json` is the only hand-edited data.** It holds one floor's layout: nodes, rooms and edges.
- **`build.mjs graph` expands it to every floor in `meta.floors`** (ground, 1st, 2nd, 3rd). Floors are identical; only room numbers change (`A006` → `A106` → `A206` → `A306`). The website's `FLOOR_NAMES` must have one name per floor.
  - Rooms get their real numbers.
  - Every other place is `<id>@<floor>` (`J3@0`, `D2@2`, `T1@1`).
  - Each room links to its door point with half a corridor crossing (`meta.corridorCrossSteps ?? corridorCrossEst`).
  - Every stair is linked floor to floor (`S1@0–S1@1–S1@2–S1@3`) with `flightSteps ?? meta.stairFlightEst`. The user says every staircase is identical, about 25 steps per floor.
  - **This generator is the only place that knows about floors.** The C++ only sees a generic named, weighted, undirected edge list (`placeA placeB steps` per line), and must stay that way.
- **`cpp/graph.cpp`** holds only the adjacency list (`map` name → index), the text loader, and the simple Dijkstra. `legs` come from `dist[node] - dist[prev]`.
- **The project uses Dijkstra only.** The user had Floyd–Warshall removed everywhere, tests included, because it complicates the viva. Don't add another algorithm for comparison or verification.
- **The core is being rewritten by the user's friend.** The friend got the core (`graph.hpp`, `graph.cpp`, `main.cpp`, a sample `graph.txt`) as a zip from `for-friend/`. When the friend's code comes back, fit `wasm_api.cpp`, `main.cpp` and `tests.cpp` around it rather than changing its logic, and keep it explaining-friendly.
- **`cpp/wasm_api.cpp`** exposes the `extern "C"` functions `load_graph(text)` and `find_route(from, to)`; the latter returns a JSON string. It is plain C++, so `tests.cpp` links and tests it natively too.
- **`web/app.js`:**
  - resolves typed text to place ids: room numbers, short forms like "a6" → A006, and toilet/entry/stair labels per floor
  - "nearest" buttons call `find_route` once per candidate (toilets of a gender, stairs on the start floor, main entrances N1/N4) and keep the fewest steps. That's still only Dijkstra.
  - walking time = flat steps ÷ 100 + stair steps ÷ 60 minutes
  - the map pans and zooms through the SVG `viewBox`, whose aspect always follows the element's size (`aspect()`). Room taps are detected on `pointerup`, not `click`, because of pointer capture.
  - calls the wasm through `ccall`
  - builds turn-by-turn directions from the node coordinates (cross product of headings, y-down)
  - draws the SVG map
  - **holds no shortest-path logic.** Don't add a JS fallback; routing must come from the C++.
- **`web/how.html`** explains the graph and the simple O(V²) Dijkstra, with a worked example (the A–F "trap" graph from `tests.cpp`, rounds in node-insertion order). If the friend's Dijkstra changes how the algorithm works, update this page to match.
- **Generated files in `web/` are committed:** `graph.txt`, `floor-graph.json`, `router.js`, `router.wasm`. Vercel can't run g++ or Emscripten (`vercel.json` only serves `web/`), so rerun `npm run graph` and `npm run wasm` and commit the outputs after changing data or C++.
- **The tests check the real building graph:**
  - small hand-made graphs with known answers
  - every same-floor room pair, and every ground-floor → 3rd-floor pair, is reachable and symmetric, and each route uses real corridors whose steps add up
  - facing rooms share a door point

  `rooms.size() == 160` assumes 4 floors × 40 rooms.

## Design (K Map)

The user asked for a design that doesn't look AI-generated. It follows Anthropic's **frontend-design** guide (https://github.com/anthropics/claude-plugins-official, `plugins/frontend-design`). The user can install it with `/plugin install frontend-design@claude-plugins-official`.

- **Concept:** the corridor directory board in your pocket.
  - A black-line floor plan on white, with room numbers in Barlow Condensed (the only web font, the board's signage lettering).
  - Everything else uses the system UI font.
  - KIIT board green (`--frame`) for the brand and the start; the route in blue marker (`--route`); red for the destination.
- **Layout follows real map apps** (MazeMap, Google Maps):
  - On phones (< 900px): a full-screen map, floating search, a right-edge floor picker (G at the bottom), and a bottom sheet (`#sheet`, `.open` shows the directions).
  - On laptops: a 400px side panel next to the map.
  - `fitBox()` fits into `openArea()`, the part of the map not covered by the panels.
- **Avoid the generated-design tells:**
  - ALL-CAPS labels
  - " · " joined meta text
  - "→" on buttons
  - monospace data labels
  - identical rounded cards with the same shadow (only floating map controls get `--lift`)
  - numbered section headings
- **Test phone widths** with a temporary `web/_phones.html` holding 360–390px iframes, screenshotted with headless Chrome (`--blink-settings=preferredColorScheme=1` for light mode). Headless windows can't go below ~500px. Delete the file afterwards.

## `data/floor-graph.json` details

- **Node kinds:**
  - `junction` J1–J11
  - `door` D1–D32: a corridor-centre point outside one or more doors; rooms facing each other share one
  - `toilet` T1–T6
  - `entry` N1–N4: shown and offered on the ground floor only
  - `stair` S1–S7
- **Edges:**
  - `e62` is the passage through C block joining the two C-block entries (N2–N3). The user added it and confirmed it exists on every floor.
  - `steps` is the counted value. It stays `null` until measured; never overwrite measured values with estimates.
  - `est` is a rough estimate (drawing length × 0.14). While `steps` is null, the generator uses `round(est × meta.estFactor)` so it's comparable with real counts.
  - `via` holds bend points for drawing only.
- **`x`/`y` and room `rect`** are traced from the ground-floor board photo. Use them for drawing and directions only, never as weights.
- **Keep ids stable.** Edge ids `e01`–`e62` and node ids are used by the step-count collection page; add new ids rather than renumbering.

## Collecting step counts

- **The team fills in counts at https://kiit-route-finder.vercel.app/count.html.** It's built from `web/count.html`, `count.js` and `count.css`, and isn't linked from the main page.
  - The form saves through the Vercel function `api/counts.js` into the Redis database connected in the Vercel dashboard.
    - That database provides only `REDIS_URL`, used via the `redis` npm package, the project's one dependency; Vercel installs it, so `vercel.json` must not skip installs.
    - The Upstash REST variables `KV_REST_API_URL` / `KV_REST_API_TOKEN` are also supported.
    - When nothing is connected, GET answers 503 with `settingsSeen`, the names of any database settings.
  - There are no names or accounts; the user dropped contributor tracking. Anyone with the link can save.
  - Only the current number per key is kept, in the Redis hash `step-counts` (`HSET` / `HDEL`). The user doesn't want any history: people re-type a number or tap "Clear this walk" (two taps) to redo a walk.
  - Read the current values with `curl https://kiit-route-finder.vercel.app/api/counts.js`. On this Vercel project the function only answers at its file name; `/api/counts` gives 404.
  - Locally, `npm run serve` runs the same function with an in-memory store.
- **Keys and walks:**
  - `W<n>-<i>` is the running count at stop i of walk n in `data/walks.json` (copied to `web/walks.json` by `npm run graph`). Each walk starts at `start` with count 0, and the edge between consecutive stops = count difference. Edges are matched by node pair; `walks.json` covers all 62 edges exactly once.
  - `short-<edgeId>` is a single-edge count.
  - `once-cross` is `meta.corridorCrossSteps`.
  - `once-flight` is `flightSteps` for every stair (all staircases are identical).
- **Import with `npm run import-counts`** (`scripts/import-counts.mjs`), then `npm run build:all`. The import:
  - fetches the live counts and rewrites `edges[].steps`, `nodes[].flightSteps` and `meta.corridorCrossSteps` from scratch
  - leaves out the segments next to a stop whose running count goes down (a typo), and reports them
  - sets `meta.estFactor`, the median of real ÷ drawing estimate (1.88 on 2026-10-10)

  The DEMO badge disappears once nothing is estimated.
- **Status 2026-10-10:**
  - All 9 walks are entered, but W3 (19, 30, **11**, 50) and W5 (25, 35, **69, 65**) have typos, so e13/e14 and e23/e24 are still estimates.
  - 15 of 17 short counts are missing, as are `once-cross` and `once-flight`.
  - 43 of 62 segments are measured.
- **Superseded, don't use:**
  - the claude.ai walk guide (https://claude.ai/artifact/NycktEHqmF7ZwUsC2bJA9Q), which only kept numbers on each phone
  - the per-segment page (https://claude.ai/artifact/NLsfsBqswPCwjGXG5ArvRS), which only holds `e22` = 47, a value ~6–8× the estimate

## Open questions

- **Map guesses:**
  - one door per room
  - inner-corner stairs open toward the nearest corner junction
  - A011/A013 open onto A's right corridor; B011 opens onto the A–B link corridor

  Ask the user before relying on these.
- **Unconfirmed:**
  - whether the corner toilet blocks contain stairs
  - whether the blue symbol near B011 is a lift
  - whether the courtyards can be walked across
  - room names → numbers, for typing "Lab 3"
- **The user's 2nd-floor sketch is unreliable** (it mislabels A206/A212 as A006/A012, and its feet figures are inconsistent). Use the ground-floor board as the reference.
