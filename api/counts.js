// Shared store for the step-counting form (web/count.html). Runs as a Vercel function.
//   GET  /api/counts.js   -> { counts: { "W1-0": { value, at }, ... } }   the current number in every box
//   POST /api/counts.js   { key, value } -> { ok: true, key, value, at }  (value null empties the box)
// Only the current number is kept: saving again replaces it.
//
// Storage: the Redis database connected to the Vercel project. It gives REDIS_URL (a plain Redis
// connection) or, for Upstash, KV_REST_API_URL + KV_REST_API_TOKEN. With neither, scripts/serve.mjs
// sets LOCAL_MEMORY_STORE so the form can be tried locally.
import { createClient } from "redis";

const HASH = "step-counts";
const KEY_PATTERN = /^(W[1-9]-\d{1,2}|short-e\d{2,3}|once-[a-z]+)$/;
const NOT_SET_UP = "Saving isn't switched on yet: the site owner needs to connect the database in Vercel.";

/* ---------- three ways to store the hash ---------- */

const memory = {};
const memoryStore = {
  all: async () => ({ ...memory }),
  set: async (key, json) => { memory[key] = json; },
  remove: async key => { delete memory[key]; },
};

function restStore(url, token) {
  const call = async command => {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error || `database answered ${res.status}`);
    return data.result;
  };
  return {
    all: async () => {
      const flat = await call(["HGETALL", HASH]);  // [key1, json1, key2, json2, ...]
      const out = {};
      for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1];
      return out;
    },
    set: (key, json) => call(["HSET", HASH, key, json]),
    remove: key => call(["HDEL", HASH, key]),
  };
}

let client;  // kept between requests while the function stays warm
async function connected(url) {
  if (!client) {
    client = createClient({ url, socket: { connectTimeout: 5000 } });
    client.on("error", () => {});  // a dropped connection is reported by the command that fails
  }
  if (!client.isOpen) await client.connect();
  return client;
}
function tcpStore(url) {
  return {
    all: async () => (await connected(url)).hGetAll(HASH),
    set: async (key, json) => (await connected(url)).hSet(HASH, key, json),
    remove: async key => (await connected(url)).hDel(HASH, key),
  };
}

function store() {
  const env = process.env;
  const restUrl = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const restToken = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (restUrl && restToken) return restStore(restUrl, restToken);
  if (env.REDIS_URL || env.KV_URL) return tcpStore(env.REDIS_URL || env.KV_URL);
  if (env.LOCAL_MEMORY_STORE) return memoryStore;
  return null;
}
// Names (never values) of database-looking settings, to see why saving isn't switched on.
const settingNames = () => Object.keys(process.env).filter(k => /KV|REDIS|UPSTASH/i.test(k)).sort();

/* ---------- the two requests ---------- */

const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const db = store();
  if (!db) return reply({ error: NOT_SET_UP, settingsSeen: settingNames() }, 503);
  try {
    const raw = await db.all();
    const counts = {};
    for (const key in raw) counts[key] = JSON.parse(raw[key]);
    return reply({ counts });
  } catch (err) {
    return reply({ error: `Couldn't read the counts (${err.message}).` }, 502);
  }
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return reply({ error: "Send the count as JSON." }, 400);
  }
  const key = String(body.key ?? "");
  const value = body.value == null || body.value === "" ? null : Number(body.value);
  if (!KEY_PATTERN.test(key)) return reply({ error: "That count isn't on the list." }, 400);
  if (value !== null && (!Number.isInteger(value) || value < 0 || value > 2000))
    return reply({ error: "Steps must be a whole number from 0 to 2000." }, 400);

  const db = store();
  if (!db) return reply({ error: NOT_SET_UP }, 503);
  const at = Date.now();
  try {
    if (value == null) await db.remove(key);
    else await db.set(key, JSON.stringify({ value, at }));
  } catch (err) {
    return reply({ error: `Couldn't save (${err.message}).` }, 503);
  }
  return reply({ ok: true, key, value, at });
}
