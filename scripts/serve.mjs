// Serves web/ at http://localhost:8080 for local testing (the page fetches files, so file:// won't work).
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const port = Number(process.env.PORT) || 8080;
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm",
};

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const file = path.join(dir, urlPath.endsWith("/") ? urlPath + "index.html" : urlPath);
  if (!file.startsWith(dir)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }).end(data);
  });
}).listen(port, () => console.log(`Serving web/ at http://localhost:${port}`));
