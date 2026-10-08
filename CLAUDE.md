# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

DAA (Design & Analysis of Algorithms) assignment: a website that takes two rooms in Block A & B of KIIT School of Computer Engineering and returns the shortest walking route between them. Distance is measured in **walking steps**. The site is deployed on Vercel.

The students present and explain **only the C++ algorithm code** (`cpp/graph.*`). The website code is just glue, so keep the C++ readable and well commented, written for someone explaining it in a viva.

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
- **`build.mjs graph` expands it to all 3 floors.** Floors are identical; only room numbers change (`A006` → `A106` → `A206`).
  - Rooms get their real numbers.
  - Every other place is `<id>@<floor>` (`J3@0`, `D2@2`, `T1@1`).
  - Each room links to its door point with half a corridor crossing (`meta.corridorCrossSteps ?? corridorCrossEst`).
  - Stairs whose `flightSteps` is set are linked `S1@0–S1@1–S1@2`. Until then, floors are disconnected and cross-floor queries return "not found".
  - **This generator is the only place that knows about floors.** The C++ only sees a generic named, weighted, undirected edge list (`placeA placeB steps` per line), and must stay that way.
- **`cpp/graph.cpp`:**
  - adjacency list
  - Dijkstra with `std::priority_queue` min-heap and lazy deletion, returning `path` and per-hop `legs`
  - Floyd–Warshall, used only by tests and the report
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

  `rooms.size() == 120` assumes 3 floors × 40 rooms.

## `data/floor-graph.json` details

- **Node kinds:**
  - `junction` J1–J11
  - `door` D1–D32: a corridor-centre point outside one or more doors; rooms facing each other share one
  - `toilet` T1–T6
  - `entry` N1–N4: shown and offered on the ground floor only
  - `stair` S1–S7
- **Edges:**
  - `steps` is the counted value. It stays `null` until measured; never overwrite measured values with estimates.
  - `est` is a rough estimate (drawing length × 0.14) used while `steps` is null.
  - `via` holds bend points for drawing only.
- **`x`/`y` and room `rect`** are traced from the ground-floor board photo. Use them for drawing and directions only, never as weights.
- **Keep ids stable.** Edge ids `e01`–`e61` and node ids are used by the step-count collection page; add new ids rather than renumbering.

## Step-count collection page

The team enters counts at https://claude.ai/artifact/NLsfsBqswPCwjGXG5ArvRS.

- Read them with the `ArtifactData` tool:
  - `edges/<edgeId>`: `{steps, from, to, label, group}`
  - `stairs/<S1..S7>`: `{connects, flight}`
  - `settings/main`: `{cross, notes}`. `notes` holds the user's corrections to the map.
- Copy confirmed values into `edges[].steps`, `nodes[].flightSteps` and `meta.corridorCrossSteps`.
- The user prefers to be asked for counts as room-to-room walks ("from A006 to A009"). Turn those into per-segment values yourself.
- `e22` = 47 was entered on 2026-10-07, but it is ~6–8× the estimate for two adjacent rooms. Confirm with the user before using it.

## Open questions

- **Map guesses:**
  - one door per room
  - inner-corner stairs open toward the nearest corner junction
  - A011/A013 open onto A's right corridor; B011 opens onto the A–B link corridor

  Check `settings/main.notes` for the user's corrections before relying on these.
- **Unconfirmed:**
  - whether the corner toilet blocks contain stairs
  - whether the blue symbol near B011 is a lift
  - whether the courtyards can be walked across
  - room names → numbers, for typing "Lab 3"
- **The user's 2nd-floor sketch is unreliable** (it mislabels A206/A212 as A006/A012, and its feet figures are inconsistent). Use the ground-floor board as the reference.
