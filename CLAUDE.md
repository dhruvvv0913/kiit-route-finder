# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DAA (Design & Analysis of Algorithms) assignment: a website that takes two rooms in Block A & B of KIIT School of Computer Engineering and returns the shortest walking route between them. Distance is measured in **walking steps**.

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
- **Floyd–Warshall lives only in `tests.cpp`**, which builds its own matrix from `graph.txt`.
- **`cpp/wasm_api.cpp`** exposes the `extern "C"` functions `load_graph(text)` and `find_route(from, to)`; the latter returns a JSON string. It is plain C++, so `tests.cpp` links and tests it natively too.
- **`web/app.js`:**
  - resolves typed text to place ids (room numbers, plus toilet/entry/stair labels per floor)
  - calls the wasm through `ccall`
  - builds turn-by-turn directions from the node coordinates (cross product of headings, y-down)
  - draws the SVG map
  - **holds no shortest-path logic.** Don't add a JS fallback; routing must come from the C++.
- **Generated files in `web/` are committed:** `graph.txt`, `floor-graph.json`, `router.js`, `router.wasm`. Vercel can't run g++ or Emscripten (`vercel.json` only serves `web/`), so rerun `npm run graph` and `npm run wasm` and commit the outputs after changing data or C++.
- **The tests check the real building graph:**
  - Dijkstra equals Floyd–Warshall for all pairs
  - every same-floor room pair is reachable and symmetric
  - facing rooms share a door point

  `rooms.size() == 160` assumes 4 floors × 40 rooms.

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
  - `est` is a rough estimate (drawing length × 0.14) used while `steps` is null.
  - `via` holds bend points for drawing only.
- **`x`/`y` and room `rect`** are traced from the ground-floor board photo. Use them for drawing and directions only, never as weights.
- **Keep ids stable.** Edge ids `e01`–`e62` and node ids are used by the step-count collection page; add new ids rather than renumbering.

## Collecting step counts

- **The team fills in counts at https://kiit-route-finder.vercel.app/count.html.** It's built from `web/count.html`, `count.js` and `count.css`, and isn't linked from the main page.
  - The form saves through the Vercel function `api/counts.js` into Upstash Redis (env `KV_REST_API_URL` / `KV_REST_API_TOKEN`, connected in the Vercel dashboard).
  - There are no names or accounts; the user dropped contributor tracking. Anyone with the link can save.
  - Only the current number per key is kept, in the Redis hash `step-counts` (`HSET` / `HDEL`). The user doesn't want any history: people re-type a number or tap "Clear this walk" (two taps) to redo a walk.
  - Read the current values with `curl https://kiit-route-finder.vercel.app/api/counts`.
  - Locally, `npm run serve` runs the same function with an in-memory store.
- **Keys and walks:**
  - `W<n>-<i>` is the running count at stop i of walk n in `data/walks.json` (copied to `web/walks.json` by `npm run graph`). Each walk starts at `start` with count 0, and the edge between consecutive stops = count difference. Edges are matched by node pair; `walks.json` covers all 62 edges exactly once.
  - `short-<edgeId>` is a single-edge count.
  - `once-cross` is `meta.corridorCrossSteps`.
  - `once-flight` is `flightSteps` for every stair (all staircases are identical).
- Copy confirmed values into `edges[].steps`, `nodes[].flightSteps` and `meta.corridorCrossSteps`. Then run `npm run build:all`; the route finder's DEMO badge disappears once nothing is estimated.
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
