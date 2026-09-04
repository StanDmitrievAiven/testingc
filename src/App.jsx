import { useEffect, useMemo, useRef, useState } from "react";
import {
  accountsToCsv,
  addDays,
  CLOSED_STAGES,
  csvToAccounts,
  isDue,
  isStale,
  LOST_REASONS,
  OPEN_STAGES,
  STAGES,
  todayYmd,
} from "./stages.js";
import { Badge } from "./components/ui/badge.jsx";
import { Button } from "./components/ui/button.jsx";
import { Card } from "./components/ui/card.jsx";
import { Input, Label, Textarea } from "./components/ui/input.jsx";
import { cn } from "./lib/utils.js";

const empty = {
  name: "",
  company: "",
  email: "",
  phone: "",
  stage: "lead",
  value: 0,
  next_action: "",
  follow_up_on: "",
  lost_reason: "",
};
const selectClass = "min-h-11 w-full rounded-md border border-ink/15 bg-white px-3 text-sm";

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function money(n) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);
}

function sumValue(rows) {
  return rows.reduce((n, a) => n + Number(a.value || 0), 0);
}

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [showClosed, setShowClosed] = useState(false);
  const [pendingLost, setPendingLost] = useState(null);
  const fileRef = useRef(null);

  async function load() {
    const rows = await api("/api/accounts");
    setAccounts(rows);
  }

  useEffect(() => {
    api("/api/me")
      .then((me) => setUser(me.user))
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (!user) return;
    load().catch((err) => setError(err.message));
  }, [user]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((a) =>
      [a.name, a.company, a.email, a.next_action, a.lost_reason].join(" ").toLowerCase().includes(q),
    );
  }, [accounts, query]);

  const today = todayYmd();
  const due = useMemo(
    () =>
      filtered
        .filter((a) => isDue(a, today))
        .sort((a, b) => a.follow_up_on.localeCompare(b.follow_up_on)),
    [filtered, today],
  );
  const stale = useMemo(
    () =>
      filtered
        .filter((a) => isStale(a, { today }))
        .sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at))),
    [filtered, today],
  );
  const openRows = filtered.filter((a) => a.stage !== "won" && a.stage !== "lost");
  const closedCount = filtered.filter((a) => a.stage === "won" || a.stage === "lost").length;
  const boardStages = OPEN_STAGES;

  async function patchAccount(id, body) {
    await api(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    await load();
  }

  async function snooze(id, days) {
    try {
      await patchAccount(id, { follow_up_on: addDays(today, days) });
    } catch (err) {
      setError(err.message);
    }
  }

  async function moveStage(id, stage) {
    if (stage === "lost") {
      setPendingLost(id);
      return;
    }
    try {
      await patchAccount(id, { stage });
    } catch (err) {
      setError(err.message);
    }
  }

  function exportCsv() {
    const blob = new Blob([accountsToCsv(accounts)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pipeline.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importCsv(file) {
    const text = await file.text();
    const rows = csvToAccounts(text);
    for (const row of rows) await api("/api/accounts", { method: "POST", body: JSON.stringify(row) });
    await load();
  }

  if (!ready) {
    return <div className="p-8 text-sm text-ink/60">Loading…</div>;
  }
  if (!user) return <Login onOk={setUser} />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-ink/10 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-3 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rust">Desk</p>
            <h1 className="font-serif text-2xl leading-none">Pipeline</h1>
            <p className="mt-1 text-sm text-ink/55">Open {money(sumValue(openRows))}</p>
          </div>
          <label className="sr-only" htmlFor="search">
            Search accounts
          </label>
          <Input
            id="search"
            className="ml-auto max-w-sm"
            placeholder="Search accounts"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Button variant="ghost" onClick={exportCsv}>
            Export CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                await importCsv(file);
              } catch (err) {
                setError(err.message);
              }
            }}
          />
          <Button variant="ghost" onClick={() => fileRef.current?.click()}>
            Import CSV
          </Button>
          <Button onClick={() => setEditing({ ...empty })}>Add account</Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await api("/api/logout", { method: "POST", body: "{}" });
              setUser(null);
            }}
          >
            Log out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-6 py-6">
        {error ? <p className="mb-4 text-sm text-red-700">{error}</p> : null}
        {due.length ? (
          <section className="mb-6 rounded-xl border border-rust/25 bg-white p-4">
            <h2 className="text-sm font-semibold text-rust">Due now · {due.length}</h2>
            <ul className="mt-2">
              {due.map((account) => (
                <li key={account.id} className="flex items-center gap-2 py-1">
                  <button
                    className="flex min-w-0 flex-1 items-baseline gap-3 py-2 text-left text-sm hover:text-rust"
                    onClick={() => setEditing(account)}
                  >
                    <span className="font-semibold">{account.name}</span>
                    <span className="truncate text-ink/60">{account.next_action || "Follow up"}</span>
                    <span className={cn("ml-auto shrink-0", account.follow_up_on < today ? "text-rust" : "text-ink/50")}>
                      {account.follow_up_on}
                    </span>
                  </button>
                  <Button type="button" variant="secondary" className="h-8 min-h-8 px-2 text-xs" onClick={() => snooze(account.id, 1)}>
                    +1d
                  </Button>
                  <Button type="button" variant="secondary" className="h-8 min-h-8 px-2 text-xs" onClick={() => snooze(account.id, 7)}>
                    +1w
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {stale.length ? (
          <section className="mb-6 rounded-xl border border-ink/15 bg-white p-4">
            <h2 className="text-sm font-semibold text-ink/70">Quiet for 14+ days · {stale.length}</h2>
            <ul className="mt-2">
              {stale.map((account) => (
                <li key={account.id}>
                  <button
                    className="flex w-full items-baseline gap-3 py-2 text-left text-sm hover:text-rust"
                    onClick={() => setEditing(account)}
                  >
                    <span className="font-semibold">{account.name}</span>
                    <span className="truncate text-ink/60">{account.company || account.next_action || "No recent activity"}</span>
                    <span className="ml-auto shrink-0 text-ink/50">{String(account.updated_at).slice(0, 10)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-6">
          {boardStages.map((stage) => {
            const rows = filtered.filter((a) => a.stage === stage.id);
            return (
              <StageColumn
                key={stage.id}
                stage={stage}
                rows={rows}
                today={today}
                onOpen={setEditing}
                onStage={moveStage}
              />
            );
          })}
        </div>
        {closedCount ? (
          <button
            className="text-sm font-medium text-ink/60 hover:text-ink"
            onClick={() => setShowClosed((v) => !v)}
          >
            {showClosed ? "Hide closed" : `Show closed · ${closedCount} · ${money(sumValue(filtered.filter((a) => a.stage === "won" || a.stage === "lost")))}`}
          </button>
        ) : null}
        {showClosed ? (
          <div className="mt-4 grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-6">
            {CLOSED_STAGES.map((stage) => {
              const rows = filtered.filter((a) => a.stage === stage.id);
              return (
                <StageColumn
                  key={stage.id}
                  stage={stage}
                  rows={rows}
                  today={today}
                  onOpen={setEditing}
                  onStage={moveStage}
                />
              );
            })}
          </div>
        ) : null}
      </main>

      {pendingLost ? (
        <LostPrompt
          onCancel={() => setPendingLost(null)}
          onPick={async (lost_reason) => {
            try {
              await patchAccount(pendingLost, { stage: "lost", lost_reason });
              setPendingLost(null);
            } catch (err) {
              setError(err.message);
            }
          }}
        />
      ) : null}

      {editing ? (
        <Editor
          account={editing}
          onClose={() => setEditing(null)}
          onError={setError}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function StageColumn({ stage, rows, today, onOpen, onStage }) {
  return (
    <section className="min-w-[240px]">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{stage.label}</h2>
        <span className="text-xs text-ink/50">
          {rows.length} · {money(sumValue(rows))}
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-ink/15 px-3 py-8 text-center text-sm text-ink/45">
            Nothing here yet
          </p>
        ) : (
          rows.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              today={today}
              onOpen={() => onOpen(account)}
              onStage={(next) => onStage(account.id, next)}
            />
          ))
        )}
      </div>
    </section>
  );
}

function AccountCard({ account, today, onOpen, onStage }) {
  const due = isDue(account, today);
  const quiet = isStale(account, { today });
  const reason = LOST_REASONS.find((r) => r.id === account.lost_reason);
  return (
    <Card className="p-4 transition hover:border-ink/30">
      <button className="w-full text-left" onClick={onOpen}>
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold leading-tight">{account.name}</p>
          <Badge stage={account.stage} />
        </div>
        <p className="mt-1 text-sm text-ink/60">{account.company || "—"}</p>
        <p className="mt-3 font-serif text-lg">{money(account.value)}</p>
        {account.next_action || account.follow_up_on ? (
          <p className={cn("mt-2 text-sm", due ? "text-rust" : "text-ink/55")}>
            {account.next_action || "Follow up"}
            {account.follow_up_on ? ` · ${account.follow_up_on}` : ""}
          </p>
        ) : null}
        {quiet ? <p className="mt-2 text-xs font-medium text-ink/45">Quiet 14+ days</p> : null}
        {account.stage === "lost" && reason ? <p className="mt-1 text-xs text-ink/50">Lost · {reason.label}</p> : null}
      </button>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {account.email ? (
          <a className="text-rust underline-offset-2 hover:underline" href={`mailto:${account.email}`} onClick={(e) => e.stopPropagation()}>
            {account.email}
          </a>
        ) : null}
        {account.phone ? (
          <a className="text-rust underline-offset-2 hover:underline" href={`tel:${account.phone}`} onClick={(e) => e.stopPropagation()}>
            {account.phone}
          </a>
        ) : null}
      </div>
      <label className="sr-only" htmlFor={`stage-${account.id}`}>
        Stage
      </label>
      <select
        id={`stage-${account.id}`}
        className={cn(selectClass, "mt-3 h-9 min-h-9")}
        value={account.stage}
        onChange={(e) => onStage(e.target.value)}
      >
        {STAGES.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </Card>
  );
}

function LostPrompt({ onPick, onCancel }) {
  const [reason, setReason] = useState("no_reply");
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-ink/40 p-4" onClick={onCancel}>
      <form
        className="w-full max-w-sm rounded-2xl bg-paper p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onPick(reason);
        }}
      >
        <h2 className="font-serif text-2xl">Lost reason</h2>
        <p className="mt-1 text-sm text-ink/60">Why did this fall through?</p>
        <label className="sr-only" htmlFor="lost-reason">
          Lost reason
        </label>
        <select id="lost-reason" className={cn(selectClass, "mt-4")} value={reason} onChange={(e) => setReason(e.target.value)}>
          {LOST_REASONS.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <div className="mt-6 flex gap-2">
          <Button type="button" variant="secondary" className="ml-auto" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit">Mark as lost</Button>
        </div>
      </form>
    </div>
  );
}

function Login({ onOk }) {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rust">Desk</p>
      <h1 className="mt-2 font-serif text-4xl">Sign in</h1>
      <p className="mt-2 text-sm text-ink/60">One-person CRM. Your pipeline, nothing else.</p>
      <form
        className="mt-8 space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          try {
            const me = await api("/api/login", { method: "POST", body: JSON.stringify({ user, password }) });
            onOk(me.user);
          } catch (err) {
            setError(err.message);
          }
        }}
      >
        <div>
          <Label htmlFor="user">Username</Label>
          <Input id="user" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
        <Button type="submit" className="w-full">
          Sign in
        </Button>
      </form>
    </div>
  );
}

function Editor({ account, onClose, onSaved, onError }) {
  const [form, setForm] = useState({
    ...empty,
    ...account,
    next_action: account.next_action || "",
    follow_up_on: (account.follow_up_on || "").slice(0, 10),
    lost_reason: account.lost_reason || "",
  });
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [note, setNote] = useState("");
  const isNew = !account.id;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    if (!account.id) return;
    api(`/api/accounts/${account.id}/notes`).then(setLog).catch((err) => onError(err.message));
  }, [account.id]);

  async function addNote() {
    const body = note.trim();
    if (!body) return;
    const row = await api(`/api/accounts/${account.id}/notes`, { method: "POST", body: JSON.stringify({ body }) });
    setLog((rows) => [...rows, row]);
    setNote("");
  }

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={onClose}>
      <form
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-paper p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          onError("");
          try {
            const body = { ...form, value: Number(form.value || 0) };
            if (isNew) {
              const created = await api("/api/accounts", { method: "POST", body: JSON.stringify(body) });
              if (note.trim()) {
                await api(`/api/accounts/${created.id}/notes`, { method: "POST", body: JSON.stringify({ body: note.trim() }) });
              }
            } else await api(`/api/accounts/${account.id}`, { method: "PATCH", body: JSON.stringify(body) });
            await onSaved();
          } catch (err) {
            onError(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 className="font-serif text-2xl">{isNew ? "New account" : "Edit account"}</h2>
        <div className="mt-5 grid gap-4">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" required value={form.name} onChange={set("name")} />
          </div>
          <div>
            <Label htmlFor="company">Company</Label>
            <Input id="company" value={form.company} onChange={set("company")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={set("email")} />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone} onChange={set("phone")} />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="stage">Stage</Label>
              <select id="stage" className={selectClass} value={form.stage} onChange={set("stage")}>
                {STAGES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="value">Value (USD)</Label>
              <Input id="value" type="number" min="0" step="1" value={form.value} onChange={set("value")} />
            </div>
          </div>
          {form.stage === "lost" ? (
            <div>
              <Label htmlFor="lost_reason">Lost reason</Label>
              <select id="lost_reason" className={selectClass} required value={form.lost_reason} onChange={set("lost_reason")}>
                <option value="">Select a reason</option>
                {LOST_REASONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="next_action">Next action</Label>
              <Input id="next_action" placeholder="Call, send proposal…" value={form.next_action} onChange={set("next_action")} />
            </div>
            <div>
              <Label htmlFor="follow_up_on">Follow up on</Label>
              <Input id="follow_up_on" type="date" value={form.follow_up_on} onChange={set("follow_up_on")} />
            </div>
          </div>
          <div>
            <Label htmlFor="note">Notes</Label>
            {!isNew && log.length ? (
              <ol className="mb-3 space-y-2">
                {log.map((row) => (
                  <li key={row.id} className="rounded-md bg-white px-3 py-2 text-sm">
                    <p>{row.body}</p>
                    <p className="mt-1 text-xs text-ink/45">{new Date(row.created_at).toLocaleString()}</p>
                  </li>
                ))}
              </ol>
            ) : null}
            <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" />
            {!isNew ? (
              <Button type="button" variant="secondary" className="mt-2" onClick={addNote}>
                Add note
              </Button>
            ) : null}
          </div>
        </div>
        <div className="mt-6 flex items-center gap-2">
          {!isNew ? (
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (!confirm("Delete this account?")) return;
                setBusy(true);
                try {
                  await api(`/api/accounts/${account.id}`, { method: "DELETE" });
                  await onSaved();
                } catch (err) {
                  onError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Delete
            </Button>
          ) : null}
          <Button type="button" variant="secondary" className="ml-auto" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {isNew ? "Create account" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
