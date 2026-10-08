# Block A & B Route Finder

Finds the shortest walking route, in steps, between two rooms in Block A & B of the School of Computer Engineering, KIIT. Type two rooms (for example A006 and B012) or click them on the map. You get the total steps, turn-by-turn directions and the route drawn on the floor plan.

## The algorithm

The building is an undirected weighted graph:
- **Nodes** are corridor junctions, the points outside room doors, rooms, toilets, entries and stair landings.
- **Edges** are the walkable corridor pieces between them.
- **Each weight** is the number of walking steps for that piece.

The shortest route comes from **Dijkstra's algorithm** with a binary min-heap (`std::priority_queue`), in O((V + E) log V). The code is in [`cpp/graph.cpp`](cpp/graph.cpp). The tests check it against **Floyd–Warshall** (O(V³)) for every pair of places in the building.

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
| `data/floor-graph.json` | The floor plan as a graph. All three floors share this layout. |
| `cpp/` | `graph.hpp/.cpp` (graph, Dijkstra, Floyd–Warshall), `main.cpp` (terminal program), `wasm_api.cpp` (browser interface), `tests.cpp` |
| `scripts/build.mjs` | Expands the plan to 3 floors (`web/graph.txt`), compiles, runs the tests |
| `web/` | The website Vercel serves, including the generated graph and the compiled `router.wasm` |

Most step counts are still estimates from the floor plan. The data note at the bottom of the site shows how many corridor segments have been measured.
