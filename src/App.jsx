import { useEffect, useMemo, useState } from "react";
import { isDue, STAGES, todayYmd } from "./stages.js";
import { Badge } from "./components/ui/badge.jsx";
import { Button } from "./components/ui/button.jsx";
import { Card } from "./components/ui/card.jsx";
import { Input, Label, Textarea } from "./components/ui/input.jsx";
import { cn } from "./lib/utils.js";

const empty = { name: "", company: "", email: "", phone: "", stage: "lead", value: 0, notes: "", next_action: "", follow_up_on: "" };
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

export default function App() {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);
  const [accounts, setAccounts] = useState([]);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");

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
      [a.name, a.company, a.email, a.notes, a.next_action].join(" ").toLowerCase().includes(q),
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

  async function moveStage(id, stage) {
    try {
      await api(`/api/accounts/${id}`, { method: "PATCH", body: JSON.stringify({ stage }) });
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (!ready) {
    return <div className="p-8 text-sm text-ink/60">Loading…</div>;
  }
  if (!user) return <Login onOk={setUser} />;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-ink/10 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center gap-4 px-6 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-rust">Desk</p>
            <h1 className="font-serif text-2xl leading-none">Pipeline</h1>
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
                <li key={account.id}>
                  <button
                    className="flex w-full items-baseline gap-3 py-2 text-left text-sm hover:text-rust"
                    onClick={() => setEditing(account)}
                  >
                    <span className="font-semibold">{account.name}</span>
                    <span className="truncate text-ink/60">{account.next_action || "Follow up"}</span>
                    <span className={cn("ml-auto shrink-0", account.follow_up_on < today ? "text-rust" : "text-ink/50")}>
                      {account.follow_up_on}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <div className="grid auto-cols-[minmax(240px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-6">
          {STAGES.map((stage) => {
            const rows = filtered.filter((a) => a.stage === stage.id);
            return (
              <section key={stage.id} className="min-w-[240px]">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold">{stage.label}</h2>
                  <span className="text-xs text-ink/50">{rows.length}</span>
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
                        onOpen={() => setEditing(account)}
                        onStage={(stage) => moveStage(account.id, stage)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </main>

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

function AccountCard({ account, today, onOpen, onStage }) {
  const due = isDue(account, today);
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
      </button>
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
  });
  const [busy, setBusy] = useState(false);
  const isNew = !account.id;
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="fixed inset-0 z-20 flex items-end justify-center bg-ink/40 p-4 sm:items-center" onClick={onClose}>
      <form
        className="w-full max-w-lg rounded-2xl bg-paper p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          onError("");
          try {
            const body = { ...form, value: Number(form.value || 0) };
            if (isNew) await api("/api/accounts", { method: "POST", body: JSON.stringify(body) });
            else await api(`/api/accounts/${account.id}`, { method: "PATCH", body: JSON.stringify(body) });
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
              <select
                id="stage"
                className={selectClass}
                value={form.stage}
                onChange={set("stage")}
              >
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
            <Label htmlFor="notes">Notes</Label>
            <Textarea id="notes" value={form.notes} onChange={set("notes")} />
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
