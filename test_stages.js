import assert from "node:assert/strict";
import { isDue, isStage, parseAccount, STAGES } from "./src/stages.js";

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

const follow = parseAccount({ name: "x", next_action: " ping ", follow_up_on: "2026-09-10" });
assert.equal(follow.next_action, "ping");
assert.equal(follow.follow_up_on, "2026-09-10");
assert.throws(() => parseAccount({ name: "x", follow_up_on: "soon" }), /invalid follow_up_on/);

assert.equal(isDue({ follow_up_on: "2026-01-01", stage: "lead" }, "2026-09-04"), true);
assert.equal(isDue({ follow_up_on: "2026-09-04", stage: "lead" }, "2026-09-04"), true);
assert.equal(isDue({ follow_up_on: "2026-09-05", stage: "lead" }, "2026-09-04"), false);
assert.equal(isDue({ follow_up_on: "2026-01-01", stage: "won" }, "2026-09-04"), false);
assert.equal(isDue({ follow_up_on: "" }, "2026-09-04"), false);

console.log("ok");
