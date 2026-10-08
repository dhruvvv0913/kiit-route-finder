#include "graph.hpp"

#include <algorithm>
#include <functional>
#include <queue>
#include <sstream>

// Larger than any real route, small enough that adding two of them cannot overflow.
const long long Graph::INF = 1000000000000000LL;

int Graph::addNode(const std::string& name) {
    auto it = index_.find(name);
    if (it != index_.end()) return it->second;
    int id = nodeCount();
    names_.push_back(name);
    index_[name] = id;
    adj_.emplace_back();
    return id;
}

void Graph::addEdge(const std::string& a, const std::string& b, int steps) {
    int u = addNode(a);
    int v = addNode(b);
    // A corridor can be walked in both directions, so store the edge on both ends.
    adj_[u].push_back({v, steps});
    adj_[v].push_back({u, steps});
    ++edgeCount_;
}

bool Graph::loadFromText(const std::string& text, std::string& error) {
    std::istringstream in(text);
    std::string line;
    int lineNo = 0;
    while (std::getline(in, line)) {
        ++lineNo;
        if (!line.empty() && line.back() == '\r') line.pop_back();
        size_t first = line.find_first_not_of(" \t");
        if (first == std::string::npos || line[first] == '#') continue;

        std::istringstream fields(line);
        std::string a, b, extra;
        long long steps;
        if (!(fields >> a >> b >> steps) || (fields >> extra) || steps < 0 || steps > 1000000) {
            std::ostringstream msg;
            msg << "line " << lineNo << ": expected \"placeA placeB steps\", got \"" << line << "\"";
            error = msg.str();
            return false;
        }
        addEdge(a, b, static_cast<int>(steps));
    }
    return true;
}

int Graph::indexOf(const std::string& name) const {
    auto it = index_.find(name);
    return it == index_.end() ? -1 : it->second;
}

int Graph::edgeSteps(const std::string& a, const std::string& b) const {
    int u = indexOf(a), v = indexOf(b);
    if (u < 0 || v < 0) return -1;
    int best = -1;
    for (const auto& edge : adj_[u])
        if (edge.first == v && (best < 0 || edge.second < best)) best = edge.second;
    return best;
}

Route Graph::shortestPath(const std::string& from, const std::string& to) const {
    Route route;
    int source = indexOf(from);
    int target = indexOf(to);
    if (source < 0 || target < 0) return route;

    const int n = nodeCount();
    std::vector<long long> dist(n, INF);  // best known steps from the source
    std::vector<int> prev(n, -1);         // previous place on that best route

    // Min-heap of (steps so far, node): the closest unsettled node is always on top.
    typedef std::pair<long long, int> Item;
    std::priority_queue<Item, std::vector<Item>, std::greater<Item>> heap;

    dist[source] = 0;
    heap.push({0, source});
    while (!heap.empty()) {
        Item top = heap.top();
        heap.pop();
        long long d = top.first;
        int u = top.second;

        if (d > dist[u]) continue;  // stale entry: u was already reached by a shorter route
        if (u == target) break;     // the target is settled, so its distance is final

        for (const auto& edge : adj_[u]) {
            int v = edge.first;
            long long candidate = d + edge.second;
            if (candidate < dist[v]) {  // relaxation: going through u is shorter
                dist[v] = candidate;
                prev[v] = u;
                heap.push({candidate, v});
            }
        }
    }
    if (dist[target] == INF) return route;  // no route (e.g. different floors, no stairs yet)

    // Walk the prev[] links back from the target, then reverse to get start -> end.
    std::vector<int> nodes;
    for (int v = target; v != -1; v = prev[v]) nodes.push_back(v);
    std::reverse(nodes.begin(), nodes.end());

    route.found = true;
    route.steps = dist[target];
    for (size_t i = 0; i < nodes.size(); ++i) {
        route.path.push_back(names_[nodes[i]]);
        if (i > 0) route.legs.push_back(edgeSteps(names_[nodes[i - 1]], names_[nodes[i]]));
    }
    return route;
}

std::vector<std::vector<long long>> Graph::allPairsDistances() const {
    const int n = nodeCount();
    std::vector<std::vector<long long>> d(n, std::vector<long long>(n, INF));
    for (int u = 0; u < n; ++u) {
        d[u][u] = 0;
        for (const auto& edge : adj_[u])
            d[u][edge.first] = std::min(d[u][edge.first], static_cast<long long>(edge.second));
    }
    // Allow node k as a stop-over on every i -> j route, for k = 0..n-1.
    for (int k = 0; k < n; ++k)
        for (int i = 0; i < n; ++i) {
            if (d[i][k] == INF) continue;
            for (int j = 0; j < n; ++j)
                if (d[k][j] != INF && d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j];
        }
    return d;
}
