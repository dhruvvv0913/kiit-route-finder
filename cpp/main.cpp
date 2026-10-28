// Terminal program: prints the shortest walking route between two places.
//   router <graph.txt> <from> <to>
//   router <graph.txt>              then type "FROM TO" pairs, one per line
#include "graph.hpp"

#include <fstream>
#include <iostream>
#include <sstream>

using namespace std;

// ---------------------------------------------------------------------------
// Step 3: print the answer (total steps, places in order, steps of each hop).
// ---------------------------------------------------------------------------
void printRoute(const string& from, const string& to, const vector<string>& names,
                const map<string, int>& ids, const Matrix& matrix) {
    if (ids.count(from) == 0) { cout << "Unknown place: " << from << "\n"; return; }
    if (ids.count(to) == 0)   { cout << "Unknown place: " << to << "\n"; return; }

    vector<int> path = dijkstra(ids.at(from), ids.at(to), matrix);
    if (path.empty()) {
        cout << "No route from " << from << " to " << to << "\n";
        return;
    }

    int total = 0;
    for (size_t i = 1; i < path.size(); i++) total += matrix[path[i - 1]][path[i]];

    cout << from << " -> " << to << ": " << total << " steps\n  " << names[path[0]];
    for (size_t i = 1; i < path.size(); i++)
        cout << " -(" << matrix[path[i - 1]][path[i]] << ")-> " << names[path[i]];
    cout << "\n";
}

int main(int argc, char** argv) {
    if (argc != 2 && argc != 4) {
        cerr << "usage: router <graph.txt> [FROM TO]\n";
        return 2;
    }
    ifstream file(argv[1]);
    if (!file) {
        cerr << "Can't open " << argv[1] << "\n";
        return 1;
    }
    stringstream contents;
    contents << file.rdbuf();

    vector<string> names;
    map<string, int> ids;
    Matrix matrix;
    string error;
    if (!buildGraph(contents.str(), names, ids, matrix, error)) {
        cerr << argv[1] << ": " << error << "\n";
        return 1;
    }

    if (argc == 4) {
        printRoute(argv[2], argv[3], names, ids, matrix);
        return 0;
    }
    cout << "Loaded " << names.size() << " places. Type FROM TO (e.g. A006 B012), Ctrl+Z then Enter to quit.\n";
    string from, to;
    while (cin >> from >> to) printRoute(from, to, names, ids, matrix);
    return 0;
}
