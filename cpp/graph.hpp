#pragma once

#include <string>
#include <unordered_map>
#include <utility>
#include <vector>

// One walking route: the total steps, the places passed from start to end,
// and the steps of each hop between consecutive places.
struct Route {
    bool found = false;
    long long steps = 0;
    std::vector<std::string> path;
    std::vector<int> legs;  // legs[i] = steps from path[i] to path[i + 1]
};

// The building as an undirected weighted graph, stored as an adjacency list.
// Places are named ("A006", "J3@0"), and every edge weight is a number of walking steps.
class Graph {
public:
    static const long long INF;

    // Reads one edge per line: "placeA placeB steps".
    // Blank lines and lines starting with '#' are skipped.
    // Returns false and describes the problem in `error` if a line is malformed.
    bool loadFromText(const std::string& text, std::string& error);

    void addEdge(const std::string& a, const std::string& b, int steps);

    bool hasNode(const std::string& name) const { return index_.count(name) > 0; }
    int indexOf(const std::string& name) const;  // -1 if the place is unknown
    int nodeCount() const { return static_cast<int>(names_.size()); }
    int edgeCount() const { return edgeCount_; }
    const std::vector<std::string>& names() const { return names_; }

    // Steps of the shortest direct edge between a and b, or -1 if they are not adjacent.
    int edgeSteps(const std::string& a, const std::string& b) const;

    // Dijkstra's algorithm with a binary min-heap: O((V + E) log V).
    Route shortestPath(const std::string& from, const std::string& to) const;

    // Floyd-Warshall all-pairs distances: O(V^3). Used to cross-check Dijkstra.
    std::vector<std::vector<long long>> allPairsDistances() const;

private:
    int addNode(const std::string& name);

    std::vector<std::string> names_;                     // node index -> place name
    std::unordered_map<std::string, int> index_;         // place name -> node index
    std::vector<std::vector<std::pair<int, int>>> adj_;  // node index -> (neighbour, steps)
    int edgeCount_ = 0;
};
