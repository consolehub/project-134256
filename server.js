// Multiplayer presence: who is exploring, and where (level type, seed, position).
// Only players with multiplayer switched on are listed or broadcast.
const players = new Map(); // conn.id -> { id, username, on, w, s, f, x, y, z, r }
const conns = new Map();   // conn.id -> conn
let dirty = false, rosterDirty = false;

const num = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e6;
const q = (v, k = 100) => Math.round(v * k) / k;

function roster() {
  return [...players.values()].filter((p) => p.on && p.w !== undefined).map((p) => ({ id: p.id, username: p.username }));
}

export const room = {
  tickMs: 100,
  async onConnect(conn, room) {
    const username = conn.username || "guest-" + String(conn.id).slice(-4);
    players.set(conn.id, { id: conn.id, username, on: false, lastChat: 0 });
    conns.set(conn.id, conn);
    conn.send({ type: "welcome", id: conn.id, players: roster() });
  },
  async onMessage(conn, message, room) {
    const me = players.get(conn.id);
    if (!me) return;
    let m;
    try { m = JSON.parse(message); } catch { return; }
    if (m.type === "off") {
      if (me.on) { me.on = false; rosterDirty = dirty = true; }
      return;
    }
    if (m.type === "chat") {
      if (!me.on) return;
      const now = Date.now();
      if (now - me.lastChat < 600) return;
      const text = room.censor(String(m.text ?? "")).replace(/\s+/g, " ").trim().slice(0, 160);
      if (!text) return;
      me.lastChat = now;
      const msg = { type: "chat", id: me.id, username: me.username, text };
      for (const p of players.values()) if (p.on) conns.get(p.id)?.send(msg);
      return;
    }
    if (m.type !== "state") return;
    if (!Number.isInteger(m.w) || m.w < 0 || m.w > 31) return;
    if (!Number.isInteger(m.s) || m.s < 0 || m.s > 4294967295) return;
    if (!(m.f === null || (Number.isInteger(m.f) && m.f >= 0 && m.f <= 31))) return;
    if (![m.x, m.y, m.z, m.r].every(num)) return;
    const wasListed = me.on && me.w !== undefined;
    Object.assign(me, { on: true, w: m.w, s: m.s, f: m.f, x: q(m.x), y: q(m.y), z: q(m.z), r: q(m.r) });
    if (!wasListed) rosterDirty = true;
    dirty = true;
  },
  async onTick(room) {
    if (rosterDirty) { rosterDirty = false; room.broadcast({ type: "roster", players: roster() }); }
    if (!dirty) return;
    dirty = false;
    const snap = [...players.values()].filter((p) => p.on && p.w !== undefined)
      .map(({ id, w, s, f, x, y, z, r }) => ({ id, w, s, f, x, y, z, r }));
    room.broadcast({ type: "snap", t: Date.now(), players: snap });
  },
  async onClose(conn, room) {
    const p = players.get(conn.id);
    players.delete(conn.id);
    conns.delete(conn.id);
    if (p?.on) { rosterDirty = dirty = true; }
  },
};

export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
