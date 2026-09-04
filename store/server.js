import path from "node:path";
import express from "express";
import pg from "pg";
import { parseOrder, SEED } from "./store.js";

const PORT = Number(process.env.PORT || 3000);

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

const db = pool();
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/api/products", async (_req, res) => {
  const { rows } = await db.query(
    "select id, slug, name, blurb, price, glyph, tint from store_products order by name",
  );
  res.json(rows);
});

app.post("/api/orders", async (req, res) => {
  try {
    const { rows: products } = await db.query("select id, name, price from store_products");
    const order = parseOrder(req.body, products);
    const { rows } = await db.query(
      "insert into store_orders (customer_name, email, items, total) values ($1,$2,$3::jsonb,$4) returning id, total, created_at",
      [order.name, order.email, JSON.stringify(order.items), order.total],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.use(express.static(path.resolve("public")));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  res.sendFile(path.resolve("public/index.html"));
});

async function migrate() {
  await db.query(`
    create table if not exists store_products (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique,
      name text not null,
      blurb text not null,
      price integer not null,
      glyph text not null,
      tint text not null
    )
  `);
  await db.query(`
    create table if not exists store_orders (
      id uuid primary key default gen_random_uuid(),
      customer_name text not null,
      email text not null,
      items jsonb not null,
      total integer not null,
      created_at timestamptz not null default now()
    )
  `);
  const { rows } = await db.query("select count(*)::int as n from store_products");
  if (rows[0].n === 0) {
    for (const p of SEED) {
      await db.query(
        "insert into store_products (slug, name, blurb, price, glyph, tint) values ($1,$2,$3,$4,$5,$6)",
        [p.slug, p.name, p.blurb, p.price, p.glyph, p.tint],
      );
    }
  }
}

migrate()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => console.log(`store on ${PORT}`));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
