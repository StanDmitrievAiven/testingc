export const STAGES = [
  { id: "lead", label: "Lead" },
  { id: "qualified", label: "Qualified" },
  { id: "proposal", label: "Proposal" },
  { id: "negotiation", label: "Negotiation" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
];

export const OPEN_STAGES = STAGES.filter((s) => s.id !== "won" && s.id !== "lost");
export const CLOSED_STAGES = STAGES.filter((s) => s.id === "won" || s.id === "lost");
export const CSV_COLS = ["name", "company", "email", "phone", "stage", "value", "next_action", "follow_up_on", "lost_reason"];

export const LOST_REASONS = [
  { id: "timing", label: "Timing" },
  { id: "budget", label: "Budget" },
  { id: "competitor", label: "Competitor" },
  { id: "no_reply", label: "No reply" },
  { id: "other", label: "Other" },
];

export const STAGE_IDS = STAGES.map((s) => s.id);
const LOST_IDS = LOST_REASONS.map((r) => r.id);

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
  if (input.lost_reason !== undefined) {
    if (input.lost_reason === null || input.lost_reason === "") out.lost_reason = "";
    else if (!LOST_IDS.includes(input.lost_reason)) throw new Error("invalid lost_reason");
    else out.lost_reason = input.lost_reason;
  } else if (!partial) out.lost_reason = "";
  if (out.stage && out.stage !== "lost") out.lost_reason = "";
  if (out.stage === "lost" && !out.lost_reason) throw new Error("lost_reason is required");
  return out;
}

export function todayYmd(now = new Date()) {
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${m}-${d}`;
}

export function addDays(ymd, days) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  if (!y || !m || !d) throw new Error("invalid date");
  return todayYmd(new Date(y, m - 1, d + Number(days)));
}

export function stageMoveNote(from, to) {
  if (!from || !to || from === to) return null;
  const label = (id) => STAGES.find((s) => s.id === id)?.label || id;
  return `Moved ${label(from)} → ${label(to)}`;
}

export function isDue(account, today = todayYmd()) {
  if (!account?.follow_up_on) return false;
  if (account.stage === "won" || account.stage === "lost") return false;
  return account.follow_up_on <= today;
}

export function csvLine(fields) {
  return fields
    .map((v) => {
      const s = String(v ?? "");
      return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
    })
    .join(",");
}

export function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function accountsToCsv(rows) {
  const header = csvLine(CSV_COLS);
  const body = rows.map((row) => csvLine(CSV_COLS.map((k) => (k === "value" ? Number(row[k] || 0) : row[k] || ""))));
  return [header, ...body].join("\n");
}

export function csvToAccounts(text) {
  const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => {
      if (CSV_COLS.includes(h)) row[h] = cells[i] ?? "";
    });
    if (row.value !== undefined && row.value !== "") row.value = Number(row.value);
    return parseAccount(row);
  });
}
