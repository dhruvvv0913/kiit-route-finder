// The functions the website calls through WebAssembly (see web/app.js).
// Built with Emscripten by `node scripts/build.mjs wasm`; plain C++, so it also compiles natively.
#include "graph.hpp"

#include <sstream>
#include <string>

static Graph graph;
static std::string reply;  // returned C strings must stay alive after the call returns

static void writeJsonString(std::ostringstream& out, const std::string& s) {
    out << '"';
    for (char c : s) {
        if (c == '"' || c == '\\') out << '\\';
        out << c;
    }
    out << '"';
}

extern "C" {

// Replaces the current graph with the edges in `text`. Returns "" on success, else the error.
const char* load_graph(const char* text) {
    graph = Graph();
    std::string error;
    reply = graph.loadFromText(text, error) ? "" : error;
    return reply.c_str();
}

// Returns JSON: {"found":true,"steps":42,"path":["A006","D1@0",...],"legs":[2,6,...]}
// or {"found":false,"unknown":"X"} when a place isn't in the graph.
const char* find_route(const char* from, const char* to) {
    std::ostringstream out;
    if (!graph.hasNode(from) || !graph.hasNode(to)) {
        out << "{\"found\":false,\"unknown\":";
        writeJsonString(out, graph.hasNode(from) ? to : from);
        out << "}";
    } else {
        Route route = graph.shortestPath(from, to);
        out << "{\"found\":" << (route.found ? "true" : "false") << ",\"steps\":" << route.steps << ",\"path\":[";
        for (size_t i = 0; i < route.path.size(); ++i) {
            if (i) out << ',';
            writeJsonString(out, route.path[i]);
        }
        out << "],\"legs\":[";
        for (size_t i = 0; i < route.legs.size(); ++i) out << (i ? "," : "") << route.legs[i];
        out << "]}";
    }
    reply = out.str();
    return reply.c_str();
}

}  // extern "C"
