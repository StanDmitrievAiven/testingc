export const SEED = [
  { slug: "hot-spring-towel", name: "Hot spring towel", blurb: "Thick cotton. Dries like it sat by a geyser.", price: 2800, glyph: "🛁", tint: "#d7e4dc" },
  { slug: "orange-slice-hat", name: "Orange slice hat", blurb: "The classic look. Citrus not included, unfortunately.", price: 1800, glyph: "🍊", tint: "#f3d9c4" },
  { slug: "pond-plush", name: "Pond plush", blurb: "Weighted, squat, and slightly damp-looking on purpose.", price: 4200, glyph: "🦫", tint: "#e4d9c8" },
  { slug: "mineral-mug", name: "Mineral mug", blurb: "Stoneware that holds a Sunday’s worth of tea.", price: 2200, glyph: "☕", tint: "#efe6d8" },
  { slug: "moss-socks", name: "Moss socks", blurb: "Wool blend. For feet that prefer riverbanks.", price: 1400, glyph: "🧦", tint: "#dce6d4" },
  { slug: "float-print", name: "Sunday float print", blurb: "A3. One capybara, many oranges, no rush.", price: 1600, glyph: "🖼", tint: "#eadfcf" },
];

export function money(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100);
}

export function parseOrder(input, products) {
  if (input == null || typeof input !== "object") throw new Error("body required");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim() : "";
  if (!name) throw new Error("name is required");
  if (name.length > 200) throw new Error("name is too long");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw new Error("invalid email");
  if (!Array.isArray(input.items) || !input.items.length) throw new Error("cart is empty");
  if (input.items.length > 20) throw new Error("too many lines");
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = [];
  let total = 0;
  for (const row of input.items) {
    const id = row?.id;
    const qty = Number(row?.qty);
    if (!byId.has(id)) throw new Error("unknown product");
    if (!Number.isInteger(qty) || qty < 1 || qty > 9) throw new Error("invalid qty");
    const product = byId.get(id);
    total += product.price * qty;
    lines.push({ id, qty, name: product.name, price: product.price });
  }
  return { name, email, items: lines, total };
}
