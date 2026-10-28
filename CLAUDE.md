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

The step counts were accepted as **final** on 2026-10-10 (`meta.final: true` in `data/floor-graph.json`), so the site shows no DEMO badge. `web/app.js` still shows one if `meta.final` is removed while any segment or stair is uncounted.

## Commands

All commands go through `node scripts/build.mjs <step>`; the npm scripts wrap them.

| Command | What it does |
|---|---|
| `npm test` | Regenerates `web/graph.txt`, then compiles and runs `cpp/tests.cpp` with g++ |
| `npm run graph` | Only regenerates `web/graph.txt` and `web/floor-graph.json` from `data/floor-graph.json` |
| `npm run cli` | Builds `build/router(.exe)` |
| `npm run wasm` | Compiles the C++ with Emscripten `em++` into `web/router.js` + `web/router.wasm` |
| `npm run build:all` | test + cli + wasm |
| `npm run serve` | Serves `web/` at http://localhost:8080 (`PORT` overrides), plus `api/counts.js` with an in-memory store |
| `npm run import-counts` | Pulls the team's counts from the live counting form into `data/floor-graph.json` (see below); follow with `npm run build:all` |

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
- **`cpp/graph.cpp` is the friend's code (integrated 2026-10-28), kept as he wrote it.** It has two plain functions declared in `graph.hpp`:
  - `buildGraph(text, names, ids, matrix, error)` builds an **adjacency matrix** (`matrix[u][v]` = steps, `NO_EDGE` = -1; 0 is a valid weight) and keeps the smaller weight for duplicate pairs.
  - `dijkstra(source, destination, matrix)` returns the vertex path, or empty if there is no route.

  `main.cpp` is the friend's `printRoute` + `main`. There is no class and no `Route` struct; callers sum legs from the matrix. Keep any new C++ in this plain-functions style, and never "improve" his code for efficiency.
- **The project uses Dijkstra only.** The user had Floyd–Warshall removed everywhere, tests included, because it complicates the viva. Don't add another algorithm for comparison or verification.
- **Earlier hand-off:** the friend got `for-friend/dijkstra-core.zip`: `graph.hpp`, `graph.cpp`, `main.cpp`, `graph.txt`, `expected-routes.txt`, `kmap-step-counts.png` and a README. `for-friend/` is git-ignored; after any data change, regenerate `graph.txt` and `expected-routes.txt` (run `build/router` on the listed pairs) and re-zip, or the friend's checks will fail against stale totals. When the friend's code comes back, fit `wasm_api.cpp`, `main.cpp` and `tests.cpp` around it rather than changing its logic, and keep it explaining-friendly.
- **`cpp/wasm_api.cpp`** keeps `names` / `ids` / `matrix` as globals and exposes the `extern "C"` functions `load_graph(text)` (it clears them first, because `buildGraph` appends) and `find_route(from, to)`. The latter returns a JSON string with `steps`, `path` and `legs`. It is plain C++, so `tests.cpp` links and tests it natively too.
- **`web/app.js`:**
  - resolves typed text to place ids: room numbers, short forms like "a6" → A006, and toilet/entry/stair labels per floor
  - "nearest" buttons call `find_route` once per candidate (toilets of a gender, stairs on the start floor, main entrances A_ENTRY/B_ENTRY) and keep the fewest steps. That's still only Dijkstra.
  - walking time = flat steps ÷ 100 + stair steps ÷ 60 minutes
  - the map pans and zooms through the SVG `viewBox`, whose aspect always follows the element's size (`aspect()`). Room taps are detected on `pointerup`, not `click`, because of pointer capture.
  - calls the wasm through `ccall`
  - builds turn-by-turn directions from the node coordinates (cross product of headings, y-down)
  - draws the SVG map
  - **holds no shortest-path logic.** Don't add a JS fallback; routing must come from the C++.
- **Sections and timetables:** `data/timetable.json` (copied to `web/` by `npm run graph`) holds each section's classes by weekday (1 = Monday), with K Map room ids. It was copied from the user's Plan Sync screenshots, where rooms show as C25-A214. Only **CSE 8** (Semester 5) exists so far.
  - On first visit `app.js` asks "Which section are you in?" (a `<dialog>`) and remembers the answer in `localStorage` (`kmap-section`, or "none").
  - The home panel then lists the chosen day's classes. Each class shows the steps from the class before it; the first class of the day is walked from the main entrance (A_ENTRY@0).
  - A card points at the next class, or at the next day's first class once today's are over. Tapping a class routes there.
  - `dayPlan()` joins back-to-back periods of the same subject and room into one block (the 2-hour labs CNL and DAAL), and shows free periods of 30 minutes or more. Each class shows steps and walking minutes, and the header shows the day's total walk.
  - If the page is opened within 10 minutes of a class starting (`AUTO_ROUTE_MINUTES`), it routes to that class straight away, once per visit and only without a #link.
  - To test times, copy `index.html` to a temporary `web/_t.html` with a script before `router.js` that fakes `Date` and sets `localStorage`, then screenshot it.
