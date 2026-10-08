// Terminal front end: prints the shortest walking route between two places.
//   router <graph.txt> <from> <to>
//   router <graph.txt>              then type "FROM TO" pairs, one per line
#include "graph.hpp"

#include <fstream>
#include <iostream>
#include <sstream>

static void printRoute(const Graph& graph, const std::string& from, const std::string& to) {
    if (!graph.hasNode(from)) { std::cout << "Unknown place: " << from << "\n"; return; }
    if (!graph.hasNode(to)) { std::cout << "Unknown place: " << to << "\n"; return; }

    Route route = graph.shortestPath(from, to);
    if (!route.found) {
        std::cout << "No route from " << from << " to " << to << "\n";
        return;
    }
    std::cout << from << " -> " << to << ": " << route.steps << " steps\n  " << route.path[0];
    for (size_t i = 1; i < route.path.size(); ++i)
        std::cout << " -(" << route.legs[i - 1] << ")-> " << route.path[i];
    std::cout << "\n";
}

int main(int argc, char** argv) {
    if (argc != 2 && argc != 4) {
        std::cerr << "usage: router <graph.txt> [FROM TO]\n";
        return 2;
    }
    std::ifstream file(argv[1]);
    if (!file) {
        std::cerr << "Can't open " << argv[1] << "\n";
        return 1;
    }
    std::stringstream contents;
    contents << file.rdbuf();

    Graph graph;
    std::string error;
    if (!graph.loadFromText(contents.str(), error)) {
        std::cerr << argv[1] << ": " << error << "\n";
        return 1;
    }

    if (argc == 4) {
        printRoute(graph, argv[2], argv[3]);
        return 0;
    }
    std::cout << "Loaded " << graph.nodeCount() << " places and " << graph.edgeCount()
              << " links. Type FROM TO (e.g. A006 B012), Ctrl+Z then Enter to quit.\n";
    std::string from, to;
    while (std::cin >> from >> to) printRoute(graph, from, to);
    return 0;
}
