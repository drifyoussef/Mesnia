// Live updates with Server-Sent Events: each open app keeps one stream per household, and the
// server tells it which part changed ("shopping", "tasks"...). The app then reloads that part.
// Only topic names travel on the stream, never data: the reload goes through the usual
// access checks. Kept in memory: fine for one server instance (several would need Redis pub/sub).

const HEARTBEAT_MS = 25 * 1000; // below the idle timeout of proxies (Render, Nginx...)

const streams = new Map(); // householdId -> Set<res>

function subscribe(householdId, req, res) {
  const key = householdId.toString();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no' // Nginx: do not buffer the stream
  });
  res.flushHeaders();
  res.write('retry: 5000\n\n');

  if (!streams.has(key)) streams.set(key, new Set());
  streams.get(key).add(res);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    const set = streams.get(key);
    set?.delete(res);
    if (set?.size === 0) streams.delete(key);
  });
}

/**
 * @param {import('mongodb').ObjectId|string} householdId
 * @param {string} topic   "shopping", "tasks", "meal-plan", "calendar", "swipe", "household"
 * @param {string} [by]    user id of the author, so their own app can skip the reload
 */
function publish(householdId, topic, by) {
  const set = streams.get(householdId.toString());
  if (!set) return;
  const payload = `event: change\ndata: ${JSON.stringify({ topic, by: by || null })}\n\n`;
  for (const res of set) res.write(payload);
}

module.exports = { subscribe, publish };