- **It installs as an app (PWA):** `web/manifest.webmanifest`, `icon-192.png`, `icon-512.png` and `web/sw.js`.
  - The service worker serves cached files first and refreshes them in the background, so a new version shows on the second load. It never caches `/api/`.
  - Bump `CACHE` in `sw.js` when its file list changes.
  - Headless Chrome can't screenshot below ~500px, so make icons at 512 and resize with Python/PIL.
  - The subject full names in the file are guesses from the codes (EE = Engineering Economics, …); fix them if the user corrects them.
- **`web/steps.html`** draws one floor with every segment's weight (blue = counted, dashed red = worked out) and the place ids used in `graph.txt`, straight from `floor-graph.json`. It exists to be shared with the friend and isn't linked from the app. `?png` removes the page chrome for screenshots, which is how `for-friend/kmap-step-counts.png` is made (headless Chrome, `--force-device-scale-factor=1.5`, window 1900×1720).
- **`web/how.html`** explains the graph (as an adjacency matrix) and the simple O(V²) Dijkstra, with a worked example (the A–F "trap" graph from `tests.cpp`, rounds in node-insertion order). If the friend's Dijkstra changes how the algorithm works, update this page to match.
- **Generated files in `web/` are committed:** `graph.txt`, `floor-graph.json`, `router.js`, `router.wasm`. Vercel can't run g++ or Emscripten (`vercel.json` only serves `web/`), so rerun `npm run graph` and `npm run wasm` and commit the outputs after changing data or C++.
- **The tests check the real building graph:**
  - small hand-made graphs with known answers
  - every same-floor room pair, and every ground-floor → 3rd-floor pair, is reachable and symmetric, and each route uses real corridors whose steps add up
  - facing rooms share a door point

  `rooms.size() == 160` assumes 4 floors × 40 rooms. The building has 412 places and 444 links.

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
  - `entry` A_ENTRY and B_ENTRY (the main entrances, renamed from N1/N4), N2/N3 (the ends of the C-block passage) and C_ENTRY (the C-block entrance beside N2). They're shown and offered on the ground floor only.
  - The C-block passage runs N2 → `C_MID` (a junction) → N3, and `C_STAIR` (a stair, linked floor to floor like S1–S7) hangs off C_MID. The user confirmed the passage is 34 + 34 steps and that the staircase exists.
  - `stair` S1–S7
- **Edges:**
  - `e62`–`e65` are the C-block passage and its staircase and entrance, on every floor. Their counts came from the user directly and are stored as `fixed` (e62/e63 = 34, e64/e65 = 2). `import-counts` only rewrites edges the counting form covers, so it never touches them.
  - `steps` is the counted value. It stays `null` until measured; never overwrite measured values with estimates.
  - `est` is a rough estimate (drawing length × 0.14). While `steps` is null, the generator uses `estSteps`, else `round(est × meta.estFactor)`, so it's comparable with real counts.
  - `via` holds bend points for drawing only.
- **`x`/`y` and room `rect`** are traced from the ground-floor board photo. Use them for drawing and directions only, never as weights.
- **Keep ids stable.** Edge ids `e01`–`e65` and node ids are used by the step-count collection page; add new ids rather than renumbering.

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
  - `W<n>-<i>` is the running count at stop i of walk n in `data/walks.json` (copied to `web/walks.json` by `npm run graph`). Each walk starts at `start` with count 0, and the edge between consecutive stops = count difference. Edges are matched by node pair; `walks.json` covers every edge except the `fixed` ones (e62–e65) exactly once.
  - `short-<edgeId>` is a single-edge count.
  - `once-cross` is `meta.corridorCrossSteps`.
  - `once-flight` is `flightSteps` for every stair (all staircases are identical).
- **Import with `npm run import-counts`** (`scripts/import-counts.mjs`), then `npm run build:all`. The import:
  - fetches the live counts and rewrites `edges[].steps`, `nodes[].flightSteps` and `meta.corridorCrossSteps` from scratch
  - leaves out the segments next to a stop whose running count goes down (a typo), and reports them
  - sets `meta.estFactor` = total counted steps ÷ total drawing estimate over the counted segments (2.03 now)
  - fits the segments around a typo between the trusted counts either side of it, stored as `edges[].estSteps` (real steps, not scaled)
  - ignores counts listed in `DISTRUST` at the top of the script, only while they still hold that exact value (currently W9 stop 3 = 35, which is ~36% short of the identical B top corridor); a corrected number is used automatically
  - weight order in `build.mjs`: `steps ?? fixed ?? estSteps ?? round(est × estFactor)`
- **Status 2026-10-28 (accepted as final by the user):**
  - 42 of 62 segments are real counts; 20 are estimated: e13/e14 and e23/e24 from the typos in W3 and W5, e44 from the distrusted W9 count, and the 15 short counts that were never entered (toilets, entries, stair spurs, the C-block passage e62 = 55).
  - `once-cross` and `once-flight` were never entered, so the corridor crossing uses the 4-step estimate and stairs use 25 steps per floor.
  - Re-running the import with new counts is safe: real numbers replace estimates.
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
