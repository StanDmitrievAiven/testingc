export function prepareQuery(sql) {
  const q = String(sql ?? "").trim();
  if (!q) throw new Error("sql is required");
  if (q.length > 20000) throw new Error("sql is too long");
  return q;
}

export const ROW_CAP = 500;
