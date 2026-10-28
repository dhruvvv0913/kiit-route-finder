// Tests for the route finder: small graphs with known answers, the website functions,
// then the real building.   Run: node scripts/build.mjs test
#include "graph.hpp"

#include <fstream>
#include <iostream>
#include <sstream>

using namespace std;

extern "C" const char* load_graph(const char* text);
extern "C" const char* find_route(const char* from, const char* to);

static int checks = 0, failures = 0;
#define CHECK(cond)                                                        \
    do {                                                                   \
        checks++;                                                          \
        if (!(cond)) {                                                     \
            failures++;                                                    \
            cerr << "FAIL tests.cpp:" << __LINE__ << "  " #cond "\n";      \
        }                                                                  \
    } while (0)

// A small graph for the tests to use.
struct Test {
    vector<string> names;
    map<string, int> ids;
    Matrix matrix;
    bool ok;
    string error;
    Test(const string& text) { ok = buildGraph(text, names, ids, matrix, error); }

    // The places on the shortest route, joined with spaces ("" = no route).
    string route(const string& from, const string& to) {
        if (ids.count(from) == 0 || ids.count(to) == 0) return "";
        string out;
        for (int v : dijkstra(ids[from], ids[to], matrix)) out += (out.empty() ? "" : " ") + names[v];
        return out;
    }
    // Total steps of that route (-1 = no route).
    int steps(const string& from, const string& to) {
        if (ids.count(from) == 0 || ids.count(to) == 0) return -1;
        vector<int> path = dijkstra(ids[from], ids[to], matrix);
        if (path.empty()) return -1;
        int total = 0;
        for (size_t i = 1; i < path.size(); i++) total += matrix[path[i - 1]][path[i]];
        return total;
    }
};

static void smallGraphs() {
    // The direct corridor A-B is longer than going round through C.
    Test g("A B 10\nA C 3\nC B 4\nX Y 1\n");
    CHECK(g.ok);
    CHECK(g.route("A", "B") == "A C B" && g.steps("A", "B") == 7);
    CHECK(g.route("C", "C") == "C" && g.steps("C", "C") == 0);  // already there
    CHECK(g.steps("A", "X") == -1);                             // not connected
    CHECK(g.steps("A", "Z") == -1);                             // unknown place

    // The same corridor twice: the shorter one counts.
    Test p("A B 9\nA B 4\n");
    CHECK(p.steps("A", "B") == 4);

    // Always taking the nearest next step gives A-D-E-F (1+1+10 = 12); the shortest is A-B-C-F (6).
    Test trap("A D 1\nD E 1\nE F 10\nA B 2\nB C 2\nC F 2\n");
    CHECK(trap.route("A", "F") == "A B C F" && trap.steps("A", "F") == 6);

    // Comments, blank lines, Windows line endings and 0-step corridors are fine.
    Test c("# comment\r\n\r\n  A B 0\r\nB C 5\r\n");
    CHECK(c.ok && c.names.size() == 3 && c.steps("A", "C") == 5);

    // Broken lines are refused, naming the line.
    CHECK(!Test("A B 3\nA B\n").ok && Test("A B 3\nA B\n").error.find("line 2") == 0);
    CHECK(!Test("A B -1\n").ok);
    CHECK(!Test("A B 3 4\n").ok);
}

static void websiteFunctions() {
    CHECK(string(load_graph("A B 2\nB C 3\n")) == "");
    CHECK(string(find_route("A", "C")) == "{\"found\":true,\"steps\":5,\"path\":[\"A\",\"B\",\"C\"],\"legs\":[2,3]}");
    CHECK(string(find_route("A", "Q")) == "{\"found\":false,\"unknown\":\"Q\"}");
    CHECK(string(load_graph("A B x\n")).find("line 1") == 0);
}

static void building(const string& file) {
    ifstream in(file);
    CHECK(in.good());
    stringstream text;
    text << in.rdbuf();
    Test g(text.str());
    CHECK(g.ok);

    // Rooms are the names without '@' (A006, B112, ...); the second character is the floor.
    vector<string> rooms;
    for (const string& name : g.names)
        if (name.find('@') == string::npos) rooms.push_back(name);
    CHECK(rooms.size() == 160);  // 40 rooms on each of 4 floors

    // Every pair of rooms on the same floor, and every ground-floor room to every 3rd-floor
    // room: there is a route, and A -> B is as long as B -> A.
    int unreachable = 0, oneWay = 0;
    for (const string& a : rooms)
        for (const string& b : rooms) {
            bool sameFloor = a[1] == b[1] && a < b;
            bool groundToTop = a[1] == '0' && b[1] == '3';
            if (!sameFloor && !groundToTop) continue;
            int there = g.steps(a, b);
            if (there < 0) unreachable++;
            if (there != g.steps(b, a)) oneWay++;
        }
    CHECK(unreachable == 0);
    CHECK(oneWay == 0);

    // Rooms facing each other share a door point, so the route just crosses the corridor.
    CHECK(g.route("A007", "A008") == "A007 D2@0 A008");
    CHECK(g.route("B209", "B210") == "B209 D22@2 B210");

    // From A015 the passage through C block (34 + 34 steps) beats the link corridor.
    CHECK(g.route("A015", "B018").find("N2@0 C_MID@0 N3@0") != string::npos);

    // Going up two floors climbs one staircase: S?@0, S?@1, S?@2 in a row.
    string up = g.route("A006", "A206");
    bool climbs = false;
    for (char s = '1'; s <= '7'; s++) {
        string stair = string("S") + s;
        if (up.find(stair + "@0 " + stair + "@1 " + stair + "@2") != string::npos) climbs = true;
    }
    CHECK(climbs);

    cout << "building: " << g.names.size() << " places, " << rooms.size() << " rooms\n";
}

int main(int argc, char** argv) {
    smallGraphs();
    websiteFunctions();
    building(argc > 1 ? argv[1] : "web/graph.txt");
    cout << (checks - failures) << "/" << checks << " checks passed\n";
    return failures ? 1 : 0;
}
