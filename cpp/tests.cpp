// Tests for the routing code: small hand-made graphs with known answers first,
// then checks on the real building graph.
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

    // Our own list of the corridors, to check that every route only uses real ones.
    const Names& names = g.placeNames();
    std::map<std::string, long long> corridor;  // "a|b" -> steps of the shortest corridor between them
    std::istringstream lines(contents.str());
    std::string line;
    while (std::getline(lines, line)) {
        std::istringstream words(line);
        std::string a, b;
        long long w;
        if (!(words >> a) || a[0] == '#' || !(words >> b >> w)) continue;
        for (const std::string& k : {a + "|" + b, b + "|" + a})
            if (!corridor.count(k) || w < corridor[k]) corridor[k] = w;
    }

    // Rooms are the names without '@' (A006, B112, ...); the second character is the floor.
    Names rooms;
    for (const std::string& name : names)
        if (name.find('@') == std::string::npos) rooms.push_back(name);
    CHECK(rooms.size() == 160);  // 40 rooms on each of 4 floors

    // For every pair of rooms on the same floor, and from every ground-floor room to every
    // 3rd-floor room: a route exists, A -> B is as long as B -> A, and the route walks real
    // corridors whose steps add up to the total.
    int unreachable = 0, asymmetric = 0, badRoutes = 0;
    for (const std::string& a : rooms)
        for (const std::string& b : rooms) {
            bool sameFloor = a[1] == b[1] && a < b;
            bool bottomToTop = a[1] == '0' && b[1] == '3';
            if (!sameFloor && !bottomToTop) continue;
            Route r = g.shortestPath(a, b);
            if (!r.found) { ++unreachable; continue; }
            if (r.totalSteps != g.shortestPath(b, a).totalSteps) ++asymmetric;
            long long sum = 0;
            for (size_t k = 1; k < r.path.size(); ++k) {
                auto it = corridor.find(r.path[k - 1] + "|" + r.path[k]);
                if (it == corridor.end() || it->second != r.legs[k - 1]) ++badRoutes;
                sum += r.legs[k - 1];
            }
            if (sum != r.totalSteps) ++badRoutes;
        }
    CHECK(unreachable == 0);
    CHECK(asymmetric == 0);
    CHECK(badRoutes == 0);

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

    std::cout << "building graph: " << g.placeCount() << " places, " << rooms.size() << " rooms\n";
}

int main(int argc, char** argv) {
    smallGraphs();
    websiteApi();
    buildingGraph(argc > 1 ? argv[1] : "web/graph.txt");
    std::cout << (checks - failures) << "/" << checks << " checks passed\n";
    return failures ? 1 : 0;
}
