import assert from "node:assert/strict";
import { prepareQuery, ROW_CAP } from "./query.js";

assert.equal(prepareQuery("  select 1  "), "select 1");
assert.throws(() => prepareQuery("   "), /sql is required/);
assert.throws(() => prepareQuery("x".repeat(20001)), /sql is too long/);
assert.equal(ROW_CAP, 500);
console.log("ok");
