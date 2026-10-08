// Tests for the routing code: small hand-made graphs first, then the real building graph,
// where every Dijkstra answer is checked against Floyd-Warshall.
//   node scripts/build.mjs test
#include "graph.hpp"

#include <algorithm>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

extern "C" const char* load_graph(const char* text);
extern "C" const char* find_route(const char* from, const char* to);

static int checks = 0, failures = 0;
#define CHECK(cond)                                                            \
    do {                                                                       \
        ++checks;                                                              \
        if (!(cond)) {                                                         \
            ++failures;                                                        \
            std::cerr << "FAIL tests.cpp:" << __LINE__ << "  " #cond "\n";     \
        }                                                                      \
    } while (0)

typedef std::vector<std::string> Names;
const long long FAR = 1000000000000LL;

static Graph fromText(const std::string& text) {
    Graph g;
    std::string error;
    CHECK(g.loadFromText(text, error));
    return g;
}

static void smallGraphs() {
    // The direct corridor A-B is longer than going round through C.
    Graph g = fromText("A B 10\nA C 3\nC B 4\n");
    Route r = g.shortestPath("A", "B");
    CHECK(r.found && r.totalSteps == 7);
    CHECK((r.path == Names{"A", "C", "B"}));
    CHECK((r.legs == std::vector<int>{3, 4}));

    // Same start and end.
    r = g.shortestPath("C", "C");
    CHECK(r.found && r.totalSteps == 0 && r.path.size() == 1);

    // Unknown place, and a place with no connection.
    CHECK(!g.shortestPath("A", "Z").found);
    g.addEdge("X", "Y", 1);
    CHECK(!g.shortestPath("A", "X").found);

    // Parallel corridors: the shorter one counts.
    Graph p = fromText("A B 9\nA B 4\n");
    CHECK(p.shortestPath("A", "B").totalSteps == 4);

    // Always stepping to the nearest neighbour goes A-D-E-F (1+1+10 = 12); the shortest is A-B-C-F (6).
    Graph trap = fromText("A D 1\nD E 1\nE F 10\nA B 2\nB C 2\nC F 2\n");
    CHECK(trap.shortestPath("A", "F").totalSteps == 6);

    // Comments, blank lines and Windows line endings are ignored; zero-step corridors are allowed.
    Graph c = fromText("# comment\r\n\r\n  A B 0\r\nB C 5\r\n");
    CHECK(c.placeCount() == 3 && c.shortestPath("A", "C").totalSteps == 5);

    // Malformed lines are rejected, naming the line.
    Graph bad;
    std::string error;
    CHECK(!bad.loadFromText("A B 3\nA B\n", error) && error.find("line 2") == 0);
    CHECK(!bad.loadFromText("A B -1\n", error));
    CHECK(!bad.loadFromText("A B 3 4\n", error));
}

static void websiteApi() {
    CHECK(std::string(load_graph("A B 2\nB C 3\n")) == "");
    CHECK(std::string(find_route("A", "C")) ==
          "{\"found\":true,\"steps\":5,\"path\":[\"A\",\"B\",\"C\"],\"legs\":[2,3]}");
    CHECK(std::string(find_route("A", "Q")) == "{\"found\":false,\"unknown\":\"Q\"}");
    CHECK(std::string(load_graph("A B x\n")).find("line 1") == 0);
}

