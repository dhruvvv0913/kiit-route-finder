// Shared store for the step-counting form (web/count.html). Runs as a Vercel function.
//   GET  /api/counts   -> { counts: { "W1-0": { value, at }, ... } }   the current number in every box
//   POST /api/counts   { key, value } -> { ok: true, key, value, at }  (value null empties the box)
// Only the current number is kept: saving again replaces it.
//
// Storage: an Upstash Redis database connected to the Vercel project (it adds KV_REST_API_URL and
// KV_REST_API_TOKEN). With no database, scripts/serve.mjs sets LOCAL_MEMORY_STORE for local testing.
const HASH = "step-counts";
const KEY_PATTERN = /^(W[1-9]-\d{1,2}|short-e\d{2,3}|once-[a-z]+)$/;
const NOT_SET_UP = "Saving isn't switched on yet: the site owner needs to connect the database in Vercel.";
const memory = {};

function database() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
const useMemory = () => !database() && process.env.LOCAL_MEMORY_STORE;

async function redis(command) {
  const { url, token } = database();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `database answered ${res.status}`);
  return data.result;
}

const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  try {
    if (useMemory()) return reply({ counts: memory });
    if (!database()) return reply({ error: NOT_SET_UP }, 503);
    const flat = await redis(["HGETALL", HASH]);  // [key1, json1, key2, json2, ...]
    const counts = {};
    for (let i = 0; i < flat.length; i += 2) counts[flat[i]] = JSON.parse(flat[i + 1]);
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

  const at = Date.now();
  try {
    if (useMemory()) {
      if (value == null) delete memory[key];
      else memory[key] = { value, at };
    } else if (!database()) {
      return reply({ error: NOT_SET_UP }, 503);
    } else if (value == null) {
      await redis(["HDEL", HASH, key]);
    } else {
      await redis(["HSET", HASH, key, JSON.stringify({ value, at })]);
    }
  } catch (err) {
    return reply({ error: `Couldn't save (${err.message}).` }, 503);
  }
  return reply({ ok: true, key, value, at });
}
