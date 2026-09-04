import assert from "node:assert/strict";
import { addDays, isDue, isStage, parseAccount, STAGES, accountsToCsv, csvToAccounts } from "./src/stages.js";

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
assert.deepEqual(patched, { stage: "won", lost_reason: "" });

assert.throws(() => parseAccount({ name: "x", stage: "lost" }), /lost_reason is required/);
assert.equal(parseAccount({ name: "x", stage: "lost", lost_reason: "timing" }).lost_reason, "timing");
assert.equal(parseAccount({ stage: "proposal", lost_reason: "timing" }, { partial: true }).lost_reason, "");

const csv = accountsToCsv([{ name: 'Acme, Inc', company: "", email: "", phone: "", stage: "lead", value: 3, next_action: "", follow_up_on: "", lost_reason: "" }]);
assert.ok(csv.includes('"Acme, Inc"'));
assert.equal(csvToAccounts(csv)[0].name, "Acme, Inc");
assert.equal(csvToAccounts(csv)[0].value, 3);

const follow = parseAccount({ name: "x", next_action: " ping ", follow_up_on: "2026-09-10" });
assert.equal(follow.next_action, "ping");
assert.equal(follow.follow_up_on, "2026-09-10");
assert.throws(() => parseAccount({ name: "x", follow_up_on: "soon" }), /invalid follow_up_on/);

assert.equal(isDue({ follow_up_on: "2026-01-01", stage: "lead" }, "2026-09-04"), true);
assert.equal(isDue({ follow_up_on: "2026-09-04", stage: "lead" }, "2026-09-04"), true);
assert.equal(isDue({ follow_up_on: "2026-09-05", stage: "lead" }, "2026-09-04"), false);
assert.equal(isDue({ follow_up_on: "2026-01-01", stage: "won" }, "2026-09-04"), false);
assert.equal(isDue({ follow_up_on: "" }, "2026-09-04"), false);

assert.equal(addDays("2026-09-04", 1), "2026-09-05");
assert.equal(addDays("2026-09-04", 7), "2026-09-11");
assert.equal(addDays("2026-01-31", 1), "2026-02-01");

console.log("ok");
