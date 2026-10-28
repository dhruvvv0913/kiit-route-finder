// KIIT Block A & B route finder: adjacency matrix + Dijkstra.
// Written by the team; shared by the terminal program (main.cpp), the website (wasm_api.cpp)
// and the tests (tests.cpp).
#include "graph.hpp"

#include <algorithm>
#include <sstream>

using namespace std;


// ---------------------------------------------------------------------------
// Step 1: read graph.txt and build the vertex list + adjacency matrix.
// Vertices = rooms, door points, corners/junctions, stairs, entrances, toilets.
// Edges    = corridors; matrix[u][v] = steps between u and v (symmetric).
// ---------------------------------------------------------------------------
bool buildGraph(const string& text, vector<string>& names, map<string, int>& ids,
                Matrix& matrix, string& error) {
    struct Corridor { int a, b, steps; };
    vector<Corridor> corridors;

    // Pass 1: read every line, give each new place a vertex number.
    istringstream input(text);
    string line;
    int lineNumber = 0;
    while (getline(input, line)) {
        lineNumber++;
        if (!line.empty() && line.back() == '\r') line.pop_back();  // Windows line endings

        istringstream words(line);
        string a, b, extra;
        int steps;
        if (!(words >> a) || a[0] == '#') continue;  // blank line or comment
        if (!(words >> b >> steps) || (words >> extra) || steps < 0) {
            error = "line " + to_string(lineNumber) + ": expected \"placeA placeB steps\", got \"" + line + "\"";
            return false;
        }
        for (const string& name : {a, b}) {
            if (ids.count(name) == 0) {
                ids[name] = (int)names.size();
                names.push_back(name);
            }
        }
        corridors.push_back({ids[a], ids[b], steps});
    }

    // Pass 2: now we know the number of vertices, so create the n x n matrix.
    int n = (int)names.size();
    matrix.assign(n, vector<int>(n, NO_EDGE));
    for (const Corridor& c : corridors) {
        // If the same pair appears twice, keep the smaller step count.
        if (matrix[c.a][c.b] == NO_EDGE || c.steps < matrix[c.a][c.b]) {
            matrix[c.a][c.b] = c.steps;
            matrix[c.b][c.a] = c.steps;  // corridors can be walked both ways
        }
    }
    return true;
}

// ---------------------------------------------------------------------------
// Step 2: Dijkstra. Takes source, destination and the adjacency matrix.
// Returns the vertices on the shortest path, source first. Empty = no route.
// ---------------------------------------------------------------------------
vector<int> dijkstra(int source, int destination, const Matrix& matrix) {
    int n = (int)matrix.size();
    vector<int> dist(n, INF);     // dist[v] = fewest steps found so far from source to v
    vector<int> prev(n, -1);      // prev[v] = the vertex just before v on that route
    vector<bool> done(n, false);  // done[v] = true once dist[v] can't get any smaller
    dist[source] = 0;

    for (int round = 0; round < n; round++) {
        // 1. Pick the closest vertex that isn't done yet.
        int u = -1;
        for (int v = 0; v < n; v++)
            if (!done[v] && (u == -1 || dist[v] < dist[u])) u = v;

        if (dist[u] == INF) break;  // every vertex left is unreachable

        // 2. Its distance is final now.
        done[u] = true;
        if (u == destination) break;

        // 3. Relax: does going through u shorten the route to any neighbour?
        for (int v = 0; v < n; v++) {
            if (matrix[u][v] != NO_EDGE && !done[v] && dist[u] + matrix[u][v] < dist[v]) {
                dist[v] = dist[u] + matrix[u][v];
                prev[v] = u;
            }
        }
    }

    vector<int> path;
    if (dist[destination] == INF) return path;  // no route

    // 4. Follow prev[] back from the destination, then flip it round.
    for (int v = destination; v != -1; v = prev[v]) path.push_back(v);
    reverse(path.begin(), path.end());
    return path;
}

