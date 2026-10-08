#include "graph.hpp"

#include <algorithm>
#include <sstream>

using namespace std;

const int INF = 1000000000;  // "not reachable yet"

int Graph::idOf(const string& name) {
    if (ids.count(name) == 0) {  // first time we see this place: give it the next number
        ids[name] = (int)names.size();
        names.push_back(name);
        adj.push_back({});
    }
    return ids[name];
}

bool Graph::hasPlace(const string& name) const {
    return ids.count(name) > 0;
}

void Graph::addEdge(const string& a, const string& b, int steps) {
    int u = idOf(a);
    int v = idOf(b);
    adj[u].push_back({v, steps});  // a -> b
    adj[v].push_back({u, steps});  // b -> a (you can walk a corridor both ways)
}

bool Graph::loadFromText(const string& text, string& error) {
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
        addEdge(a, b, steps);
    }
    return true;
}

Route Graph::shortestPath(const string& from, const string& to) const {
    Route route;
    if (!hasPlace(from) || !hasPlace(to)) return route;

    int start = ids.at(from);
    int end = ids.at(to);
    int n = placeCount();

    vector<int> dist(n, INF);     // dist[p] = fewest steps found so far from start to p
    vector<int> prev(n, -1);      // prev[p] = the place just before p on that route
    vector<bool> done(n, false);  // done[p] = true once dist[p] can't get any smaller
    dist[start] = 0;

    for (int round = 0; round < n; round++) {
        // 1. Pick the closest place that isn't done yet.
        int u = -1;
        for (int p = 0; p < n; p++)
            if (!done[p] && (u == -1 || dist[p] < dist[u])) u = p;

        if (dist[u] == INF) break;  // every place left is unreachable

        // 2. Nothing can reach u more cheaply now, so its distance is final.
        done[u] = true;
        if (u == end) break;  // we only need the route to `end`

        // 3. Relax: would walking through u give a neighbour a shorter route?
        for (const Edge& e : adj[u]) {
            if (!done[e.to] && dist[u] + e.steps < dist[e.to]) {
                dist[e.to] = dist[u] + e.steps;
                prev[e.to] = u;
            }
        }
    }

    if (dist[end] == INF) return route;  // no route (not found)

    // 4. Follow prev[] back from the end to the start, then flip it round.
    vector<int> order;
    for (int p = end; p != -1; p = prev[p]) order.push_back(p);
    reverse(order.begin(), order.end());

    route.found = true;
    route.totalSteps = dist[end];
    for (int i = 0; i < (int)order.size(); i++) {
        route.path.push_back(names[order[i]]);
        if (i > 0) route.legs.push_back(dist[order[i]] - dist[order[i - 1]]);
    }
    return route;
}
