export const STAGES = [
  { id: "lead", label: "Lead" },
  { id: "qualified", label: "Qualified" },
  { id: "proposal", label: "Proposal" },
  { id: "negotiation", label: "Negotiation" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

export const STAGE_IDS = STAGES.map((s) => s.id);

export function isStage(value) {
  return STAGE_IDS.includes(value);
}

export function parseAccount(input, { partial = false } = {}) {
  if (input == null || typeof input !== "object") throw new Error("body required");
  const out = {};
  const str = (key, max) => {
    if (input[key] === undefined) return;
    if (typeof input[key] !== "string") throw new Error(`${key} must be a string`);
    const value = input[key].trim();
    if (value.length > max) throw new Error(`${key} is too long`);
    out[key] = value;
  };
  str("name", 200);
  str("company", 200);
  str("email", 320);
  str("phone", 50);
  str("notes", 5000);
  str("next_action", 200);
  if (!partial && !out.name) throw new Error("name is required");
  if (input.follow_up_on !== undefined) {
    if (input.follow_up_on === null || input.follow_up_on === "") out.follow_up_on = "";
    else {
      const day = String(input.follow_up_on).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("invalid follow_up_on");
      out.follow_up_on = day;
    }
  } else if (!partial) out.follow_up_on = "";
  if (input.stage !== undefined) {
    if (!isStage(input.stage)) throw new Error("invalid stage");
    out.stage = input.stage;
  } else if (!partial) out.stage = "lead";
  if (input.value !== undefined && input.value !== null && input.value !== "") {
    const n = Number(input.value);
    if (!Number.isInteger(n) || n < 0 || n > 1e12) throw new Error("invalid value");
    out.value = n;
  } else if (!partial) out.value = 0;
  return out;
}

export function todayYmd(now = new Date()) {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

export function isDue(account, today = todayYmd()) {
  if (!account?.follow_up_on) return false;
  if (account.stage === "won" || account.stage === "lost") return false;
  return account.follow_up_on <= today;
}
