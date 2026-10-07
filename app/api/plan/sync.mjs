// app/core.mjs
var SCHEMA = 2;
var clone = (value) => structuredClone(value);
var fail = (message) => {
  throw new Error(message);
};
var object = (v) => v && typeof v === "object" && !Array.isArray(v);
var own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
var sameJsonValue = (a, b) => a === b || (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => sameJsonValue(v, b[i])) : object(a) && object(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every((k) => own(b, k) && sameJsonValue(a[k], b[k])));
function money(value) {
  const text = String(value).trim();
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) fail("Enter an amount with no more than two decimal places.");
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^-/, "").split(".");
  const n = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(n) || n > 1e14) fail("Amount is too large.");
  return negative ? -n : n;
}
function validMoney(n, label = "Amount", signed = false) {
  if (!Number.isSafeInteger(n) || Math.abs(n) > 1e14 || !signed && n < 0) fail(`${label} is invalid.`);
  return n;
}
function dateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail("Use a date in YYYY-MM-DD format.");
  const [y, m, d] = value.split("-").map(Number);
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()) fail("Date does not exist.");
  return value;
}
function dayAt(year, month, day) {
  const end = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(Math.min(day, end)).padStart(2, "0")}`;
}
function addMonths(key, n) {
  const [y, m] = key.split("-").map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function periodKey(date, start = 15) {
  dateKey(date);
  const [y, m, d] = date.split("-").map(Number);
  return d < Math.min(start, new Date(Date.UTC(y, m, 0)).getUTCDate()) ? addMonths(`${y}-${String(m).padStart(2, "0")}`, -1) : date.slice(0, 7);
}
function periodDates(key, start = 15) {
  const [y, m] = key.split("-").map(Number), [ny, nm] = addMonths(key, 1).split("-").map(Number);
  const from = dayAt(y, m - 1, start), next = dayAt(ny, nm - 1, start);
  const end = /* @__PURE__ */ new Date(`${next}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return { from, to: end.toISOString().slice(0, 10), next };
}
function workspacePeriod(s, date) {
  dateKey(date);
  const change = s.cycleHistory.filter((c) => c.status !== "cancelled" && c.effective <= date).sort((a, b) => a.effective.localeCompare(b.effective)).at(-1);
  if (!change) return periodKey(date, s.cycleStart);
  const key = periodKey(date, change.start);
  return key < change.effective.slice(0, 7) ? change.effective.slice(0, 7) : key;
}
function workspacePeriodDates(s, key) {
  dateKey(key + "-01");
  const changes = s.cycleHistory.filter((c) => c.status !== "cancelled").slice().sort((a, b) => a.effective.localeCompare(b.effective));
  const current = changes.filter((c) => c.effective.slice(0, 7) <= key).at(-1);
  const dates = periodDates(key, current?.start ?? s.cycleStart);
  if (current?.effective.slice(0, 7) === key) dates.from = current.effective;
  const following = changes.find((c) => c.effective.slice(0, 7) > key);
  if (following && following.effective < dates.next) dates.next = following.effective;
  const end = /* @__PURE__ */ new Date(`${dates.next}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  dates.to = end.toISOString().slice(0, 10);
  dates.transition = !!current && current.effective.slice(0, 7) === key;
  return dates;
}
function today(timezone = "Asia/Shanghai") {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(/* @__PURE__ */ new Date());
  const pick = (t) => parts.find((p) => p.type === t).value;
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}
var uid = () => globalThis.crypto.randomUUID();
function fresh() {
  return {
    schema: SCHEMA,
    id: uid(),
    version: 0,
    seq: 0,
    currency: "CNY",
    timezone: "Asia/Shanghai",
    cycleStart: 15,
    name: "",
    accounts: [],
    transactions: [],
    reconciliations: [],
    categories: [],
    budgets: [],
    goals: [],
    reservations: {},
    obligations: [],
    outside: [],
    notes: [],
    holdings: [],
    operations: [],
    imports: [],
    legacy: null,
    settings: { reserve: 0, monthlyProtection: 0, forecastPeriods: 12 },
    cycleHistory: []
  };
}
function cleanJson(value, depth = 0) {
  if (depth > 40) fail("Backup nesting is too deep.");
  if (typeof value === "number" && !Number.isFinite(value)) fail("Backup contains an invalid number.");
  if (value && typeof value === "object") for (const key of Object.keys(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) fail("Backup contains unsafe object keys.");
    cleanJson(value[key], depth + 1);
  }
}
function string(v, label, max = 1e4) {
  if (typeof v !== "string" || v.length > max) fail(`${label} is invalid.`);
}
function unique(list, label) {
  const ids = /* @__PURE__ */ new Set();
  for (const item of list) {
    if (!object(item) || !["string", "number"].includes(typeof item.id)) fail(`${label} record is invalid.`);
    const key = String(item.id);
    if (ids.has(key)) fail(`${label} contains duplicate IDs.`);
    ids.add(key);
  }
}
function readLegacy(raw) {
  if (typeof raw !== "string" || raw.length > 5e6) fail("Backup is empty or larger than 5 MB.");
  let wrapped;
  try {
    wrapped = JSON.parse(raw);
  } catch {
    fail("This is not valid JSON.");
  }
  cleanJson(wrapped);
  if (!object(wrapped)) fail("Backup must be an object.");
  let data = wrapped;
  if (own(wrapped, "app") || own(wrapped, "schema")) {
    if (wrapped.app !== "plan" || wrapped.schema !== 1 || !object(wrapped.data)) fail("This is not a supported PLAN backup.");
    data = wrapped.data;
  }
  if (!object(data.months) || !Array.isArray(data.goals) || !Array.isArray(data.plan)) fail("Backup has missing months, goals or categories.");
  if (!Number.isInteger(data.cycleStart || 15) || (data.cycleStart || 15) < 1 || (data.cycleStart || 15) > 31) fail("Financial start day is invalid.");
  unique(data.goals, "Goals");
  unique(data.plan, "Categories");
  for (const g of data.goals) {
    string(g.name, "Goal name", 300);
    validMoney(money(g.target), "Goal target");
    if (!Number.isFinite(g.pct) || g.pct < 0 || g.pct > 100) fail("Goal percentage is invalid.");
  }
  const catIds = new Set(data.plan.map((c) => String(c.id)));
  for (const c of data.plan) {
    string(c.name, "Category name", 300);
    if (!["fixed", "variable", "savings", "buffer"].includes(c.type)) fail("Category type is invalid.");
  }
  const expenseIds = /* @__PURE__ */ new Set();
  for (const [key, m] of Object.entries(data.months)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key) || !object(m) || !object(m.alloc) || !object(m.locks) || !Array.isArray(m.spend) || !Array.isArray(m.changes) || !object(m.split)) fail(`Invalid monthly plan: ${key}.`);
    dateKey(key + "-01");
    validMoney(money(m.salary), "Salary");
    for (const [id, v] of Object.entries(m.alloc)) {
      if (!catIds.has(id)) fail("Budget refers to a missing category.");
      validMoney(money(v), "Budget");
    }
    if (m.override !== null && m.override !== void 0) validMoney(money(m.override), "Savings override", true);
    let pct = 0;
    for (const v of Object.values(m.split)) {
      if (!Number.isFinite(v) || v < 0 || v > 100) fail("Invalid historical goal split.");
      pct += v;
    }
    if (pct > 100.00001) fail("Historical goal split exceeds 100%.");
    for (const e of m.spend) {
      if (!object(e) || !Number.isFinite(e.ts) || !["string", "number"].includes(typeof e.id)) fail("Expense has invalid identity or timestamp.");
      if (expenseIds.has(String(e.id))) fail("Duplicate expense ID.");
      expenseIds.add(String(e.id));
      validMoney(money(e.amount), "Expense");
      string(e.note || "", "Expense note");
      if (!catIds.has(e.cat) && !["oneoff", "buffer"].includes(e.cat)) fail("Expense has a missing category.");
      dateKey(new Date(e.ts).toISOString().slice(0, 10));
    }
    for (const c of m.changes) {
      if (!object(c) || !Number.isFinite(c.ts)) fail("Invalid budget change.");
      validMoney(money(c.from), "Change");
      validMoney(money(c.to), "Change");
    }
  }
  if (data.card) {
    validMoney(money(data.card.used), "Card balance");
    validMoney(money(data.card.limit), "Card limit");
    if (!Number.isInteger(data.card.payDay) || data.card.payDay < 1 || data.card.payDay > 31) fail("Card payment day is invalid.");
  }
  for (const kind of ["given", "borrowed"]) {
    const list = data.outside?.[kind] || [];
    if (!Array.isArray(list)) fail("Outside records are invalid.");
    unique(list, "Outside");
    for (const r of list) {
      dateKey(r.on);
      validMoney(money(r.amount), "Outside amount");
      string(r.person || "", "Person", 300);
      if (r.backOn) dateKey(r.backOn);
      if (r.repaidOn) dateKey(r.repaidOn);
      if (r.back != null) validMoney(money(r.back), "Return");
    }
  }
  if (data.notes && !Array.isArray(data.notes)) fail("Notes are invalid.");
  return { wrapped, data };
}
async function digest(raw) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return [...new Uint8Array(b)].map((v) => v.toString(16).padStart(2, "0")).join("");
}
function validateState(s) {
  cleanJson(s);
  if (!object(s) || s.schema !== SCHEMA || typeof s.id !== "string" || !s.id || !Number.isSafeInteger(s.version) || s.version < 0 || !Number.isSafeInteger(s.seq) || s.seq < 0) fail("Unsupported state version.");
  if (!["CNY", "USD", "EUR", "MAD", "GBP"].includes(s.currency)) fail("Unsupported currency.");
  try {
    new Intl.DateTimeFormat("en", { timeZone: s.timezone });
  } catch {
    fail("Invalid timezone.");
  }
  if (!Number.isInteger(s.cycleStart) || s.cycleStart < 1 || s.cycleStart > 31) fail("Invalid financial start day.");
  for (const key of ["accounts", "transactions", "reconciliations", "categories", "budgets", "goals", "obligations", "outside", "notes", "holdings", "operations", "imports", "cycleHistory"]) if (!Array.isArray(s[key])) fail(`Missing ${key}.`);
  if (!object(s.reservations) || !object(s.settings)) fail("Settings or reservations are missing.");
  for (const key of ["accounts", "transactions", "categories", "budgets", "goals", "outside", "notes", "holdings", "operations"]) unique(s[key], key);
  unique(s.obligations, "obligations");
  unique(s.imports, "imports");
  unique(s.cycleHistory, "cycle history");
  const cyclePrefix = { ...s, cycleHistory: [] };
  for (const c of s.cycleHistory.slice().sort((a, b) => String(a.effective).localeCompare(String(b.effective)))) {
    dateKey(c.effective);
    if (!Number.isInteger(c.start) || c.start < 1 || c.start > 31 || !["scheduled", "active", "cancelled"].includes(c.status)) fail("Invalid cycle change.");
    if (c.status === "cancelled") continue;
    const prior = /* @__PURE__ */ new Date(`${c.effective}T12:00:00Z`);
    prior.setUTCDate(prior.getUTCDate() - 1);
    const date = prior.toISOString().slice(0, 10);
    if (cyclePrefix.cycleHistory.some((p) => p.effective.slice(0, 7) === c.effective.slice(0, 7)) || workspacePeriodDates(cyclePrefix, workspacePeriod(cyclePrefix, date)).next !== c.effective) fail("Cycle change must preserve existing period boundaries.");
    cyclePrefix.cycleHistory.push(c);
  }
  const accounts = new Set(s.accounts.map((a) => a.id)), categories = new Set(s.categories.map((c) => c.id)), goals = new Set(s.goals.map((g) => g.id));
  for (const a of s.accounts) {
    string(a.name, "Account name", 300);
    if (!["asset", "liability"].includes(a.kind) || a.currency !== s.currency) fail("Account type/currency is invalid.");
    if (a.opening !== null) validMoney(a.opening, "Opening balance", true);
    dateKey(a.baselineDate);
    if (!Number.isSafeInteger(a.baselineSeq) || a.baselineSeq < 0 || a.baselineSeq > s.seq) fail("Account baseline is invalid.");
  }
  const transactionIds = new Set(s.transactions.map((t) => t.id));
  for (const t of s.transactions) {
    string(t.note || "", "Transaction note");
    dateKey(t.date);
    validMoney(t.amount, "Transaction amount");
    if (!Array.isArray(t.postings)) fail("Missing postings.");
    if (!Number.isSafeInteger(t.seq) || t.seq < 0 || t.seq > s.seq) fail("Invalid transaction sequence.");
    if (t.category && !categories.has(t.category)) fail("Missing transaction category.");
    if (t.splits) {
      if (!Array.isArray(t.splits) || t.splits.length < 2 || !["expense", "refund"].includes(t.kind)) fail("Invalid split transaction.");
      let total = 0;
      for (const part of t.splits) {
        if (!categories.has(part.category)) fail("Split refers to a missing category.");
        validMoney(part.amount, "Split amount");
        if (part.amount <= 0) fail("Split amounts must be positive.");
        total += part.amount;
      }
      if (total !== t.amount) fail("Split amounts must equal the transaction total.");
    }
    for (const p of t.postings) {
      if (!accounts.has(p.account)) fail("Missing posting account.");
      validMoney(p.amount, "Posting amount", true);
    }
    if (!["expense", "income", "refund", "transfer", "repayment", "borrow", "loan-out", "loan-return", "reversal"].includes(t.kind)) fail("Invalid transaction type.");
    if (t.historical) {
      if (t.postings.length || t.seq !== 0) fail("Imported historical entries must not post to current balances.");
    } else if (t.kind === "reversal") {
      if (!transactionIds.has(t.reverses)) fail("Correction refers to a missing transaction.");
      const original = s.transactions.find((x) => x.id === t.reverses);
      if (original.historical || original.kind === "reversal" || t.seq <= original.seq || t.postings.length !== original.postings.length || t.amount !== original.amount || t.postings.some((p, i) => p.account !== original.postings[i].account || p.amount !== -original.postings[i].amount)) fail("Correction postings are invalid.");
    } else {
      if (t.amount <= 0 || t.seq === 0) fail("Actual transactions require a positive amount and sequence.");
      const paired = ["transfer", "repayment", "borrow"].includes(t.kind), positive = ["income", "refund", "loan-return"].includes(t.kind);
      if (t.postings.length !== (paired ? 2 : 1) || t.postings[0].account !== t.account || t.postings[0].amount !== (positive ? t.amount : -t.amount)) fail("Transaction postings do not match its amount.");
      if (paired && (t.account === t.toAccount || t.postings[1].account !== t.toAccount || t.postings[1].amount !== t.amount)) fail("Transfer postings are invalid.");
      const a = s.accounts.find((a2) => a2.id === t.account), to = s.accounts.find((a2) => a2.id === t.toAccount);
      if (t.kind === "income" && a?.kind !== "asset" || t.kind === "transfer" && (a?.kind !== "asset" || to?.kind !== "asset") || t.kind === "repayment" && (a?.kind !== "asset" || to?.kind !== "liability") || t.kind === "borrow" && (a?.kind !== "liability" || to?.kind !== "asset")) fail("Transaction account types do not match its purpose.");
    }
  }
  const reversals = s.transactions.filter((t) => t.reverses).map((t) => t.reverses);
  if (new Set(reversals).size !== reversals.length) fail("A transaction has been reversed more than once.");
  for (const batch of s.imports) if (batch.type === "csv") {
    if (!Array.isArray(batch.transactionIds) || !batch.transactionIds.length || new Set(batch.transactionIds).size !== batch.transactionIds.length || typeof batch.undone !== "boolean") fail("Invalid CSV import history.");
    for (const id of batch.transactionIds) {
      const t = s.transactions.find((t2) => t2.id === id);
      if (!t || t.source !== "csv" || t.historical || batch.undone && !reversals.includes(id)) fail("CSV import history does not match its transactions.");
    }
  }
  for (const b of s.budgets) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(b.key) || !object(b.alloc) || !object(b.locks)) fail("Invalid budget.");
    validMoney(b.salary, "Salary");
    for (const [id, n] of Object.entries(b.alloc)) {
      if (!categories.has(id)) fail("Missing budget category.");
      validMoney(n, "Budget allocation");
    }
  }
  for (const g of s.goals) {
    string(g.name, "Goal name", 300);
    validMoney(g.target, "Goal target");
    if (g.desired) dateKey(g.desired);
    if (!Number.isInteger(g.priority) || g.priority < 1 || g.priority > 1e3) fail("Invalid goal priority.");
    if (g.recurringCost != null) validMoney(g.recurringCost, "Ongoing cost");
    if (g.unitPrice != null) validMoney(g.unitPrice, "Price quote");
    if (g.fees != null) validMoney(g.fees, "Fees");
    if (g.quantity != null && (!Number.isFinite(g.quantity) || g.quantity <= 0)) fail("Quantity must be positive.");
    if (g.quoteDate) dateKey(g.quoteDate);
  }
  for (const g of s.goals) {
    if (g.flexible === false && !g.desired) fail("A hard deadline needs a date.");
    if (g.purchases && !Array.isArray(g.purchases)) fail("Invalid purchase history.");
    const purchases = g.purchases || [g.purchase].filter(Boolean), seen = /* @__PURE__ */ new Set();
    if (g.purchases && g.purchase && (!purchases.length || ["transaction", "amount", "date", "complete", "quantity", "releasedReservation", "reversedBy"].some((key) => g.purchase[key] !== purchases.at(-1)[key]))) fail("Latest purchase does not match its retained history.");
    for (const p of purchases) {
      const t = s.transactions.find((t2) => t2.id === p.transaction);
      validMoney(p.amount, "Purchase cost");
      dateKey(p.date);
      if (!t || t.historical || t.source !== "goal" || t.goal !== g.id || t.kind !== "expense" || t.amount !== p.amount || t.date !== p.date || seen.has(p.transaction)) fail("Purchase history does not match the ledger.");
      seen.add(p.transaction);
      if (p.complete != null && typeof p.complete !== "boolean") fail("Invalid purchase completion flag.");
      if ((p.reversedBy || null) !== (s.transactions.find((t2) => t2.reverses === p.transaction)?.id || null)) fail("Invalid purchase correction.");
    }
  }
  for (const [id, n] of Object.entries(s.reservations)) {
    if (!goals.has(id)) fail("Missing reservation goal.");
    validMoney(n, "Goal reservation");
  }
  unique(s.reconciliations, "reconciliations");
  for (const r of s.reconciliations) {
    if (!accounts.has(r.account)) fail("Missing reconciliation account.");
    dateKey(r.date);
    validMoney(r.balance, "Balance", true);
    if (r.difference !== null) validMoney(r.difference, "Difference", true);
    if (!["matched", "unresolved", "reviewed"].includes(r.status)) fail("Invalid balance-check status.");
    if (r.status === "reviewed") {
      string(r.review?.note, "Balance review explanation");
      if (!r.review.note.trim() || !Array.isArray(r.review.transactions) || r.review.transactions.some((id) => !transactionIds.has(id))) fail("Invalid balance review evidence.");
    }
  }
  for (const o of s.outside) {
    validMoney(o.amount, "Outside amount");
    dateKey(o.date);
    if (o.returned != null) validMoney(o.returned, "Returned amount");
    if ((o.returned || 0) > o.amount) fail("Returned amount exceeds the original record.");
    if (!["unclassified", "gift", "loan", "investment", "borrowed"].includes(o.kind)) fail("Invalid outside classification.");
  }
  for (const o of s.outside) {
    if (o.transaction) {
      const t = s.transactions.find((t2) => t2.id === o.transaction);
      if (!t || t.historical || t.source !== "outside" || t.outside !== o.id || t.amount !== o.amount || t.date !== o.date || t.account !== o.account || t.kind !== (o.kind === "gift" ? "expense" : "loan-out")) fail("Outside payment does not match its cash entry.");
      if ((o.reversedBy || null) !== (s.transactions.find((t2) => t2.reverses === o.transaction)?.id || null)) fail("Invalid outside payment correction.");
    }
    if (o.returns) {
      if (!Array.isArray(o.returns)) fail("Invalid return history.");
      unique(o.returns, "returns");
      let total = 0;
      for (const r of o.returns) {
        const t = s.transactions.find((t2) => t2.id === r.transaction);
        if (!t || t.historical || t.source !== "outside" || t.outside !== o.id || t.kind !== "loan-return" || t.amount !== r.amount || t.date !== r.date) fail("Outside return does not match its cash entry.");
        if ((r.reversedBy || null) !== (s.transactions.find((t2) => t2.reverses === r.transaction)?.id || null)) fail("Invalid outside return correction.");
        if (!r.reversedBy) total += r.amount;
      }
      if (o.transaction && total !== (o.returned || 0)) fail("Outstanding outside balance does not match its returns.");
    }
  }
  for (const o of s.obligations) {
    string(o.name, "Event name", 300);
    dateKey(o.date);
    validMoney(o.amount, "Scheduled amount", true);
    if (!["bill", "income"].includes(o.kind) || !accounts.has(o.account) || o.debtAccount && !accounts.has(o.debtAccount)) fail("Invalid scheduled event.");
    if (o.kind === "income" && o.amount >= 0 || o.kind === "bill" && o.amount <= 0) fail("Scheduled event sign does not match its type.");
    if (o.budgetCategory && (o.kind !== "bill" || o.debtAccount || !s.categories.some((c) => c.id === o.budgetCategory && c.id !== "oneoff" && !["savings", "buffer"].includes(c.type)))) fail("Choose a spending budget category only for an ordinary bill.");
    if (o.recurrence) {
      if (!["monthly", "weekly"].includes(o.recurrence.unit) || !Number.isInteger(o.recurrence.interval) || o.recurrence.interval < 1 || o.recurrence.interval > 12) fail("Invalid repeat schedule.");
      if (o.recurrence.until) {
        dateKey(o.recurrence.until);
        if (o.recurrence.until < o.date) fail("Repeat end precedes its start.");
      }
    }
    if (o.cancelAfter) dateKey(o.cancelAfter);
    if (o.skipped && (o.paid || typeof o.skipReason !== "string" || !o.skipReason.trim())) fail("Cancelled occurrences need an explanation and cannot be paid.");
    if (o.transaction && !transactionIds.has(o.transaction)) fail("Scheduled payment refers to a missing transaction.");
  }
  for (const h of s.holdings) {
    validMoney(h.cost, "Holding cost");
    dateKey(h.date);
    if (h.quantity != null && (!Number.isFinite(h.quantity) || h.quantity <= 0)) fail("Invalid holding quantity.");
    if (h.goal || h.transaction) {
      const g = s.goals.find((g2) => g2.id === h.goal), t = s.transactions.find((t2) => t2.id === h.transaction), p = (g?.purchases || [g?.purchase].filter(Boolean)).find((p2) => p2.transaction === h.transaction);
      if (!g || g.kind !== "gold" || !p || !t || t.goal !== g.id || t.amount !== h.cost || t.date !== h.date || (h.reversedBy || null) !== (p.reversedBy || null) || p.quantity != null && h.quantity !== p.quantity) fail("Gold holding does not match its exact purchase history.");
    }
  }
  const paidEntries = /* @__PURE__ */ new Set();
  for (const event of s.obligations) if (event.paid || event.transaction) {
    const t = s.transactions.find((t2) => t2.id === event.transaction), kind = event.kind === "income" ? "income" : event.debtAccount ? "repayment" : "expense";
    if (!event.paid || !event.transaction || !event.paidDate) fail("Paid schedule needs its exact cash entry.");
    dateKey(event.paidDate);
    if (!t || t.historical || t.source !== "scheduled" || t.kind !== kind || t.amount !== Math.abs(event.amount) || t.account !== event.account || (t.toAccount || "") !== (event.debtAccount || "") || t.date !== event.paidDate || t.date < event.date || t.category !== (event.budgetCategory || "oneoff") || reversals.includes(t.id) || paidEntries.has(t.id)) fail("Scheduled payment does not match its exact cash entry.");
    paidEntries.add(t.id);
  }
  for (const c of s.categories) {
    string(c.name, "Category name", 300);
    if (!["fixed", "variable", "savings", "buffer"].includes(c.type)) fail("Invalid category type.");
  }
  for (const n of s.notes) {
    string(n.title || "", "Note title");
    string(n.body || "", "Note body", 5e4);
    if (n.items && !Array.isArray(n.items)) fail("Invalid checklist.");
  }
  for (const key of ["reserve", "monthlyProtection"]) validMoney(s.settings[key], "Reserve");
  if (s.legacy?.raw) {
    readLegacy(JSON.stringify(s.legacy.raw));
    if (s.legacy.rawText && !sameJsonValue(JSON.parse(s.legacy.rawText), s.legacy.raw)) fail("Preserved original backup differs from its records.");
  }
  return s;
}
function accountBalance(s, id, asOf = today(s.timezone)) {
  const a = s.accounts.find((a2) => a2.id === id);
  if (!a) fail("Account does not exist.");
  if (a.opening === null || asOf < a.baselineDate) return null;
  let result = a.opening;
  for (const t of s.transactions) if (t.seq > a.baselineSeq && t.date >= a.baselineDate && t.date <= asOf) {
    if (t.kind === "reversal" && s.transactions.find((x) => x.id === t.reverses)?.seq <= a.baselineSeq) continue;
    for (const p of t.postings) if (p.account === id) result += p.amount;
  }
  validMoney(result, "Calculated balance", true);
  return result;
}
function summary(s, asOf = today(s.timezone)) {
  const asset = s.accounts.filter((a) => a.kind === "asset"), missing = asset.some((a) => accountBalance(s, a.id, asOf) === null);
  const cash = asset.reduce((n, a) => n + (accountBalance(s, a.id, asOf) ?? 0), 0);
  const liabilities = s.accounts.filter((a) => a.kind === "liability"), debtMissing = liabilities.some((a) => accountBalance(s, a.id, asOf) === null), debtVerified = liabilities.every((a) => a.verified === true);
  const debt = liabilities.reduce((n, a) => n + Math.max(0, -(accountBalance(s, a.id, asOf) ?? 0)), 0);
  const reserved = Object.values(s.reservations).reduce((a, b) => a + b, 0);
  const protectedAmount = Math.max(s.settings.reserve, s.goals.filter((g) => g.protected && !g.archived).reduce((n, g) => n + (s.reservations[g.id] || 0), 0));
  const extraReserve = Math.max(0, s.settings.reserve - s.goals.filter((g) => g.protected && !g.archived).reduce((n, g) => n + (s.reservations[g.id] || 0), 0));
  return { cash: missing ? null : cash, knownCash: cash, debt: debtMissing ? null : debt, knownDebt: debt, debtMissing, debtVerified, reserved, protected: protectedAmount, available: missing ? null : cash - reserved - extraReserve, missing };
}
function addCategory(s, { name, type = "variable" }) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 300) fail("Enter a category name of at most 300 characters.");
  if (!["fixed", "variable"].includes(type)) fail("Choose a fixed or flexible spending category.");
  return mutate(s, "category-add", { name: name.trim(), type }, (n) => n.categories.push({ id: uid(), name: name.trim(), type, archived: false }));
}
function toggleCategoryArchive(s, id) {
  const category = s.categories.find((c) => c.id === id);
  if (!category || ["oneoff", "savings", "buffer"].includes(id) || !["fixed", "variable"].includes(category.type)) fail("Keep built-in and saving categories available.");
  return mutate(s, "category-archive", { id }, (n) => {
    const c = n.categories.find((c2) => c2.id === id);
    c.archived = !c.archived;
  });
}
function goalPurchases(g) {
  return (g.purchases || [g.purchase].filter(Boolean)).filter((p) => !p.reversedBy);
}
function addSchedule(s, { name, kind, amount, date, account, debtAccount = "", budgetCategory = "", recurrence = null }) {
  validateScheduleDetails(s, { name, kind, amount, date, account, debtAccount, budgetCategory });
  return mutate(s, "obligation-add", { name, kind, amount, date, account, debtAccount, budgetCategory, recurrence }, (n) => n.obligations.push({ id: uid(), name: name.trim(), kind, amount: kind === "income" ? -amount : amount, date, account, debtAccount, budgetCategory, paid: false, ...recurrence ? { recurrence: clone(recurrence) } : {} }));
}
function validateScheduleDetails(s, { name, kind, amount, date, account, debtAccount, budgetCategory }) {
  string(name, "Event name", 300);
  dateKey(date);
  validMoney(amount, "Expected amount");
  if (!name.trim() || amount <= 0 || !["bill", "income"].includes(kind)) fail("Enter a name, positive amount and expected event type.");
  if (s.accounts.find((a) => a.id === account)?.kind !== "asset") fail("Choose the cash account for this event.");
  if (kind === "income" && (debtAccount || budgetCategory)) fail("Expected income cannot be a debt payment or spending category.");
  if (debtAccount && (s.accounts.find((a) => a.id === debtAccount)?.kind !== "liability" || budgetCategory)) fail("Choose a debt account without a spending budget category.");
}
function scheduledEvents(s, { from = today(s.timezone), to = from, includeOverdue = false } = {}) {
  dateKey(from);
  dateKey(to);
  if (to < from) fail("Schedule end precedes its start.");
  const rows = [], stored = new Map(s.obligations.map((o) => [o.id, o]));
  for (const o of s.obligations.filter((o2) => !o2.templateId && !o2.archived)) {
    let date = o.date, index = 0;
    while (date <= to) {
      if (o.cancelAfter && date >= o.cancelAfter) break;
      const id = index ? `${o.id}@${date}` : o.id, existing = stored.get(id), occurrence = existing || { ...clone(o), id, date, templateId: o.id, paid: false, skipped: false };
      if (!existing) for (const field of ["transaction", "paidDate", "reversedBy", "skipReason"]) delete occurrence[field];
      if (date >= from || includeOverdue && !occurrence.paid && !occurrence.skipped) rows.push(occurrence);
      if (!o.recurrence) break;
      index++;
      if (index > 2e4) fail("Repeat schedule is too long.");
      if (o.recurrence.unit === "monthly") {
        const key = addMonths(o.date.slice(0, 7), index * o.recurrence.interval), [y, m] = key.split("-").map(Number);
        date = dayAt(y, m - 1, Number(o.date.slice(8)));
      } else {
        const next = /* @__PURE__ */ new Date(`${o.date}T12:00:00Z`);
        next.setUTCDate(next.getUTCDate() + index * 7 * o.recurrence.interval);
        date = next.toISOString().slice(0, 10);
      }
      if (o.recurrence.until && date > o.recurrence.until) break;
    }
  }
  const included = new Set(rows.map((row) => row.id));
  for (const o of s.obligations) if ((o.paid || o.skipped) && !included.has(o.id) && o.date >= from && o.date <= to) rows.push(clone(o));
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
function replaceSchedule(s, { id, effective, reason, name, kind, amount, account, debtAccount = "", budgetCategory = "", recurrence = null }, asOf = today(s.timezone)) {
  dateKey(effective);
  dateKey(asOf);
  string(reason, "Schedule explanation");
  const template = s.obligations.find((o) => o.id === id && !o.templateId && !o.archived && !o.goal);
  if (!template || effective <= asOf || !reason.trim() || template.cancelAfter && effective >= template.cancelAfter) fail("Choose a future replacement start before any existing stop, with an explanation.");
  if (kind === "income" && amount >= 0 || kind === "bill" && amount <= 0) fail("Scheduled amount sign must match its event type.");
  validateScheduleDetails(s, { name, kind, amount: Math.abs(amount), date: effective, account, debtAccount, budgetCategory });
  return mutate(s, "obligation-replace", { id, effective, reason, name, kind, amount, account, debtAccount, budgetCategory, recurrence }, (n) => {
    const old = n.obligations.find((o) => o.id === id);
    old.cancelAfter = effective;
    old.stopReason = reason.trim();
    n.obligations.push({ id: uid(), name, kind, amount, account, debtAccount, budgetCategory, date: effective, paid: false, replacesTemplate: id, ...recurrence ? { recurrence: clone(recurrence) } : {} });
  });
}
function recordScheduled(s, id, date = today(s.timezone)) {
  dateKey(date);
  if (date > today(s.timezone)) fail("Expected income or bills cannot be recorded as paid in advance.");
  const o = scheduledEvents(s, { from: "1900-01-01", to: date }).find((o2) => o2.id === id);
  if (!o || o.paid || o.skipped) fail("Choose an unpaid occurrence due by the payment date.");
  const kind = o.kind === "income" ? "income" : o.debtAccount ? "repayment" : "expense";
  let next = addTransaction(s, { kind, amount: Math.abs(o.amount), date, account: o.account, toAccount: o.debtAccount || "", category: o.budgetCategory || "oneoff", note: o.name, source: "scheduled" });
  return mutate(s, "obligation-paid", { id, date }, (n) => {
    const transaction = clone(next.transactions.at(-1));
    transaction.seq = n.seq;
    n.transactions.push(transaction);
    let record = n.obligations.find((x) => x.id === id);
    if (!record) {
      record = clone(o);
      delete record.recurrence;
      n.obligations.push(record);
    }
    record.paid = true;
    record.paidDate = date;
    record.transaction = n.transactions.at(-1).id;
  });
}
function mutate(state, type, input, apply, operationId = uid()) {
  if (state.operations.some((o) => o.id === operationId)) return state;
  const next = clone(state);
  next.seq++;
  next.version++;
  apply(next);
  const patches = [];
  for (const collection of ["accounts", "transactions", "reconciliations", "categories", "budgets", "goals", "obligations", "outside", "notes", "holdings", "cycleHistory", "imports"]) {
    const previous = new Map(state[collection].map((r) => [String(r.id), r]));
    for (const record of next[collection]) if (!previous.has(String(record.id)) || JSON.stringify(previous.get(String(record.id))) !== JSON.stringify(record)) patches.push({ collection, key: String(record.id), value: clone(record), action: "put" });
    if (state[collection].some((r) => !next[collection].some((x) => String(x.id) === String(r.id)))) fail("Financial records cannot be deleted. Archive or correct them.");
  }
  for (const [key, amount] of Object.entries(next.reservations)) if (state.reservations[key] !== amount) patches.push({ collection: "reservations", key, value: { amount }, action: "put" });
  const profile = (s) => ({ schema: s.schema, id: s.id, seq: s.seq, currency: s.currency, timezone: s.timezone, cycleStart: s.cycleStart, name: s.name, settings: s.settings, legacy: s.legacy });
  const beforeProfile = profile(state), afterProfile = profile(next), changedProfile = Object.fromEntries(Object.entries(afterProfile).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(beforeProfile[key])));
  if (Object.keys(changedProfile).length) patches.push({ collection: "preferences", key: "profile", value: clone(changedProfile), action: "put" });
  next.operations.push({ id: operationId, type, input: clone(input), patches, baseVersion: state.version, version: next.version, seq: next.seq, at: (/* @__PURE__ */ new Date()).toISOString(), sync: "pending" });
  validateState(next);
  return next;
}
function addTransaction(s, input, operationId) {
  const { kind, date, amount, account, toAccount, category = "", note = "" } = input;
  dateKey(date);
  validMoney(amount, "Transaction amount");
  if (amount <= 0) fail("Amount must be above zero.");
  string(note, "Note");
  if (date > today(s.timezone)) fail("Future payments belong on the calendar, not in actual transactions.");
  const a = s.accounts.find((a2) => a2.id === account), to = s.accounts.find((a2) => a2.id === toAccount);
  if (!a) fail("Choose an account.");
  if (category && !s.categories.some((c) => c.id === category)) fail("Choose a category.");
  let postings;
  if (["expense", "loan-out"].includes(kind)) postings = [{ account, amount: -amount }];
  else if (["income", "refund", "loan-return"].includes(kind)) {
    if (a.kind !== "asset" && kind === "income") fail("Income must arrive in a cash account.");
    postings = [{ account, amount }];
  } else if (["transfer", "repayment", "borrow"].includes(kind)) {
    if (!to || to.id === a.id) fail("Choose a different destination account.");
    if (kind === "transfer" && (a.kind !== "asset" || to.kind !== "asset")) fail("Transfers are between your cash accounts.");
    if (kind === "repayment" && (a.kind !== "asset" || to.kind !== "liability")) fail("Repayment moves cash to a debt account.");
    if (kind === "borrow" && (a.kind !== "liability" || to.kind !== "asset")) fail("Borrowing moves money from debt to cash.");
    postings = [{ account, amount: -amount }, { account: toAccount, amount }];
  } else fail("Unsupported transaction kind.");
  return mutate(s, "transaction", input, (n) => n.transactions.push({ id: uid(), seq: n.seq, kind, date, amount, account, toAccount: toAccount || "", category, note, postings, historical: false, source: input.source || "manual", importKey: input.importKey || "", ...input.splits ? { splits: clone(input.splits) } : {} }), operationId);
}
function reverseTransaction(s, id, reason = "Correction") {
  const t = s.transactions.find((t2) => t2.id === id);
  if (!t || t.historical || t.kind === "reversal" || s.transactions.some((x) => x.reverses === id)) fail("This transaction cannot be reversed.");
  if (s.outside.some((o) => o.transaction === id && (o.returned || 0) > 0)) fail("Reverse the linked returns before correcting the original outgoing money.");
  return mutate(s, "reverse", { id, reason }, (n) => {
    const reversalId = uid();
    n.transactions.push({ id: reversalId, seq: n.seq, kind: "reversal", date: t.date, amount: t.amount, account: t.account || "", toAccount: t.toAccount || "", category: t.category, note: reason, postings: t.postings.map((p) => ({ account: p.account, amount: -p.amount })), reverses: id, historical: false, source: "correction" });
    for (const record of n.outside) for (const returned of record.returns || []) if (returned.transaction === id && !returned.reversedBy) {
      record.returned -= returned.amount;
      returned.reversedBy = reversalId;
    }
    for (const record of n.outside) if (record.transaction === id) record.reversedBy = reversalId;
    for (const g of n.goals) if ([...g.purchases || [], g.purchase].filter(Boolean).some((p) => p.transaction === id && !p.reversedBy)) {
      for (const p of [...g.purchases || [], g.purchase].filter(Boolean)) if (p.transaction === id) p.reversedBy = reversalId;
      g.completed = goalPurchases(g).some((p) => p.complete !== false);
      if (g.archiveReason !== "manual") g.archived = g.completed;
      for (const h of n.holdings) if (h.transaction === id) h.reversedBy = reversalId;
      for (const o of n.obligations) if (o.purchaseTransaction === id) o.archived = true;
    }
    for (const o of n.obligations) if (o.transaction === id) {
      o.paid = false;
      o.reversedBy = reversalId;
      o.transaction = "";
    }
  });
}
function purchaseGoal(s, { id, amount, account, date, complete = true, quantity = null }) {
  const g = s.goals.find((g2) => g2.id === id);
  dateKey(date);
  validMoney(amount, "Purchase amount");
  if (!g || g.archived || g.protected) fail("Choose an active purchase goal.");
  if (amount <= 0 || date > today(s.timezone)) fail("Record a positive purchase that has already happened.");
  if (typeof complete !== "boolean") fail("Choose whether this finishes the purchase.");
  if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) fail("Purchased quantity must be positive.");
  if (g.kind === "gold" && !complete && quantity === null) fail("Enter the actual gold quantity for a partial purchase.");
  const a = s.accounts.find((a2) => a2.id === account), balance = accountBalance(s, account, date), sum = summary(s, date);
  if (a.kind !== "asset" || balance === null || balance < amount) fail("Verify sufficient cash in this account before buying.");
  if (sum.available === null || amount > sum.available + (s.reservations[id] || 0)) fail("This purchase would use protected cash or money reserved for another goal.");
  const transaction = uid();
  return mutate(s, "goal-purchase", { id, amount, account, date, complete, quantity }, (n) => {
    n.transactions.push({ id: transaction, seq: n.seq, kind: "expense", amount, date, account, toAccount: "", category: "oneoff", note: `Goal purchase: ${g.name}`, postings: [{ account, amount: -amount }], historical: false, source: "goal", goal: id });
    const goal = n.goals.find((x) => x.id === id), beforeReservation = n.reservations[id] || 0;
    goal.purchases = [...goal.purchases || [goal.purchase].filter(Boolean), { transaction, amount, date, complete, releasedReservation: beforeReservation, quantity }];
    goal.purchase = goal.purchases.at(-1);
    goal.completed = complete;
    goal.archived = complete;
    if (complete) goal.archiveReason = "purchased";
    n.reservations[id] = complete ? 0 : Math.max(0, beforeReservation - amount);
    if (goal.kind === "gold") {
      const remainingQuantity = goal.quantity == null ? null : Math.max(0, goal.quantity - n.holdings.filter((h) => h.goal === id && !h.reversedBy).reduce((total, h) => total + (h.quantity || 0), 0));
      n.holdings.push({ id: uid(), name: goal.name, quantity: quantity ?? (complete && remainingQuantity > 0 ? remainingQuantity : null), cost: amount, date, goal: id, transaction });
    }
    if (complete && goal.recurringCost) {
      const key = addMonths(date.slice(0, 7), 1), [y, m] = key.split("-").map(Number);
      n.obligations.push({ id: uid(), name: `${goal.name}: ongoing cost`, kind: "bill", amount: goal.recurringCost, date: dayAt(y, m - 1, Number(date.slice(8))), account, paid: false, recurrence: { unit: "monthly", interval: 1, until: "" }, goal: id, purchaseTransaction: transaction });
    }
  });
}
function archiveGoal(s, id) {
  if (!s.goals.some((g) => g.id === id)) fail("Goal not found.");
  return mutate(s, "archive-goal", { id }, (n) => {
    const goal = n.goals.find((g) => g.id === id);
    goal.archived = true;
    goal.archiveReason = "manual";
    n.reservations[id] = 0;
  });
}
function classifyOutside(s, { id, kind }) {
  const record = s.outside.find((o) => o.id === id);
  if (!record || record.transaction || record.reversedBy || record.kind === "borrowed" || !["unclassified", "gift", "loan", "investment"].includes(kind)) fail("Review an unlinked historical outside record; linked payments and borrowing keep their original meaning.");
  if ((record.returned || 0) > 0 && !["loan", "investment"].includes(kind)) fail("Actual returns must remain attached to a loan or investment classification.");
  return mutate(s, "outside-classify", { id, kind }, (n) => {
    n.outside.find((o) => o.id === id).kind = kind;
  });
}
function giveOutside(s, { name, kind, amount, account, date, note = "", due = "" }) {
  string(name, "Person / purpose", 300);
  string(note, "Note");
  dateKey(date);
  if (due) dateKey(due);
  validMoney(amount, "Outside amount");
  if (!name.trim() || amount <= 0 || !["gift", "loan", "investment"].includes(kind)) fail("Enter a purpose, positive amount and outside classification.");
  const a = s.accounts.find((a2) => a2.id === account);
  if (a?.kind !== "asset") fail("Choose the cash account this money left.");
  if (date > today(s.timezone)) fail("Record money already sent; use the calendar for a future payment.");
  const id = uid(), transaction = uid();
  return mutate(s, "outside-given", { name, kind, amount, account, date, note, due }, (n) => {
    n.transactions.push({ id: transaction, seq: n.seq, kind: kind === "gift" ? "expense" : "loan-out", amount, account, toAccount: "", date, category: "oneoff", note: note || `${kind}: ${name}`, postings: [{ account, amount: -amount }], historical: false, source: "outside", outside: id });
    n.outside.push({ id, name: name.trim(), kind, amount, account, date, note, due, returned: 0, returns: [], transaction, source: "manual" });
  });
}
function returnOutside(s, { id, amount, account, date, note = "" }) {
  const record = s.outside.find((o) => o.id === id);
  validMoney(amount, "Return amount");
  dateKey(date);
  if (!record || record.reversedBy || !["loan", "investment"].includes(record.kind)) fail("Choose an active loan or investment record.");
  if (amount <= 0 || amount > record.amount - (record.returned || 0)) fail("Return must not exceed the outstanding amount.");
  if (s.accounts.find((a) => a.id === account)?.kind !== "asset") fail("Return must arrive in a cash account.");
  if (date < record.date || date > today(s.timezone)) fail("Record a return received on or after the original payment, through today.");
  string(note, "Note");
  const transaction = uid();
  return mutate(s, "outside-return", { id, amount, date, account, note }, (n) => {
    n.transactions.push({ id: transaction, seq: n.seq, kind: "loan-return", amount, account, toAccount: "", date, category: "", note: note || `Return: ${record.name}`, postings: [{ account, amount }], historical: false, source: "outside", outside: id });
    const r = n.outside.find((o) => o.id === id);
    r.returned = (r.returned || 0) + amount;
    r.returns = [...r.returns || [], { id: uid(), amount, date, transaction }];
  });
}
function canCorrectTransaction(s, id) {
  const t = s.transactions.find((t2) => t2.id === id);
  return !!t && !t.historical && ["expense", "income", "refund"].includes(t.kind) && ["manual", "csv", "correction"].includes(t.source) && !s.transactions.some((x) => x.reverses === id) && !t.goal && !t.outside && !s.goals.some((g) => [...g.purchases || [], g.purchase].filter(Boolean).some((p) => p.transaction === id)) && !s.outside.some((o) => o.transaction === id || (o.returns || []).some((r) => r.transaction === id)) && !s.obligations.some((o) => o.transaction === id);
}
function correctTransaction(s, { id, replacement, reason }) {
  if (!canCorrectTransaction(s, id)) fail("Use the linked workflow to correct this entry, or reverse it separately.");
  string(reason, "Correction explanation", 1e4);
  if (!reason.trim()) fail("Explain the correction.");
  if (!replacement || !["expense", "income", "refund"].includes(replacement.kind)) fail("Choose spending, income or refund for an ordinary correction.");
  const input = { kind: replacement.kind, date: replacement.date, amount: replacement.amount, account: replacement.account, category: replacement.category || "", note: replacement.note || "", source: "correction", ...replacement.splits ? { splits: clone(replacement.splits) } : {} };
  if (input.date > today(s.timezone)) fail("An actual correction cannot be dated in the future.");
  const staged = addTransaction(reverseTransaction(s, id, reason), input), appended = staged.transactions.slice(s.transactions.length);
  return mutate(s, "transaction-correct", { id, replacement: input, reason }, (n) => {
    for (const t of appended) {
      const record = clone(t);
      record.seq = n.seq;
      if (record.kind !== "reversal") record.corrects = id;
      n.transactions.push(record);
    }
  });
}

// app/sync.mjs
var COLLECTIONS = ["accounts", "transactions", "reconciliations", "categories", "budgets", "goals", "obligations", "outside", "notes", "holdings", "cycleHistory", "imports"];
var preferences = (s) => ({ schema: s.schema, id: s.id, seq: s.seq, currency: s.currency, timezone: s.timezone, cycleStart: s.cycleStart, name: s.name, settings: clone(s.settings), legacy: clone(s.legacy) });
var PROFILE_KEYS = /* @__PURE__ */ new Set(["schema", "id", "seq", "currency", "timezone", "cycleStart", "name", "settings", "legacy"]);
function entities(state) {
  validateState(state);
  const rows = [];
  for (const collection of COLLECTIONS) for (const record of state[collection]) rows.push({ collection, key: String(record.id), value: clone(record) });
  for (const [key, amount] of Object.entries(state.reservations)) rows.push({ collection: "reservations", key, value: { amount } });
  rows.push({ collection: "preferences", key: "profile", value: preferences(state) });
  return rows;
}
var identity = (p) => `${p.collection}/${p.key}`;
function sameJson(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((key, i) => key === bk[i] && sameJson(a[key], b[key]));
}
function applyPatches(state, patches) {
  if (!Array.isArray(patches)) throw new Error("Invalid sync patches.");
  const next = clone(state);
  const seen = /* @__PURE__ */ new Set();
  for (const patch of patches) {
    if (!patch || patch.action !== "put" || typeof patch.key !== "string" || !patch.key || !patch.value || typeof patch.value !== "object" || Array.isArray(patch.value)) throw new Error("Invalid sync patch.");
    if (seen.has(identity(patch))) throw new Error("Duplicate sync record.");
    seen.add(identity(patch));
    if (["__proto__", "constructor", "prototype"].includes(patch.key)) throw new Error("Unsafe sync key.");
    if (patch.collection === "preferences") {
      if (patch.key !== "profile" || !patch.value || Object.keys(patch.value).some((k) => !PROFILE_KEYS.has(k))) throw new Error("Invalid workspace preferences.");
      Object.assign(next, clone(patch.value));
    } else if (patch.collection === "reservations") next.reservations[patch.key] = patch.value.amount;
    else {
      if (!COLLECTIONS.includes(patch.collection) || String(patch.value.id) !== patch.key) throw new Error("Unknown collection or inconsistent record ID.");
      const collection = next[patch.collection], index = collection.findIndex((r) => String(r.id) === patch.key);
      if (patch.collection === "transactions" && index >= 0 && !sameJson(collection[index], patch.value)) throw new Error("Transactions are immutable. Add a linked correction.");
      if (index < 0) collection.push(clone(patch.value));
      else collection[index] = clone(patch.value);
    }
  }
  return next;
}
function hydrateSnapshot(snapshot) {
  if (!snapshot || typeof snapshot.workspace !== "string" || !Number.isSafeInteger(snapshot.version) || snapshot.version < 0 || !Array.isArray(snapshot.records)) throw new Error("Invalid cloud snapshot.");
  const ids = /* @__PURE__ */ new Set(), patches = [];
  for (const r of snapshot.records) {
    const id = identity(r);
    if (ids.has(id) || !Number.isSafeInteger(r.version) || r.version < 1 || r.version > snapshot.version) throw new Error("Inconsistent cloud records.");
    ids.add(id);
    patches.push({ collection: r.collection, key: r.key, value: r.value, action: "put" });
  }
  if (!ids.has("preferences/profile")) throw new Error("Cloud workspace is not initialized.");
  const next = applyPatches(fresh(), patches);
  if (next.id !== snapshot.workspace) throw new Error("Cloud records belong to a different workspace.");
  next.version = snapshot.version;
  next.seq = Math.max(next.seq, ...next.transactions.map((t) => t.seq), ...next.accounts.map((a) => a.baselineSeq), ...next.reconciliations.map((r) => r.seq || 0));
  next.operations = [];
  if (snapshot.operations !== void 0) {
    if (!Array.isArray(snapshot.operations)) throw new Error("Invalid cloud operation audit.");
    const operationIds = /* @__PURE__ */ new Set(), versions = /* @__PURE__ */ new Set();
    if (snapshot.operations.some((o) => !o || typeof o !== "object" || !Array.isArray(o.patches))) throw new Error("Invalid cloud operation audit.");
    for (const operation of snapshot.operations.slice().sort((a, b) => a.version - b.version)) {
      const seq = operation.patches?.find((p) => p.collection === "preferences" && p.key === "profile")?.value?.seq;
      if (typeof operation.id !== "string" || !operation.id || operationIds.has(operation.id) || !Number.isSafeInteger(operation.version) || operation.version < 1 || operation.version > snapshot.version || versions.has(operation.version) || typeof operation.type !== "string" || !operation.type || operation.type.length > 100 || !Array.isArray(operation.patches) || !Number.isSafeInteger(seq) || seq < 1 || seq > next.seq || typeof operation.at !== "string" || !Number.isFinite(Date.parse(operation.at))) throw new Error("Inconsistent cloud operation audit.");
      operationIds.add(operation.id);
      versions.add(operation.version);
      next.operations.push({ id: operation.id, type: operation.type, input: {}, patches: clone(operation.patches), baseVersion: operation.version - 1, version: operation.version, seq, at: operation.at, sync: "synced", provenance: "cloud" });
    }
  }
  validateState(next);
  return next;
}
function canonicalJson(value) {
  const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
  return JSON.stringify(sort(clone(value)));
}

// server/transitions.mjs
var scopes = {
  "account-add": ["accounts"],
  reconcile: ["accounts", "reconciliations"],
  "balance-review": ["reconciliations"],
  transaction: ["transactions"],
  reverse: ["transactions", "goals", "holdings", "outside", "obligations"],
  "transaction-correct": ["transactions"],
  "goal-purchase": ["transactions", "goals", "reservations", "holdings", "obligations"],
  reserve: ["reservations"],
  release: ["reservations"],
  "archive-goal": ["goals", "reservations"],
  "goal-add": ["goals", "reservations"],
  "goal-edit": ["goals"],
  "outside-given": ["transactions", "outside"],
  "outside-return": ["transactions", "outside"],
  "outside-classify": ["outside"],
  "obligation-add": ["obligations"],
  "obligation-paid": ["transactions", "obligations"],
  "obligation-skip": ["obligations"],
  "obligation-stop": ["obligations"],
  "obligation-replace": ["obligations"],
  "obligation-restore": ["obligations"],
  "csv-import": ["imports"],
  "csv-undo": ["imports"],
  "budget-set": ["budgets"],
  "category-add": ["categories"],
  "category-archive": ["categories"],
  "note-add": ["notes"],
  "note-edit": ["notes"],
  "note-item-toggle": ["notes"],
  "note-archive": ["notes"],
  "note-restore": ["notes"],
  settings: [],
  "cycle-scheduled": ["cycleHistory"],
  "cycle-cancel": ["cycleHistory"]
};
var changed = (a, b, keys) => keys.some((k) => !sameJson(a[k], b[k]));
var without = (record, keys) => Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
var entityCollections = ["accounts", "transactions", "reconciliations", "categories", "budgets", "goals", "obligations", "outside", "notes", "holdings", "cycleHistory", "imports"];
function assertEngineReplay(current, next, expected) {
  const ids = /* @__PURE__ */ new Map(), references = /* @__PURE__ */ new Set(["id", "transaction", "reversedBy", "purchaseTransaction", "outside", "goal", "corrects"]);
  for (const collection of entityCollections) {
    const oldIds = new Set(current[collection].map((r) => r.id)), wanted = expected[collection].filter((r) => !oldIds.has(r.id)), actual = next[collection].filter((r) => !oldIds.has(r.id));
    if (wanted.length !== actual.length) throw new Error("Linked financial records do not match the authoritative operation.");
    wanted.forEach((r, i) => ids.set(r.id, actual[i].id));
  }
  const oldReturnIds = new Set(current.outside.flatMap((o) => (o.returns || []).map((r) => r.id))), wantedReturns = expected.outside.flatMap((o) => o.returns || []).filter((r) => !oldReturnIds.has(r.id)), actualReturns = next.outside.flatMap((o) => o.returns || []).filter((r) => !oldReturnIds.has(r.id));
  if (wantedReturns.length !== actualReturns.length) throw new Error("Linked return records do not match the authoritative operation.");
  wantedReturns.forEach((r, i) => ids.set(r.id, actualReturns[i].id));
  const normalize = (value, key = "") => Array.isArray(value) ? value.map((v) => normalize(v)) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)])) : references.has(key) && ids.has(value) ? ids.get(value) : value;
  for (const collection of entityCollections) if (!sameJson(normalize(expected[collection]), next[collection])) throw new Error("Linked financial records do not match the authoritative operation.");
  if (!sameJson(expected.reservations, next.reservations)) throw new Error("Linked financial reservations do not match the authoritative operation.");
}
function validateTransitions(current, next, request, asOf) {
  const scope = scopes[request.type];
  if (!scope) throw new Error("Unsupported sync operation type.");
  for (const patch of request.patches) {
    if (patch.collection === "preferences") {
      const allowed2 = request.type === "settings" ? ["seq", "name", "timezone", "settings"] : ["seq"];
      if (Object.entries(patch.value).some(([key, value]) => !allowed2.includes(key) && !sameJson(value, current[key]))) throw new Error("This operation cannot change workspace preferences.");
    } else if (!scope.includes(patch.collection)) throw new Error("This operation cannot change that collection.");
  }
  const newChecks = next.reconciliations.filter((r) => !current.reconciliations.some((old) => old.id === r.id));
  if (newChecks.length && (request.type !== "reconcile" || newChecks.length !== 1)) throw new Error("Only a balance check can establish a baseline.");
  for (const old of current.accounts) {
    const account = next.accounts.find((a) => a.id === old.id);
    if (account.kind !== old.kind || account.currency !== old.currency) throw new Error("Account type and currency cannot be rewritten.");
    if (changed(old, account, ["opening", "baselineDate", "baselineSeq", "verified"])) {
      const r = newChecks[0], expected = r ? accountBalance(current, old.id, r.date) : null;
      if (request.type !== "reconcile" || !r || r.account !== old.id || r.seq !== next.seq || r.date < old.baselineDate || r.date > asOf || r.expected !== expected || r.difference !== (expected === null ? null : r.balance - expected) || r.status !== (expected === null || r.balance === expected ? "matched" : "unresolved") || r.review !== void 0 || account.opening !== r.balance || account.baselineDate !== r.date || account.baselineSeq !== next.seq || account.verified !== true) throw new Error("A checked balance requires matching, dated reconciliation evidence.");
    }
  }
  for (const account of next.accounts.filter((a) => !current.accounts.some((old) => old.id === a.id))) if (request.type !== "account-add" || account.opening !== null || account.verified === true || account.baselineSeq !== next.seq || account.baselineDate > asOf) throw new Error("New accounts start without a verified balance.");
  if (newChecks.length) {
    const r = newChecks[0], account = next.accounts.find((a) => a.id === r.account);
    if (!current.accounts.some((a) => a.id === r.account) || account.baselineSeq !== next.seq) throw new Error("A balance check must update its existing account baseline.");
  }
  for (const old of current.reconciliations) {
    const r = next.reconciliations.find((r2) => r2.id === old.id);
    if (sameJson(old, r)) continue;
    if (request.type !== "balance-review" || old.status !== "unresolved" || r.status !== "reviewed" || !sameJson(without(old, ["status", "review"]), without(r, ["status", "review"]))) throw new Error("Original balance evidence is immutable; add a review explanation.");
  }
  const increases = Object.entries(next.reservations).filter(([id, amount]) => amount > (current.reservations[id] || 0));
  if (increases.length) {
    const [id, amount] = increases[0], goal = current.goals.find((g) => g.id === id), available = summary(current, asOf).available;
    if (request.type !== "reserve" || increases.length !== 1 || !goal || goal.archived || available === null || amount - (current.reservations[id] || 0) > available) throw new Error("Reserve only available cash for one active goal.");
  }
  for (const old of current.goals) {
    const goal = next.goals.find((g) => g.id === old.id);
    if (request.type === "goal-edit" && !sameJson(without(old, ["target", "priority", "desired", "flexible"]), without(goal, ["target", "priority", "desired", "flexible"]))) throw new Error("Goal edits cannot rewrite purchase history or ownership.");
  }
  const addedGoals = next.goals.filter((g) => !current.goals.some((old) => old.id === g.id)), editedGoals = next.goals.filter((g) => current.goals.some((old) => old.id === g.id) && !sameJson(g, current.goals.find((old) => old.id === g.id)));
  if (request.type === "goal-add") {
    const g = addedGoals[0];
    if (addedGoals.length !== 1 || editedGoals.length || g.archived || g.completed || g.purchase || (g.purchases || []).length || g.archiveReason || next.reservations[g.id] !== 0 || !sameJson(without(next.reservations, [g.id]), current.reservations)) throw new Error("Add one new goal without invented purchases or reserved savings.");
  }
  if (request.type === "goal-edit" && (addedGoals.length || editedGoals.length !== 1)) throw new Error("Edit one existing goal without inventing another goal.");
  if (request.type === "archive-goal") {
    if (addedGoals.length || editedGoals.length !== 1) throw new Error("Archive one existing goal while retaining its history.");
    assertEngineReplay(current, next, archiveGoal(current, editedGoals[0].id));
  }
  if (["reserve", "release"].includes(request.type)) {
    const deltas = Object.keys(next.reservations).filter((id) => next.reservations[id] !== current.reservations[id]);
    if (deltas.length !== 1 || !current.goals.some((g) => g.id === deltas[0] && !g.archived) || (request.type === "reserve" ? next.reservations[deltas[0]] <= current.reservations[deltas[0]] : next.reservations[deltas[0]] >= current.reservations[deltas[0]])) throw new Error("Reserve or release a positive amount for one existing active goal.");
  }
  for (const old of current.obligations) {
    const event = next.obligations.find((o) => o.id === old.id);
    if (sameJson(old, event)) continue;
    if (request.type === "obligation-add") throw new Error("Adding a schedule cannot rewrite existing events.");
    if (["obligation-stop", "obligation-replace"].includes(request.type)) {
      if (old.templateId || old.goal || old.archived || !sameJson(without(old, ["cancelAfter", "stopReason"]), without(event, ["cancelAfter", "stopReason"])) || !event.stopReason?.trim() || !event.cancelAfter || event.cancelAfter < asOf || request.type === "obligation-replace" && event.cancelAfter <= asOf || old.cancelAfter && event.cancelAfter >= old.cancelAfter) throw new Error("Only a dated future stop may change an existing ordinary template.");
    }
    if (request.type === "obligation-skip" && (old.paid || old.skipped || event.skipped !== true || !sameJson(without(old, ["skipped", "skipReason"]), without(event, ["skipped", "skipReason"])))) throw new Error("Cancel only an unpaid occurrence without rewriting its schedule.");
    if (request.type === "obligation-restore" && (!old.skipped || old.paid || event.skipped !== false || !sameJson(without(old, ["skipped"]), without(event, ["skipped"])))) throw new Error("Restore only the original cancelled occurrence.");
  }
  const addedEvents = next.obligations.filter((o) => !current.obligations.some((old) => old.id === o.id));
  if (request.type === "obligation-add") {
    const event = addedEvents[0];
    if (addedEvents.length !== 1) throw new Error("Add one expected schedule at a time.");
    assertEngineReplay(current, next, addSchedule(current, { name: event.name, kind: event.kind, amount: Math.abs(event.amount), date: event.date, account: event.account, debtAccount: event.debtAccount || "", budgetCategory: event.budgetCategory || "", recurrence: event.recurrence || null }));
  }
  if (["obligation-stop", "obligation-restore"].includes(request.type) && addedEvents.length) throw new Error("This schedule review cannot invent another event.");
  if (request.type === "obligation-replace") {
    const changedTemplates = current.obligations.filter((old2) => !sameJson(old2, next.obligations.find((o) => o.id === old2.id)));
    const event = addedEvents[0], old = changedTemplates[0];
    if (addedEvents.length !== 1 || changedTemplates.length !== 1 || event.replacesTemplate !== old.id || event.date !== next.obligations.find((o) => o.id === old.id).cancelAfter) throw new Error("A replacement must retain one prior template and its exact dated boundary.");
    assertEngineReplay(current, next, replaceSchedule(current, { id: old.id, effective: event.date, reason: next.obligations.find((o) => o.id === old.id).stopReason, name: event.name, kind: event.kind, amount: event.amount, account: event.account, debtAccount: event.debtAccount || "", budgetCategory: event.budgetCategory || "", recurrence: event.recurrence || null }, asOf));
  }
  for (const event of addedEvents) {
    if (["obligation-add", "obligation-replace"].includes(request.type) && (event.paid || event.transaction || event.templateId || event.skipped)) throw new Error("New templates cannot contain invented payment history.");
    if (request.type === "obligation-skip") {
      const expected = scheduledEvents(current, { from: event.date, to: event.date }).find((o) => o.id === event.id);
      if (!expected || expected.paid || expected.skipped || event.skipped !== true || !sameJson(without(expected, ["recurrence", "skipped", "skipReason"]), without(event, ["recurrence", "skipped", "skipReason"]))) throw new Error("Cancelled occurrence must match the original schedule.");
    }
  }
  const addedTransactions = next.transactions.filter((t) => !current.transactions.some((old) => old.id === t.id));
  if (request.type === "transaction") {
    const t = addedTransactions[0];
    if (addedTransactions.length !== 1 || !["manual", "csv"].includes(t.source)) throw new Error("Record one ordinary manual or imported transaction per operation.");
    if (t.date > asOf) throw new Error("Future payments belong on the calendar, not in actual transactions.");
    assertEngineReplay(current, next, addTransaction(current, { kind: t.kind, date: t.date, amount: t.amount, account: t.account, toAccount: t.toAccount, category: t.category, note: t.note, source: t.source, importKey: t.importKey, ...t.splits ? { splits: t.splits } : {} }));
  }
  if (request.type === "reverse") {
    const t = addedTransactions[0];
    if (addedTransactions.length !== 1 || t.kind !== "reversal") throw new Error("A reversal must correct exactly one original transaction.");
    assertEngineReplay(current, next, reverseTransaction(current, t.reverses, t.note));
  }
  if (request.type === "obligation-paid") {
    const changedEvents = next.obligations.filter((o) => !sameJson(o, current.obligations.find((old) => old.id === o.id))), event = changedEvents[0];
    if (addedTransactions.length !== 1 || changedEvents.length !== 1 || !event?.paid || !event.paidDate || event.transaction !== addedTransactions[0].id) throw new Error("A scheduled payment requires one atomic cash entry and occurrence.");
    assertEngineReplay(current, next, recordScheduled(current, event.id, event.paidDate));
  }
  if (request.type === "goal-purchase") {
    const t = addedTransactions[0], goal = next.goals.find((g) => g.id === t?.goal), purchase = goal?.purchase;
    if (addedTransactions.length !== 1 || !purchase || purchase.transaction !== t.id) throw new Error("A goal purchase requires its exact linked expense.");
    assertEngineReplay(current, next, purchaseGoal(current, { id: goal.id, amount: t.amount, account: t.account, date: t.date, complete: purchase.complete, quantity: purchase.quantity ?? null }));
  }
  if (request.type === "outside-return") {
    const t = addedTransactions[0];
    if (addedTransactions.length !== 1 || !t.outside) throw new Error("An outside return requires one linked receipt.");
    assertEngineReplay(current, next, returnOutside(current, { id: t.outside, amount: t.amount, account: t.account, date: t.date, note: t.note }));
  }
  if (request.type === "outside-given") {
    const addedOutside = next.outside.filter((o2) => !current.outside.some((old) => old.id === o2.id)), o = addedOutside[0];
    if (addedTransactions.length !== 1 || addedOutside.length !== 1 || o.transaction !== addedTransactions[0].id) throw new Error("Outgoing money requires one exact linked record and cash entry.");
    assertEngineReplay(current, next, giveOutside(current, { name: o.name, kind: o.kind, amount: o.amount, account: o.account, date: o.date, note: o.note || "", due: o.due || "" }));
  }
  if (request.type === "transaction-correct") {
    const reversal = addedTransactions.find((t) => t.kind === "reversal"), replacement = addedTransactions.find((t) => t.kind !== "reversal");
    if (addedTransactions.length !== 2 || !reversal || !replacement || replacement.corrects !== reversal.reverses) throw new Error("A replacement requires one linked reversal and one corrected entry.");
    assertEngineReplay(current, next, correctTransaction(current, { id: reversal.reverses, reason: reversal.note, replacement: { kind: replacement.kind, date: replacement.date, amount: replacement.amount, account: replacement.account, category: replacement.category || "", note: replacement.note || "", ...replacement.splits ? { splits: replacement.splits } : {} } }));
  }
  if (request.type === "outside-classify") {
    const edited = next.outside.filter((o) => !sameJson(o, current.outside.find((old) => old.id === o.id)));
    if (edited.length !== 1 || !current.outside.some((o) => o.id === edited[0].id) || !sameJson(without(current.outside.find((o) => o.id === edited[0].id), ["kind"]), without(edited[0], ["kind"]))) throw new Error("Classification cannot rewrite the original outside record.");
    assertEngineReplay(current, next, classifyOutside(current, { id: edited[0].id, kind: edited[0].kind }));
  }
  if (request.type === "category-add") {
    const added = next.categories.filter((c) => !current.categories.some((old) => old.id === c.id));
    if (added.length !== 1) throw new Error("Add one spending category per operation.");
    assertEngineReplay(current, next, addCategory(current, { name: added[0].name, type: added[0].type }));
  }
  if (request.type === "category-archive") {
    const changed2 = next.categories.filter((c) => !sameJson(c, current.categories.find((old) => old.id === c.id)));
    if (changed2.length !== 1) throw new Error("Archive or restore one existing category per operation.");
    assertEngineReplay(current, next, toggleCategoryArchive(current, changed2[0].id));
  }
  if (request.type === "budget-set") {
    const edits = next.budgets.filter((b2) => !sameJson(b2, current.budgets.find((old2) => old2.id === b2.id)));
    if (edits.length !== 1) throw new Error("Review one period budget per operation.");
    const b = edits[0], old = current.budgets.find((old2) => old2.id === b.id);
    if (b.key < workspacePeriod(current, asOf)) throw new Error("Historical budget intentions cannot be rewritten.");
    if (old && (!sameJson(without(old, ["salary", "alloc", "revision", "status", "source"]), without(b, ["salary", "alloc", "revision", "status", "source"])) || Object.keys(old.alloc).some((id) => !Object.hasOwn(b.alloc, id)))) throw new Error("Budget changes retain identity, locks and category allocations; set an allocation to zero explicitly.");
    if (b.revision !== (Number.isSafeInteger(old?.revision) ? old.revision : 0) + 1 || b.status !== "planned" || b.source !== "manual") throw new Error("Budget changes need an explicit reviewed revision.");
  }
  if (request.type.startsWith("note-")) {
    const added = next.notes.filter((note) => !current.notes.some((old) => old.id === note.id)), edited = next.notes.filter((note) => current.notes.some((old) => old.id === note.id) && !sameJson(note, current.notes.find((old) => old.id === note.id)));
    if (request.type === "note-add") {
      if (added.length !== 1 || edited.length || added[0].archived || (added[0].items || []).some((item) => item.done)) throw new Error("Add one new note without rewriting earlier notes or checklist progress.");
    } else {
      if (added.length || edited.length !== 1) throw new Error("Change one existing note per operation.");
      const note = edited[0], old = current.notes.find((n) => n.id === note.id);
      if (request.type === "note-edit") {
        if (!sameJson(without(old, ["title", "body", "goal", "updated"]), without(note, ["title", "body", "goal", "updated"]))) throw new Error("Note edits retain checklist progress and archive history.");
      } else if (request.type === "note-item-toggle") {
        if (old.archived || !sameJson(without(old, ["items"]), without(note, ["items"])) || (old.items || []).length !== (note.items || []).length) throw new Error("Toggle one existing item of an active note.");
        const changes = (note.items || []).filter((item2, index2) => !sameJson(item2, old.items[index2]));
        if (changes.length !== 1) throw new Error("Toggle one checklist item per operation.");
        const index = note.items.indexOf(changes[0]), item = changes[0], previous = old.items[index];
        if (item.done !== !previous.done || !sameJson(without(previous, ["done"]), without(item, ["done"]))) throw new Error("A checklist toggle cannot rewrite item text or identity.");
      } else {
        if (request.type === "note-archive" ? old.archived || note.archived !== true : !old.archived || note.archived !== false) throw new Error("Archive or restore the selected note once.");
        if (!sameJson(without(old, ["archived"]), without(note, ["archived"]))) throw new Error("Archiving a note retains all text and checklist progress.");
      }
    }
  }
  for (const t of next.transactions.filter((t2) => !current.transactions.some((old) => old.id === t2.id))) if (t.date > asOf) throw new Error("Future payments belong on the calendar, not in actual transactions.");
}

// server/validation.mjs
var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var allowed = /* @__PURE__ */ new Set(["workspace", "operationId", "expectedVersion", "patches", "type"]);
function validateEnvelope(request) {
  if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some((k) => !allowed.has(k))) throw new Error("Invalid operation envelope.");
  if (typeof request.workspace !== "string" || !request.workspace || request.workspace.length > 200) throw new Error("Invalid workspace.");
  if (!UUID.test(request.operationId || "")) throw new Error("Invalid operation ID.");
  if (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 0) throw new Error("Invalid workspace version.");
  if (typeof request.type !== "string" || !request.type || request.type.length > 100) throw new Error("Invalid operation type.");
  if (!Array.isArray(request.patches) || !request.patches.length || request.patches.length > 1e3) throw new Error("Invalid operation size.");
  if (new TextEncoder().encode(JSON.stringify(request)).byteLength > 2e6) throw new Error("Operation is too large.");
}
function validateOperation(current, request, { asOf = today(current.timezone) } = {}) {
  validateState(current);
  dateKey(asOf);
  validateEnvelope(request);
  if (request.workspace !== current.id) throw new Error("Wrong workspace.");
  if (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 0 || request.expectedVersion !== current.version) throw new Error("Workspace version conflict.");
  const next = applyPatches(current, request.patches);
  if (next.id !== current.id || next.schema !== current.schema || next.currency !== current.currency) throw new Error("Workspace identity or currency cannot be replaced by sync.");
  if (next.cycleStart !== current.cycleStart) throw new Error("The original cycle start cannot be rewritten. Schedule a future change.");
  if (!sameJson(next.legacy, current.legacy)) throw new Error("Original imported records cannot be rewritten by sync.");
  for (const old of current.cycleHistory) {
    const replacement = next.cycleHistory.find((c) => c.id === old.id);
    if (!replacement) throw new Error("Cycle history cannot be removed.");
    if (sameJson(old, replacement)) continue;
    const cancellation = { ...old, status: "cancelled" };
    if (request.type !== "cycle-cancel" || old.status === "cancelled" || old.effective <= asOf || !sameJson(cancellation, replacement) || current.cycleHistory.some((c) => c.status !== "cancelled" && c.effective > old.effective)) throw new Error("Only the last future cycle change can be cancelled; earlier cycle history is immutable.");
  }
  const additions = next.cycleHistory.filter((c) => !current.cycleHistory.some((old) => old.id === c.id));
  if (additions.length && (request.type !== "cycle-scheduled" || additions.length !== 1 || additions[0].status !== "scheduled" || additions[0].effective <= asOf || current.cycleHistory.some((c) => c.status !== "cancelled" && c.effective >= additions[0].effective))) throw new Error("New cycle changes must be future, chronological schedules.");
  if (next.seq !== current.seq + 1) throw new Error("Operation sequence must advance exactly once.");
  const existing = new Set(current.transactions.map((t) => t.id));
  for (const t of next.transactions) if (!existing.has(t.id)) {
    if (t.historical || t.seq !== next.seq || t.amount <= 0) throw new Error("New transactions require a positive amount and the current operation sequence.");
  }
  next.version = current.version + 1;
  validateState(next);
  validateTransitions(current, next, request, asOf);
  return clone(next);
}

// server/bootstrap.mjs
var UUID2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var HASH = /^[a-f0-9]{64}$/;
var fields = /* @__PURE__ */ new Set(["workspace", "requestId", "records", "review"]);
async function validateBootstrap(request, destination) {
  if (!request || typeof request !== "object" || Array.isArray(request) || Object.keys(request).some((k) => !fields.has(k))) throw new Error("Invalid first-upload request.");
  if (typeof destination !== "string" || !destination || destination.length > 300) throw new Error("Configure the reviewed private destination.");
  if (typeof request.workspace !== "string" || !request.workspace || request.workspace.length > 200 || !UUID2.test(request.requestId || "")) throw new Error("Invalid first-upload identity.");
  if (!Array.isArray(request.records) || !request.records.length || request.records.length > 1e4 || new TextEncoder().encode(JSON.stringify(request)).byteLength > 5e6) throw new Error("First upload exceeds the reviewed size limit.");
  const review = request.review;
  if (!review || Object.keys(review).some((k) => !["confirmed", "destination", "payloadDigest"].includes(k)) || review.confirmed !== true || review.destination !== destination || !HASH.test(review.payloadDigest || "")) throw new Error("Confirm these records and their exact private destination before uploading.");
  for (const row of request.records) if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).some((k) => !["collection", "key", "value"].includes(k))) throw new Error("Invalid first-upload record.");
  const state = hydrateSnapshot({ workspace: request.workspace, version: 1, records: request.records.map((row) => ({ ...row, version: 1 })), operations: [] });
  const ordered = (rows) => rows.slice().sort((a, b) => (a.collection + "/" + a.key).localeCompare(b.collection + "/" + b.key));
  if (!sameJson(ordered(entities(state)), ordered(request.records))) throw new Error("First upload must include the complete reviewed workspace profile.");
  const payloadDigest = await digest(canonicalJson(request.records));
  if (payloadDigest !== review.payloadDigest) throw new Error("Records changed after the upload review.");
  return { workspace: request.workspace, requestId: request.requestId, records: clone(request.records), payloadDigest };
}

// server/supabase-adapter.mjs
import { Buffer } from "node:buffer";
var UUID3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function supabaseAdapter({ url, publishableKey, secretKey, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 15e3 }) {
  if (typeof window !== "undefined") throw new Error("The private database adapter must run on the server.");
  let base;
  try {
    base = new URL(url);
  } catch {
    throw new Error("Configure a valid Supabase project endpoint.");
  }
  if (base.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== "/" || base.port) throw new Error("Use the configured HTTPS Supabase project endpoint.");
  if (typeof publishableKey !== "string" || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey) || typeof secretKey !== "string" || !/^sb_secret_[A-Za-z0-9_-]+$/.test(secretKey)) throw new Error("Configure separate publishable and server secret keys.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 15e3) throw new Error("Configure a bounded private request deadline.");
  const actor = (id) => {
    if (!UUID3.test(id || "")) throw new Error("A verified actor is required.");
    return id;
  };
  const conversationWorkspace = (id) => {
    if (typeof id !== "string" || !id || id.length > 200) throw new Error("Choose the admitted private workspace.");
    return id;
  };
  async function request(path, { key = secretKey, token, body } = {}) {
    const controller = new AbortController();
    let timer;
    const expired = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("Private request timed out."));
      }, timeoutMs);
    });
    const execute = async () => {
      const response = await fetchImpl(new URL(path, base).href, { method: body === void 0 ? "GET" : "POST", headers: { apikey: key, ...token ? { Authorization: "Bearer " + token } : {}, ...body === void 0 ? {} : { "Content-Type": "application/json" } }, ...body === void 0 ? {} : { body: JSON.stringify(body) }, redirect: "error", signal: controller.signal });
      if (controller.signal.aborted) {
        void response.body?.cancel().catch(() => {
        });
        controller.signal.throwIfAborted();
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {
        });
        if (token && (response.status === 401 || response.status === 403)) return null;
        throw new Error("Remote request failed.");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body.");
      const chunks = [];
      let size = 0;
      const cancel = () => {
        void reader.cancel().catch(() => {
        });
      };
      controller.signal.addEventListener("abort", cancel, { once: true });
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 1e7) {
            void reader.cancel().catch(() => {
            });
            throw new Error("Response is too large.");
          }
          chunks.push(part.value);
        }
      } finally {
        controller.signal.removeEventListener("abort", cancel);
        reader.releaseLock();
      }
      controller.signal.throwIfAborted();
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer));
    };
    try {
      return await Promise.race([execute(), expired]);
    } catch {
      throw new Error("Supabase could not confirm the request. No edit has been acknowledged.");
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    admit: ({ owner }) => request("/rest/v1/rpc/plan_sync_admit", { body: { p_owner: actor(owner) } }),
    async verifySession(token) {
      if (typeof token !== "string" || !token || token.length > 1e4 || /\s/.test(token)) return null;
      const user = await request("/auth/v1/user", { key: publishableKey, token });
      if (!user || !UUID3.test(user.id || "") || user.is_anonymous !== false) return null;
      let claims;
      try {
        const parts = token.split(".");
        if (parts.length !== 3 || parts.some((p) => !p || !/^[A-Za-z0-9_-]+$/.test(p))) return null;
        claims = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(parts[1], "base64url")));
      } catch {
        return null;
      }
      if (!claims || claims.sub !== user.id || claims.iss !== base.origin + "/auth/v1" || claims.role !== "authenticated" || claims.is_anonymous !== false || !UUID3.test(claims.session_id || "") || !Number.isSafeInteger(claims.exp) || claims.exp * 1e3 <= now()) return null;
      const active = await request("/rest/v1/rpc/plan_session_active", { body: { p_owner: user.id, p_session: claims.session_id } });
      if (active !== true || claims.exp * 1e3 <= now()) return null;
      return { id: user.id, is_anonymous: false };
    },
    store: {
      bootstrap: async (owner, command2) => {
        const checked = await validateBootstrap({ workspace: command2.workspace, requestId: command2.requestId, records: command2.records, review: { confirmed: true, destination: base.origin, payloadDigest: command2.payloadDigest } }, base.origin);
        return request("/rest/v1/rpc/plan_bootstrap_validated_workspace", { body: { p_owner: actor(owner), p_workspace: checked.workspace, p_request: checked.requestId, p_digest: checked.payloadDigest, p_records: checked.records } });
      },
      read: (owner, workspace) => request("/rest/v1/rpc/plan_read_validated_workspace", { body: { p_owner: actor(owner), p_workspace: workspace } }),
      apply: (owner, command2) => {
        validateEnvelope(command2);
        return request("/rest/v1/rpc/plan_apply_validated_operation", { body: { p_owner: actor(owner), p_workspace: command2.workspace, p_operation: command2.operationId, p_expected_version: command2.expectedVersion, p_kind: command2.type, p_patches: command2.patches } });
      }
    },
    conversations: {
      save: ({ owner, requestId, workspace, question, answer }) => {
        if (!UUID3.test(requestId || "") || typeof question !== "string" || !question.trim() || new TextEncoder().encode(question).byteLength > 2e4 || typeof answer !== "string" || !answer.trim() || new TextEncoder().encode(answer).byteLength > 1e5) throw new Error("Use the admitted question and bounded final answer.");
        return request("/rest/v1/rpc/plan_ai_save_conversation", { body: { p_owner: actor(owner), p_request: requestId, p_workspace: conversationWorkspace(workspace), p_question: question, p_answer: answer } });
      },
      read: ({ owner, workspace, before = null, limit = 20 }) => {
        if (before !== null && !UUID3.test(before) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Choose a bounded private conversation history page.");
        return request("/rest/v1/rpc/plan_ai_read_conversations", { body: { p_owner: actor(owner), p_workspace: conversationWorkspace(workspace), p_before: before, p_limit: limit } });
      }
    },
    ledger: {
      reserve: ({ owner, requestId, reservedMicroUsd, configurationHash, workspaceDigest, summaryDigest, promptDigest }) => request("/rest/v1/rpc/plan_ai_reserve", { body: { p_owner: actor(owner), p_id: requestId, p_amount: reservedMicroUsd, p_configuration_hash: configurationHash, p_workspace_digest: workspaceDigest, p_summary_digest: summaryDigest, p_prompt_digest: promptDigest } }),
      settle: ({ owner, requestId, status, chargedMicroUsd }) => request("/rest/v1/rpc/plan_ai_settle", { body: { p_owner: actor(owner), p_id: requestId, p_status: status, p_charged: chargedMicroUsd } })
    }
  };
}

// server/sync-service.mjs
var UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function syncService({ verifySession, store, destination }) {
  if (typeof verifySession !== "function" || typeof store?.read !== "function" || typeof store?.apply !== "function") throw new Error("Provide a verified session and private store adapter.");
  const actor = async (token) => {
    if (typeof token !== "string" || !token || token.length > 1e4) throw new Error("Sign in with a permanent account.");
    const user = await verifySession(token);
    if (!user || !UUID4.test(user.id || "") || user.is_anonymous !== false) throw new Error("Sign in with a verified permanent account.");
    return user.id;
  };
  const workspace = (id) => {
    if (typeof id !== "string" || !id || id.length > 200) throw new Error("Invalid workspace.");
    return id;
  };
  return {
    async bootstrap({ token, request }) {
      const owner = await actor(token), command2 = await validateBootstrap(request, destination);
      if (typeof store.bootstrap !== "function") throw new Error("Reviewed first upload is not configured.");
      const result = await store.bootstrap(owner, command2);
      if (!result || !["initialized", "duplicate", "conflict"].includes(result.status) || !Number.isSafeInteger(result.version) || result.version < 1 || result.status === "initialized" && result.version !== 1) throw new Error("The database did not confirm the first upload. Read and review cloud records before continuing.");
      return { status: result.status, version: result.version };
    },
    async read({ token, workspace: id }) {
      const owner = await actor(token), snapshot = await store.read(owner, workspace(id));
      if (!snapshot) return null;
      if (snapshot.workspace !== id) throw new Error("The store returned a different workspace.");
      hydrateSnapshot(snapshot);
      const result = clone(snapshot);
      const legacy = result.records.find((r) => r.collection === "preferences" && r.key === "profile")?.value?.legacy;
      if (legacy?.rawText) legacy.raw = JSON.parse(legacy.rawText);
      return result;
    },
    async apply({ token, request }) {
      const owner = await actor(token);
      validateEnvelope(request);
      const command2 = clone(request), snapshot = await store.read(owner, command2.workspace);
      if (!snapshot) throw new Error("Review and initialize this workspace before sending incremental edits.");
      if (snapshot.workspace !== command2.workspace) throw new Error("The store returned a different workspace.");
      const current = hydrateSnapshot(snapshot), previous = (snapshot.operations || []).find((o) => o.id === command2.operationId);
      if (previous) {
        if (previous.type !== command2.type || !sameJson(previous.patches, command2.patches)) throw new Error("An operation ID cannot be reused for different content.");
        return { status: "duplicate", version: current.version };
      }
      if (command2.expectedVersion !== current.version) return { status: "conflict", version: current.version };
      validateOperation(current, command2);
      const result = await store.apply(owner, command2);
      if (!result || !["applied", "duplicate", "conflict"].includes(result.status) || !Number.isSafeInteger(result.version) || result.version < 0 || result.status === "applied" && result.version !== current.version + 1) throw new Error("The database did not confirm a valid operation result.");
      return { status: result.status, version: result.version };
    }
  };
}

// server/private-http.mjs
var MAX_BODY = 2e6;
var Rejected = class extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
};
function reply(status, value) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store, private", "pragma": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "vary": "Origin, Authorization" } });
}
async function readJson(request, timeoutMs) {
  if (request.headers.get("content-encoding") && !/^identity$/i.test(request.headers.get("content-encoding"))) throw new Rejected(415, "unsupported_encoding");
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") || "")) throw new Rejected(415, "json_required");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY)) throw new Rejected(413, "request_too_large");
  if (!request.body) throw new Rejected(400, "invalid_request");
  const reader = request.body.getReader(), chunks = [];
  let size = 0, timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Rejected(408, "request_timeout"));
      void reader.cancel().catch(() => {
      });
    }, timeoutMs);
  });
  const collect = (async () => {
    for (; ; ) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        void reader.cancel().catch(() => {
        });
        throw new Rejected(413, "request_too_large");
      }
      chunks.push(value);
    }
    if (declared !== null && Number(declared) !== size) throw new Rejected(400, "invalid_length");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new Rejected(400, "invalid_json");
    }
  })();
  try {
    return await Promise.race([collect, expired]);
  } finally {
    clearTimeout(timer);
  }
}

// server/sync-http.mjs
var UUID5 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var MAX_RESPONSE = 4e6;
function command(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Rejected(400, "invalid_request");
  const keys = Object.keys(body), read = body.action === "read", write = ["apply", "bootstrap"].includes(body.action);
  if (!read && !write || keys.length !== 2 || !keys.includes("action") || !keys.includes(read ? "workspace" : "request")) throw new Rejected(400, "invalid_request");
  if (read && (typeof body.workspace !== "string" || !body.workspace || body.workspace.length > 200)) throw new Rejected(400, "invalid_request");
  if (write && (!body.request || typeof body.request !== "object" || Array.isArray(body.request))) throw new Rejected(400, "invalid_request");
  return body;
}
function createSyncHttpHandler({ origin, verifySession, store, destination, admit, bodyTimeoutMs = 1e4 }) {
  let pinned;
  try {
    pinned = new URL(origin);
  } catch {
    throw new Error("Configure the exact private HTTPS app origin.");
  }
  if (pinned.protocol !== "https:" || pinned.origin !== origin || pinned.username || pinned.password) throw new Error("Configure the exact private HTTPS app origin.");
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 1 || bodyTimeoutMs > 1e4) throw new Error("Invalid request read timeout.");
  syncService({ verifySession, store, destination });
  if (typeof admit !== "function") throw new Error("Configure a trusted durable account rate limit before attaching this route.");
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (url.origin !== origin || url.pathname !== "/api/plan/sync" || url.search) throw new Rejected(404, "not_found");
      if (request.method !== "POST") return reply(405, { error: "post_required" });
      if (request.headers.get("origin") !== origin || !["same-origin", "none", null].includes(request.headers.get("sec-fetch-site"))) throw new Rejected(403, "origin_rejected");
      const authorization = request.headers.get("authorization") || "";
      if (!/^Bearer [A-Za-z0-9._~-]{1,10000}$/.test(authorization)) throw new Rejected(401, "sign_in_required");
      const token = authorization.slice(7);
      let user;
      try {
        user = await verifySession(token);
      } catch {
        throw new Rejected(503, "sign_in_unavailable");
      }
      if (!user || !UUID5.test(user.id || "") || user.is_anonymous !== false) throw new Rejected(401, "sign_in_required");
      const actor = { id: user.id, is_anonymous: false };
      let admission;
      try {
        admission = await admit({ owner: actor.id });
      } catch {
        throw new Rejected(503, "sync_unavailable");
      }
      if (!admission || typeof admission.allowed !== "boolean") throw new Rejected(503, "sync_unavailable");
      if (!admission.allowed) {
        const retry = Number.isInteger(admission.retryAfterSeconds) && admission.retryAfterSeconds >= 1 && admission.retryAfterSeconds <= 3600 ? admission.retryAfterSeconds : 60, response = reply(429, { error: "rate_limited", retryAfterSeconds: retry });
        response.headers.set("retry-after", String(retry));
        return response;
      }
      const input = command(await readJson(request, bodyTimeoutMs));
      let current;
      try {
        current = await verifySession(token);
      } catch {
        throw new Rejected(503, "sign_in_unavailable");
      }
      if (!current || current.id !== actor.id || current.is_anonymous !== false) throw new Rejected(401, "sign_in_required");
      const service = syncService({ verifySession: async () => actor, store, destination });
      let result;
      try {
        result = input.action === "read" ? await service.read({ token, workspace: input.workspace }) : await service[input.action]({ token, request: input.request });
      } catch {
        return reply(422, { error: "review_required", message: "The request was not confirmed. Read and review records before retrying." });
      }
      const output = JSON.stringify({ action: input.action, result });
      if (new TextEncoder().encode(output).byteLength > MAX_RESPONSE) throw new Rejected(413, "response_too_large");
      return reply(result?.status === "conflict" ? 409 : 200, JSON.parse(output));
    } catch (error) {
      return error instanceof Rejected ? reply(error.status, { error: error.code }) : reply(500, { error: "request_failed" });
    }
  };
}

// server/sync-route.mjs
var unavailable = () => Response.json({ error: "private_sync_not_configured" }, { status: 503, headers: { "cache-control": "no-store, private", "pragma": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "vary": "Origin, Authorization" } });
function configuredSyncRoute({ env = {}, fetchImpl = globalThis.fetch } = {}) {
  if (env.PLAN_PRIVATE_SYNC_ENABLED !== "true" || env.PLAN_PRIVATE_DATABASE_VERIFIED !== "true") return async () => unavailable();
  try {
    const adapter = supabaseAdapter({ url: env.PLAN_SUPABASE_URL, publishableKey: env.PLAN_SUPABASE_PUBLISHABLE_KEY, secretKey: env.PLAN_SUPABASE_SECRET_KEY, fetchImpl });
    return createSyncHttpHandler({ origin: env.PLAN_APP_ORIGIN, destination: new URL(env.PLAN_SUPABASE_URL).origin, verifySession: adapter.verifySession, store: adapter.store, admit: adapter.admit });
  } catch {
    return async () => unavailable();
  }
}

// server/sync-entry.mjs
var handle = configuredSyncRoute({ env: process.env });
var sync_entry_default = { fetch: (request) => handle(request) };
export {
  sync_entry_default as default
};
