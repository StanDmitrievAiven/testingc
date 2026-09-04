import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import pg from "pg";
import { parseAccount } from "./src/stages.js";

const PORT = Number(process.env.PORT || 3000);
const AUTH_USER = process.env.AUTH_USER || "";
const AUTH_PASSWORD = process.env.AUTH_PASSWORD || "";
const SESSION_SECRET = process.env.SESSION_SECRET || "";
const COOKIE = "crm_session";
const WEEK = 7 * 24 * 60 * 60 * 1000;

function pool() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL required");
  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  const ssl = process.env.PROJECT_CA_CERT
    ? { ca: Buffer.from(process.env.PROJECT_CA_CERT, "base64").toString(), rejectUnauthorized: true }
    : undefined;
  return new pg.Pool({ connectionString: url.toString(), ssl, max: 5 });
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${mac}`;
}

function readSession(req) {
  const raw = (req.headers.cookie || "")
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const token = decodeURIComponent(raw.slice(COOKIE.length + 1));
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!data?.u || data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

function setCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${WEEK / 1000}`,
  );
}

function clearCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

function same(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ponytail: global login throttle, per-IP if more than one person uses this
let fails = 0;
let failReset = 0;
function throttled() {
  const now = Date.now();
  if (now > failReset) {
    fails = 0;
    failReset = now + 15 * 60_000;
  }
  return fails > 30;
}

const db = pool();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/api/login", (req, res) => {
  if (throttled()) return res.status(429).json({ error: "too many attempts" });
  const user = String(req.body?.user || "");
  const password = String(req.body?.password || "");
  if (!AUTH_USER || !AUTH_PASSWORD || !SESSION_SECRET) {
    return res.status(500).json({ error: "auth is not configured" });
  }
  if (!same(user, AUTH_USER) || !same(password, AUTH_PASSWORD)) {
    fails += 1;
    return res.status(401).json({ error: "invalid credentials" });
  }
  fails = 0;
  setCookie(res, sign({ u: AUTH_USER, exp: Date.now() + WEEK }));
  res.json({ ok: true, user: AUTH_USER });
});

app.post("/api/logout", (_req, res) => {
  clearCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "unauthorized" });
  res.json({ user: session.u });
});

function auth(req, res, next) {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "unauthorized" });
  req.user = session.u;
  next();
}

app.get("/api/accounts", auth, async (_req, res) => {
  const { rows } = await db.query("select * from accounts order by updated_at desc");
  res.json(rows);
});

app.post("/api/accounts", auth, async (req, res) => {
  try {
    const a = parseAccount(req.body);
    const { rows } = await db.query(
      `insert into accounts (name, company, email, phone, stage, value, notes, next_action, follow_up_on, lost_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       returning *`,
      [a.name, a.company || "", a.email || "", a.phone || "", a.stage, a.value, "", a.next_action || "", a.follow_up_on || "", a.lost_reason || ""],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch("/api/accounts/:id", auth, async (req, res) => {
  try {
    const a = parseAccount(req.body, { partial: true });
    const fields = Object.keys(a);
    if (!fields.length) return res.status(400).json({ error: "nothing to update" });
    const sets = fields.map((k, i) => `${k} = $${i + 2}`);
    const { rows } = await db.query(
      `update accounts set ${sets.join(", ")}, updated_at = now() where id = $1 returning *`,
      [req.params.id, ...fields.map((k) => a[k])],
    );
    if (!rows[0]) return res.status(404).json({ error: "not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete("/api/accounts/:id", auth, async (req, res) => {
  const { rowCount } = await db.query("delete from accounts where id = $1", [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: "not found" });
  res.status(204).end();
});

app.get("/api/accounts/:id/notes", auth, async (req, res) => {
  const { rows } = await db.query(
    "select id, body, created_at from account_notes where account_id = $1 order by created_at asc",
    [req.params.id],
  );
  res.json(rows);
});

app.post("/api/accounts/:id/notes", auth, async (req, res) => {
  const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!body) return res.status(400).json({ error: "body is required" });
  if (body.length > 5000) return res.status(400).json({ error: "body is too long" });
  try {
    const { rows } = await db.query(
      "insert into account_notes (account_id, body) values ($1, $2) returning id, body, created_at",
      [req.params.id, body],
    );
    res.status(201).json(rows[0]);
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

app.use(express.static("dist"));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.resolve("dist/index.html"));
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "server error" });
});

async function migrate() {
  await db.query(`
    create table if not exists accounts (
      id uuid primary key default gen_random_uuid(),
      name text not null,
      company text not null default '',
      email text not null default '',
      phone text not null default '',
      stage text not null default 'lead',
      value integer not null default 0,
      notes text not null default '',
      next_action text not null default '',
      follow_up_on text not null default '',
      lost_reason text not null default '',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint accounts_stage_check check (stage in ('lead','qualified','proposal','negotiation','won','lost'))
    )
  `);
  await db.query(`alter table accounts add column if not exists next_action text not null default ''`);
  await db.query(`alter table accounts add column if not exists follow_up_on text not null default ''`);
  await db.query(`alter table accounts add column if not exists lost_reason text not null default ''`);
  await db.query(`
    create table if not exists account_notes (
      id uuid primary key default gen_random_uuid(),
      account_id uuid not null references accounts(id) on delete cascade,
      body text not null,
      created_at timestamptz not null default now()
    )
  `);
  await db.query(`
    insert into account_notes (account_id, body, created_at)
    select id, notes, created_at from accounts
    where notes <> ''
      and not exists (select 1 from account_notes n where n.account_id = accounts.id)
  `);
}

migrate()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => console.log(`crm on ${PORT}`));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
