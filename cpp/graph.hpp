#pragma once

#include <map>
#include <string>
#include <vector>

const int INF = 1000000000;  // "not reachable yet"
const int NO_EDGE = -1;      // matrix value meaning "no corridor" (0 is a valid step count)

typedef std::vector<std::vector<int>> Matrix;

// Step 1: read graph.txt ("placeA placeB steps" per line) into the vertex list and the
// adjacency matrix. matrix[u][v] = steps between u and v, NO_EDGE if they aren't joined.
bool buildGraph(const std::string& text, std::vector<std::string>& names, std::map<std::string, int>& ids,
                Matrix& matrix, std::string& error);

// Step 2: Dijkstra. The vertices on the shortest path, source first. Empty = no route.
std::vector<int> dijkstra(int source, int destination, const Matrix& matrix);