static void buildingGraph(const std::string& path) {
    std::ifstream file(path);
    CHECK(file.good());
    if (!file) return;
    std::stringstream contents;
    contents << file.rdbuf();
    Graph g;
    std::string error;
    CHECK(g.loadFromText(contents.str(), error));

    // Our own copy of the edges, for Floyd-Warshall and for checking each route's legs.
    const Names& names = g.placeNames();
    const int n = g.placeCount();
    std::map<std::string, int> id;
    for (int i = 0; i < n; ++i) id[names[i]] = i;
    std::vector<std::vector<long long>> dist(n, std::vector<long long>(n, FAR));
    for (int i = 0; i < n; ++i) dist[i][i] = 0;
    std::istringstream lines(contents.str());
    std::string line;
    while (std::getline(lines, line)) {
        std::istringstream words(line);
        std::string a, b;
        long long w;
        if (!(words >> a) || a[0] == '#' || !(words >> b >> w)) continue;
        long long& d1 = dist[id[a]][id[b]];
        long long& d2 = dist[id[b]][id[a]];
        d1 = d2 = std::min(d1, w);
    }
    const std::vector<std::vector<long long>> direct = dist;  // single-edge weights

    // Floyd-Warshall: allow each place k in turn as a stop-over on every i -> j route.
    for (int k = 0; k < n; ++k)
        for (int i = 0; i < n; ++i)
            for (int j = 0; j < n; ++j)
                if (dist[i][k] + dist[k][j] < dist[i][j]) dist[i][j] = dist[i][k] + dist[k][j];

    // Rooms are the names without '@' (A006, B112, ...); the second character is the floor.
    Names rooms;
    for (const std::string& name : names)
        if (name.find('@') == std::string::npos) rooms.push_back(name);
    CHECK(rooms.size() == 160);  // 40 rooms on each of 4 floors

    // Dijkstra must agree with Floyd-Warshall, and every route must use real corridors whose
    // steps add up. Checking all 160,000 pairs takes ~25 s, so check the pairs that matter:
    // every room to every ground- and top-floor room, and every pair of ground-floor places.
    std::vector<std::pair<int, int>> pairs;
    for (const std::string& a : rooms)
        for (const std::string& b : rooms)
            if (b[1] == '0' || b[1] == '3') pairs.push_back({id[a], id[b]});
    for (int i = 0; i < n; ++i)
        for (int j = 0; j < n; ++j)
            if (names[i].size() > 2 && names[j].size() > 2 && names[i].substr(names[i].size() - 2) == "@0" &&
                names[j].substr(names[j].size() - 2) == "@0")
                pairs.push_back({i, j});

    int mismatches = 0;
    for (const auto& pair : pairs) {
        int i = pair.first, j = pair.second;
        Route r = g.shortestPath(names[i], names[j]);
        if (dist[i][j] >= FAR) {
            if (r.found) ++mismatches;
            continue;
        }
        if (!r.found || r.totalSteps != dist[i][j]) { ++mismatches; continue; }
        long long sum = 0;
        for (size_t k = 1; k < r.path.size(); ++k) {
            long long w = direct[id[r.path[k - 1]]][id[r.path[k]]];
            if (w >= FAR || w != r.legs[k - 1]) ++mismatches;
            sum += r.legs[k - 1];
        }
        if (sum != r.totalSteps) ++mismatches;
    }
    CHECK(mismatches == 0);

    // Every room reaches every other room, and A -> B is as long as B -> A.
    int unreachable = 0, asymmetric = 0;
    for (const std::string& a : rooms)
        for (const std::string& b : rooms) {
            if (dist[id[a]][id[b]] >= FAR) ++unreachable;
            if (dist[id[a]][id[b]] != dist[id[b]][id[a]]) ++asymmetric;
        }
    CHECK(unreachable == 0);
    CHECK(asymmetric == 0);

    // Rooms facing each other share a door point, so the route just crosses the corridor.
    CHECK((g.shortestPath("A007", "A008").path == Names{"A007", "D2@0", "A008"}));
    CHECK((g.shortestPath("B209", "B210").path == Names{"B209", "D22@2", "B210"}));

    // From A015 the passage through C block (C-block entry A -> C-block entry B) beats the link corridor.
    Route viaC = g.shortestPath("A015", "B018");
    CHECK(std::find(viaC.path.begin(), viaC.path.end(), "N2@0") != viaC.path.end() &&
          std::find(viaC.path.begin(), viaC.path.end(), "N3@0") != viaC.path.end());

    // Going up two floors climbs one staircase twice: S?@0 -> S?@1 -> S?@2 in a row.
    Route up = g.shortestPath("A006", "A206");
    CHECK(g.shortestPath("A001", "B322").found);  // ground floor to the top (3rd) floor
    bool climbs = false;
    for (size_t k = 2; k < up.path.size(); ++k) {
        const std::string& s = up.path[k - 2];
        if (s[0] == 'S' && s.substr(s.size() - 2) == "@0") {
            std::string stair = s.substr(0, s.size() - 2);
            climbs = climbs || (up.path[k - 1] == stair + "@1" && up.path[k] == stair + "@2");
        }
    }
    CHECK(up.found && climbs);

    std::cout << "building graph: " << n << " places, " << rooms.size() << " rooms\n";
}

int main(int argc, char** argv) {
    smallGraphs();
    websiteApi();
    buildingGraph(argc > 1 ? argv[1] : "web/graph.txt");
    std::cout << (checks - failures) << "/" << checks << " checks passed\n";
    return failures ? 1 : 0;
}
