// The two functions the website calls (see web/app.js). Compiled to WebAssembly by
// `node scripts/build.mjs wasm`; plain C++, so tests.cpp can test it too.
#include "graph.hpp"

#include <string>

using namespace std;

static vector<string> names;
static map<string, int> ids;
static Matrix matrix;
static string reply;  // the text handed back to the website must stay alive after we return

static string quoted(const string& s) { return "\"" + s + "\""; }  // place names have no quotes in them

extern "C" {

// Builds the graph from graph.txt's text. Returns "" if it worked, else what went wrong.
const char* load_graph(const char* text) {
    names.clear();
    ids.clear();
    string error;
    reply = buildGraph(text, names, ids, matrix, error) ? "" : error;
    return reply.c_str();
}

// Runs Dijkstra and answers in JSON, for example
//   {"found":true,"steps":42,"path":["A006","D1@0",...],"legs":[2,6,...]}
//   {"found":false,"unknown":"X"}   when a place isn't in the graph
const char* find_route(const char* from, const char* to) {
    if (ids.count(from) == 0 || ids.count(to) == 0) {
        reply = "{\"found\":false,\"unknown\":" + quoted(ids.count(from) == 0 ? from : to) + "}";
        return reply.c_str();
    }
    vector<int> path = dijkstra(ids[from], ids[to], matrix);
    if (path.empty()) {
        reply = "{\"found\":false,\"steps\":0,\"path\":[],\"legs\":[]}";
        return reply.c_str();
    }
    int total = 0;
    string places = quoted(names[path[0]]), legs;
    for (size_t i = 1; i < path.size(); i++) {
        int steps = matrix[path[i - 1]][path[i]];
        total += steps;
        places += "," + quoted(names[path[i]]);
        legs += (i > 1 ? "," : "") + to_string(steps);
    }
    reply = "{\"found\":true,\"steps\":" + to_string(total) + ",\"path\":[" + places + "],\"legs\":[" + legs + "]}";
    return reply.c_str();
}

}  // extern "C"
