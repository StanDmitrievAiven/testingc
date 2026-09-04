import assert from "node:assert/strict";
import { money, parseOrder, SEED } from "./store.js";

assert.equal(SEED.length, 6);
assert.equal(money(1800), "$18.00");

const catalog = SEED.map((p, i) => ({ ...p, id: `p${i}` }));
const order = parseOrder(
  { name: " Ava ", email: "ava@pond.test", items: [{ id: "p1", qty: 2 }, { id: "p5", qty: 1 }] },
  catalog,
);
assert.equal(order.name, "Ava");
assert.equal(order.total, 1800 * 2 + 1600);

assert.throws(() => parseOrder({ name: "x", email: "nope", items: [{ id: "p0", qty: 1 }] }, catalog), /invalid email/);
assert.throws(() => parseOrder({ name: "x", email: "a@b.c", items: [] }, catalog), /cart is empty/);
assert.throws(() => parseOrder({ name: "x", email: "a@b.c", items: [{ id: "nope", qty: 1 }] }, catalog), /unknown product/);
assert.throws(() => parseOrder({ name: "x", email: "a@b.c", items: [{ id: "p0", qty: 0 }] }, catalog), /invalid qty/);

console.log("ok");
