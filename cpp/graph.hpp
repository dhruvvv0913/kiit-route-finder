#pragma once

#include <map>
#include <string>
#include <vector>

// A corridor link from one place to a neighbouring place.
struct Edge {
    int to;     // index of the neighbouring place
    int steps;  // walking steps to get there
};

// The answer to "how do I get from A to B?".
struct Route {
    bool found = false;
    int totalSteps = 0;
    std::vector<std::string> path;  // places from start to end
    std::vector<int> legs;          // legs[i] = steps from path[i] to path[i + 1]
};

// The building as a graph: places (rooms, corridor points, stairs...) joined by corridors.
class Graph {
public:
    // Adds a corridor between two places. Corridors work in both directions.
    void addEdge(const std::string& a, const std::string& b, int steps);

    // Reads one corridor per line: "placeA placeB steps". Lines starting with '#' are skipped.
    // Returns false and fills `error` if a line is wrong.
    bool loadFromText(const std::string& text, std::string& error);

    bool hasPlace(const std::string& name) const;
    int placeCount() const { return (int)names.size(); }
    const std::vector<std::string>& placeNames() const { return names; }

    // Dijkstra's algorithm: the route with the fewest total steps.
    Route shortestPath(const std::string& from, const std::string& to) const;

private:
    int idOf(const std::string& name);  // the place's number, adding it if it's new

    std::vector<std::string> names;      // place number -> name, e.g. 0 -> "A006"
    std::map<std::string, int> ids;      // name -> place number, e.g. "A006" -> 0
    std::vector<std::vector<Edge>> adj;  // adjacency list: adj[p] = corridors leaving place p
};
