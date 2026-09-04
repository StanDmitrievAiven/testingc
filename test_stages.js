import assert from "node:assert/strict";
import { isStage, parseAccount, STAGES } from "./src/stages.js";

assert.equal(STAGES.length, 6);
assert.equal(isStage("lead"), true);
assert.equal(isStage("nope"), false);

const created = parseAccount({ name: " Acme ", stage: "proposal", value: 12000 });
assert.equal(created.name, "Acme");
assert.equal(created.stage, "proposal");
assert.equal(created.value, 12000);

assert.throws(() => parseAccount({}), /name is required/);
assert.throws(() => parseAccount({ name: "x", stage: "nope" }), /invalid stage/);
assert.throws(() => parseAccount({ name: "x", value: -1 }), /invalid value/);

const patched = parseAccount({ stage: "won" }, { partial: true });
assert.deepEqual(patched, { stage: "won" });

console.log("ok");
