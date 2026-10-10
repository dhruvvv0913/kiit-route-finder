# K Map

Live: **https://kiit-route-finder.vercel.app** · How it works: **/how.html**

The shortest walk, in steps, between any two places in Block A & B of the School of Computer Engineering, KIIT. Type two rooms (for example A006 and B012) or tap them on the map. You get:
- the total steps and the walking time
- turn-by-turn directions; tap one to see that part on the map
- the route on a zoomable floor plan, floor by floor

The "nearest" buttons find the closest Gents or Ladies toilet, staircase or main entrance.

## The algorithm

The building is an undirected weighted graph:
- **Nodes** are corridor junctions, the points outside room doors, rooms, toilets, entries and stair landings.
- **Edges** are the walkable corridor pieces between them.
- **Each weight** is the number of walking steps for that piece.

The shortest route comes from **Dijkstra's algorithm** in its simple array form. Each round picks the closest place that isn't finished yet, marks it finished, and updates its neighbours. That's O(V²), which is instant for the ~400 places in the building. The code is in [`cpp/graph.cpp`](cpp/graph.cpp). The tests check it on small graphs with known answers, and check that every room in the building can reach every other room.

Floors are joined by the staircases, each estimated at about 25 steps per floor.

The same C++ runs in two places:
- natively, through the tests and a terminal program
- in the browser, compiled to WebAssembly with Emscripten

## Running it

You need Node.js and g++. Building the WebAssembly also needs [Emscripten](https://emscripten.org/docs/getting_started/downloads.html), installed in `~/emsdk`.

```
npm test                               # build the graph and run the C++ tests
npm run cli                            # build the terminal program
build/router web/graph.txt A006 B012   # one route in the terminal
npm run wasm                           # compile the C++ for the website
npm run serve                          # open http://localhost:8080
```

## Layout

| Path | Contents |
|---|---|
| `data/floor-graph.json` | The floor plan as a graph. All four floors (ground, 1st, 2nd, 3rd) share this layout. |
| `cpp/` | `graph.hpp/.cpp` (graph + Dijkstra), `main.cpp` (terminal program), `wasm_api.cpp` (browser interface), `tests.cpp` |
| `scripts/build.mjs` | Expands the plan to every floor (`web/graph.txt`), compiles, runs the tests |
| `web/` | The website Vercel serves, including the generated graph and the compiled `router.wasm` |

Step counts: the team counted 42 of the 62 corridor segments on foot. The rest are worked out from those counts (`npm run import-counts`). The team enters measurements at `/count.html` (nine corridor walks plus short counts, defined in `data/walks.json`); it saves through `api/counts.js` to an Upstash Redis database connected in Vercel.
