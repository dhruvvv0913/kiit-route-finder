// Tests for the routing code: small hand-made graphs first, then the real building graph.
//   node scripts/build.mjs test
#include "graph.hpp"

#include <fstream>
#include <iostream>
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
    CHECK(r.found && r.steps == 7);
    CHECK((r.path == Names{"A", "C", "B"}));
    CHECK((r.legs == std::vector<int>{3, 4}));

    // Same start and end.
    r = g.shortestPath("C", "C");
    CHECK(r.found && r.steps == 0 && r.path.size() == 1);

    // Unknown place, and a place with no connection.
    CHECK(!g.shortestPath("A", "Z").found);
    g.addEdge("X", "Y", 1);
    CHECK(!g.shortestPath("A", "X").found);

    // Parallel edges: the shorter one counts.
    Graph p = fromText("A B 9\nA B 4\n");
    CHECK(p.shortestPath("A", "B").steps == 4 && p.edgeSteps("A", "B") == 4);

    // A greedy "closest next step" walk goes A-D-E-F (1+1+10 = 12); the shortest is A-B-C-F (6).
    Graph trap = fromText("A D 1\nD E 1\nE F 10\nA B 2\nB C 2\nC F 2\n");
    CHECK(trap.shortestPath("A", "F").steps == 6);

    // Comments, blank lines and Windows line endings are ignored; zero-step edges are allowed.
    Graph c = fromText("# comment\r\n\r\n  A B 0\r\nB C 5\r\n");
    CHECK(c.edgeCount() == 2 && c.shortestPath("A", "C").steps == 5);

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

    // Rooms are the names without '@' (A006, B112, ...); the second character is the floor.
    Names rooms;
    for (const std::string& name : g.names())
        if (name.find('@') == std::string::npos) rooms.push_back(name);
    CHECK(rooms.size() == 120);  // 40 rooms on each of 3 floors

    // Dijkstra must agree with Floyd-Warshall for every pair of places, and every route
    // must use real edges whose steps add up to the total.
    const int n = g.nodeCount();
    std::vector<std::vector<long long>> all = g.allPairsDistances();
    int mismatches = 0;
    for (int i = 0; i < n; ++i)
        for (int j = 0; j < n; ++j) {
            Route r = g.shortestPath(g.names()[i], g.names()[j]);
            if (all[i][j] == Graph::INF) {
                if (r.found) ++mismatches;
                continue;
            }
            if (!r.found || r.steps != all[i][j]) { ++mismatches; continue; }
            long long sum = 0;
            for (size_t k = 1; k < r.path.size(); ++k) {
                int w = g.edgeSteps(r.path[k - 1], r.path[k]);
                if (w < 0 || w != r.legs[k - 1]) ++mismatches;
                sum += w;
            }
            if (sum != r.steps) ++mismatches;
        }
    CHECK(mismatches == 0);

    // Every room reaches every other room on its floor, and A->B is as long as B->A.
    int unreachable = 0, asymmetric = 0;
    for (const std::string& a : rooms)
        for (const std::string& b : rooms) {
            if (a[1] != b[1]) continue;
            long long ab = all[g.indexOf(a)][g.indexOf(b)];
            long long ba = all[g.indexOf(b)][g.indexOf(a)];
            if (ab == Graph::INF) ++unreachable;
            if (ab != ba) ++asymmetric;
        }
    CHECK(unreachable == 0);
    CHECK(asymmetric == 0);

    // Rooms facing each other share a door point, so the route just crosses the corridor.
    CHECK((g.shortestPath("A007", "A008").path == Names{"A007", "D2@0", "A008"}));
    CHECK((g.shortestPath("B209", "B210").path == Names{"B209", "D22@2", "B210"}));

    std::cout << "building graph: " << n << " places, " << g.edgeCount() << " links, "
              << rooms.size() << " rooms\n";
}

int main(int argc, char** argv) {
    smallGraphs();
    websiteApi();
    buildingGraph(argc > 1 ? argv[1] : "web/graph.txt");
    std::cout << (checks - failures) << "/" << checks << " checks passed\n";
    return failures ? 1 : 0;
}
