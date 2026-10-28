// Serves web/ at http://localhost:8080 for local testing (the page fetches files, so file:// won't work).
// /api/counts runs api/counts.js the way Vercel would; without a database it keeps counts in memory.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as counts from "../api/counts.js";

process.env.LOCAL_MEMORY_STORE ||= "1";
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const port = Number(process.env.PORT) || 8080;
const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript",
  ".json": "application/json", ".txt": "text/plain; charset=utf-8", ".wasm": "application/wasm", ".png": "image/png", ".webmanifest": "application/manifest+json",
};

async function api(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const hasBody = !["GET", "HEAD"].includes(req.method);
  const request = new Request(`http://localhost${req.url}`, { method: req.method, headers: req.headers, body: hasBody ? Buffer.concat(chunks) : undefined });
  const handler = counts[req.method];
  const response = handler ? await handler(request) : new Response("Method not allowed", { status: 405 });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  if (urlPath === "/api/counts" || urlPath === "/api/counts.js") return void api(req, res).catch(err => res.writeHead(500).end(String(err)));
  const file = path.join(dir, urlPath.endsWith("/") ? urlPath + "index.html" : urlPath);
  if (!file.startsWith(dir)) return res.writeHead(403).end();
  fs.readFile(file, (err, data) => {
    if (err) return res.writeHead(404).end("Not found");
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }).end(data);
  });
}).listen(port, () => console.log(`Serving web/ at http://localhost:${port}`));
