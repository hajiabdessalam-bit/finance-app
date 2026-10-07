// app/core.mjs
var SCHEMA = 2;
var clone = (value) => structuredClone(value);
var fail = (message) => {
  throw new Error(message);
};
var object = (v) => v && typeof v === "object" && !Array.isArray(v);
var own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
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
function transactionPeriod(s, t) {
  return t.historical && t.legacyPeriod ? t.legacyPeriod : workspacePeriod(s, t.date);
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
    for (const p of purchases) {
      const t = s.transactions.find((t2) => t2.id === p.transaction);
      validMoney(p.amount, "Purchase cost");
      dateKey(p.date);
      if (!t || t.kind !== "expense" || t.amount !== p.amount || t.date !== p.date || seen.has(p.transaction)) fail("Purchase history does not match the ledger.");
      seen.add(p.transaction);
      if (p.complete != null && typeof p.complete !== "boolean") fail("Invalid purchase completion flag.");
      if (p.reversedBy && !s.transactions.some((t2) => t2.id === p.reversedBy && t2.reverses === p.transaction)) fail("Invalid purchase correction.");
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
      if (!t || t.historical || t.amount !== o.amount || t.date !== o.date || t.account !== o.account || t.kind !== (o.kind === "gift" ? "expense" : "loan-out")) fail("Outside payment does not match its cash entry.");
      if (o.reversedBy && !s.transactions.some((t2) => t2.id === o.reversedBy && t2.reverses === o.transaction)) fail("Invalid outside payment correction.");
    }
    if (o.returns) {
      if (!Array.isArray(o.returns)) fail("Invalid return history.");
      unique(o.returns, "returns");
      let total = 0;
      for (const r of o.returns) {
        const t = s.transactions.find((t2) => t2.id === r.transaction);
        if (!t || t.kind !== "loan-return" || t.amount !== r.amount || t.date !== r.date) fail("Outside return does not match its cash entry.");
        if (r.reversedBy) {
          if (!s.transactions.some((t2) => t2.id === r.reversedBy && t2.reverses === r.transaction)) fail("Invalid outside return correction.");
        } else total += r.amount;
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
    if (s.legacy.rawText && JSON.stringify(JSON.parse(s.legacy.rawText)) !== JSON.stringify(s.legacy.raw)) fail("Preserved original backup differs from its records.");
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
function periodForecast(s, key, { mode = "budget", extraExpense = 0, incomeChange = 0 } = {}) {
  const budgets = s.budgets.slice().sort((a, b2) => a.key.localeCompare(b2.key));
  const b = budgets.find((b2) => b2.key === key) || budgets.filter((b2) => b2.key <= key).at(-1) || budgets[0];
  if (!b) return { income: 0, spending: 0, buffer: 0, capacity: 0, confidence: "No budget", assumptions: ["Set a salary and spending budget."], budget: null };
  const spendCats = s.categories.filter((c) => !["savings", "buffer"].includes(c.type));
  const reversed = new Set(s.transactions.filter((t) => t.reverses).map((t) => t.reverses));
  const recorded = s.transactions.filter((t) => !reversed.has(t.id) && transactionPeriod(s, t) === key);
  const actualFor = (id) => recorded.reduce((n, t) => {
    const amount = t.splits ? t.splits.filter((p) => p.category === id).reduce((a, b2) => a + b2.amount, 0) : t.category === id ? t.amount : 0;
    return n + (t.kind === "expense" ? amount : t.kind === "refund" ? -amount : 0);
  }, 0);
  let spending = spendCats.filter((c) => c.id !== "oneoff").reduce((n, c) => n + Math.max(b.alloc[c.id] || 0, actualFor(c.id)), 0), buffer = b.alloc.buffer || 0;
  const outside = s.outside.filter((o) => o.kind !== "borrowed" && !o.reversedBy && workspacePeriod(s, o.date) === key && !recorded.some((t) => t.id === o.transaction && t.kind === "expense")).reduce((n, o) => n + o.amount, 0);
  const oneoff = Math.max(0, actualFor("oneoff")) + outside;
  spending += Math.max(0, oneoff - (b.locks.buffer ? 0 : buffer));
  const ranges = [1, 2, 3].map((n) => addMonths(key, -n));
  const histories = ranges.map((k) => s.transactions.filter((t) => !t.historical && !reversed.has(t.id) && t.kind === "expense" && transactionPeriod(s, t) === k).reduce((n, t) => n + t.amount, 0));
  if (mode === "history" && histories.some((n) => n > 0)) spending = Math.max(spending, Math.round(histories.reduce((a, b2) => a + b2, 0) / histories.filter((n) => n > 0).length));
  if (mode === "conservative") spending = Math.ceil(spending * 1.15);
  const income = b.salary + incomeChange;
  const dates = workspacePeriodDates(s, key), requiresReview = dates.transition && b.key !== key;
  const bills = scheduledEvents(s, { from: dates.from, to: dates.to }).filter((o) => o.kind === "bill" && !o.paid && !o.skipped && !o.cancelled && !o.goal), mapped = /* @__PURE__ */ new Map();
  for (const bill of bills) if (bill.budgetCategory) mapped.set(bill.budgetCategory, (mapped.get(bill.budgetCategory) || 0) + bill.amount);
  const scheduledAdditional = bills.filter((o) => !o.budgetCategory).reduce((n, o) => n + o.amount, 0) + [...mapped].reduce((n, [id, amount]) => n + Math.max(0, amount + actualFor(id) - Math.max(b.alloc[id] || 0, actualFor(id))), 0);
  const committed = s.goals.filter((g) => g.completed && g.recurringCost && !g.recurringIncludedInBudget && !g.purchase?.reversedBy).reduce((n, g) => n + g.recurringCost, 0) + scheduledAdditional;
  return {
    income,
    spending,
    buffer,
    committed,
    requiresReview,
    capacity: income - spending - buffer - extraExpense - committed,
    confidence: "Budget assumption",
    budget: b,
    assumptions: [`Salary and budget from ${b.key}.`, "Regular spending is reserved even when not individually logged.", "Unpaid scheduled bills add commitments; explicitly linked bill categories use their budget allowance first.", "Borrowing and expected repayments are not recurring income.", mode === "conservative" ? "Spending increased by 15% for this scenario." : "Future income is not confirmed cash."]
  };
}
function goalPurchases(g) {
  return (g.purchases || [g.purchase].filter(Boolean)).filter((p) => !p.reversedBy);
}
function goalRemaining(g) {
  return Math.max(0, g.target - goalPurchases(g).reduce((n, p) => n + p.amount, 0));
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

// server/advisor.ts
var alias = (s, id) => `G${s.goals.findIndex((g) => g.id === id) + 1}`;
function advisorSummary(s) {
  validateState(s);
  const asOf = today(s.timezone), key = workspacePeriod(s, asOf), f = periodForecast(s, addMonths(key, 1)), active = s.goals.filter((g) => !g.archived);
  return { currency: s.currency, asOf, cash: summary(s, asOf), nextPeriod: { income: f.income, spending: f.spending, buffer: f.buffer, committed: f.committed || 0, capacity: f.capacity, requiresReview: !!f.requiresReview }, goals: active.slice(0, 50).map((g) => ({ alias: alias(s, g.id), target: goalRemaining(g), priority: g.priority, protected: !!g.protected, desired: g.desired || "", recurringCost: g.recurringCost || 0 })), goalCount: active.length, goalsOmitted: Math.max(0, active.length - 50), units: "Integer currency minor units; future capacity is an assumption." };
}

// server/advisor-budget.mjs
var UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var DIGEST = /^[a-f0-9]{64}$/;
function integer(value, label, max = 1e12) {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new Error(`${label} must be an exact, nonnegative integer.`);
  return value;
}
function worstCaseCost(config) {
  integer(config.maxInputTokens, "Input limit", 1e6);
  integer(config.maxOutputTokens, "Output limit", 1e6);
  integer(config.maxSteps, "Step limit", 10);
  if (!config.maxInputTokens || !config.maxOutputTokens || !config.maxSteps) throw new Error("Provide positive request limits.");
  const input = BigInt(integer(config.inputMicroUsdPerMillion, "Input price")), output = BigInt(integer(config.outputMicroUsdPerMillion, "Output price")), fixed = BigInt(integer(config.fixedMicroUsdPerStep, "Fixed fees"));
  const perStep = (BigInt(config.maxInputTokens) * input + BigInt(config.maxOutputTokens) * output + 999999n) / 1000000n + fixed;
  return integer(Number(perStep * BigInt(config.maxSteps)), "Reserved cost");
}
function budgetedAdvisor({ ledger, generate, configuration, configurationHash, now = () => Date.now() }) {
  if (typeof ledger?.reserve !== "function" || typeof ledger?.settle !== "function" || typeof generate !== "function" || !DIGEST.test(configurationHash || "")) throw new Error("Provide a durable budget ledger and reviewed provider configuration.");
  if (typeof configuration?.provider !== "string" || !configuration.provider || typeof configuration.model !== "string" || !configuration.model || configuration.supportedFinanceTraffic !== true) throw new Error("Confirm supported finance API access before configuring an advisor.");
  configuration = clone(configuration);
  const priceCheckedAt = Date.parse(configuration.priceCheckedAt);
  if (!Number.isFinite(priceCheckedAt)) throw new Error("Provide a recently checked provider price quote.");
  const reservedMicroUsd = worstCaseCost(configuration);
  return async ({ owner, requestId, workspaceDigest, summaryDigest, consent, summary: summary2, prompt }) => {
    if (!UUID4.test(owner || "") || !UUID4.test(requestId || "") || !DIGEST.test(workspaceDigest || "") || !DIGEST.test(summaryDigest || "")) throw new Error("Invalid authenticated request context.");
    const quoteAge = now() - priceCheckedAt;
    if (!Number.isFinite(quoteAge) || quoteAge < 0 || quoteAge > 864e5) throw new Error("Recheck provider prices before sending another request.");
    if (!consent || consent.confirmed !== true || consent.provider !== configuration.provider || consent.model !== configuration.model || consent.workspaceDigest !== workspaceDigest || consent.summaryDigest !== summaryDigest || consent.configurationHash !== configurationHash) throw new Error("Review this provider, model and current financial summary before sending.");
    const serialized = JSON.stringify(summary2);
    if (typeof serialized !== "string" || new TextEncoder().encode(serialized).length > 256e3 || await digest(serialized) !== summaryDigest || await digest(JSON.stringify(configuration)) !== configurationHash) throw new Error("The reviewed summary or provider configuration changed.");
    if (typeof prompt !== "string" || !prompt.trim() || new TextEncoder().encode(prompt).length > 4e3) throw new Error("Keep the planning question within 4,000 bytes.");
    const promptDigest = await digest(prompt);
    if (consent.promptDigest !== promptDigest) throw new Error("Review the exact planning question before sending.");
    const admission = await ledger.reserve({ owner, requestId, configurationHash, workspaceDigest, summaryDigest, promptDigest, reservedMicroUsd });
    if (admission?.status === "duplicate") return { status: "review", reason: "This request already exists. Review its saved result or uncertain charge." };
    if (admission?.status !== "reserved") throw new Error("The AI budget cannot cover this request. No model request was sent.");
    let response;
    try {
      response = await generate({ summary: JSON.parse(serialized), prompt, maxInputTokens: configuration.maxInputTokens, maxOutputTokens: configuration.maxOutputTokens, maxSteps: configuration.maxSteps });
    } catch {
      await ledger.settle({ owner, requestId, status: "uncertain", chargedMicroUsd: null });
      throw new Error("The provider did not confirm a result. Its budget reservation is held for review.");
    }
    const charged = response?.chargedMicroUsd;
    if (!Number.isSafeInteger(charged) || charged < 0 || charged > 1e12) {
      await ledger.settle({ owner, requestId, status: "uncertain", chargedMicroUsd: null });
      throw new Error("The provider did not confirm its complete charge. Its reservation is held for review.");
    }
    await ledger.settle({ owner, requestId, status: charged > reservedMicroUsd ? "overrun" : "complete", chargedMicroUsd: charged });
    if (charged > reservedMicroUsd) throw new Error("The provider exceeded its configured bound. Further requests require price and budget review.");
    return { status: "complete", result: response.result, chargedMicroUsd: charged };
  };
}

// server/advisor-service.mjs
var UUID5 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var configFields = ["provider", "model", "supportedFinanceTraffic", "priceCheckedAt", "maxInputTokens", "maxOutputTokens", "maxSteps", "inputMicroUsdPerMillion", "outputMicroUsdPerMillion", "fixedMicroUsdPerStep"];
async function advisorService({ verifySession, store, ledger, conversations, generate, configuration, now = () => Date.now() }) {
  if (typeof window !== "undefined" || typeof verifySession !== "function" || typeof store?.read !== "function" || typeof ledger?.reserve !== "function" || typeof ledger?.settle !== "function" || typeof conversations?.save !== "function" || typeof generate !== "function" || !configuration || Object.keys(configuration).some((key) => !configFields.includes(key))) throw new Error("Configure verified private AI dependencies without credentials in the public quote.");
  const config = clone(configuration), configurationHash = await digest(JSON.stringify(config)), reservedMicroUsd = worstCaseCost(config);
  const actor = async (token) => {
    const user = await verifySession(token);
    if (!UUID5.test(user?.id || "") || user.is_anonymous !== false) throw new Error("Sign in with a verified permanent account.");
    return user.id;
  };
  const freshQuote = () => {
    const age = now() - Date.parse(config.priceCheckedAt);
    if (!Number.isFinite(age) || age < 0 || age > 864e5) throw new Error("Recheck provider prices before reviewing or sending a question.");
  };
  const budgeted = budgetedAdvisor({ ledger, configuration: config, configurationHash, now, generate: async (input) => {
    freshQuote();
    const response = await generate(input), text = response?.result?.text;
    if (typeof text !== "string" || !text.trim() || new TextEncoder().encode(text).byteLength > 1e5) throw new Error("A bounded complete final answer is required.");
    return { result: { text }, chargedMicroUsd: response.chargedMicroUsd };
  } });
  async function prepare(owner, workspace, prompt, requestId) {
    freshQuote();
    if (typeof workspace !== "string" || !workspace || workspace.length > 200 || typeof prompt !== "string" || !prompt.trim() || new TextEncoder().encode(prompt).byteLength > 4e3 || !UUID5.test(requestId || "")) throw new Error("Review a workspace and a question of at most 4,000 bytes.");
    const snapshot = await store.read(owner, workspace);
    if (!snapshot || snapshot.workspace !== workspace || snapshot.version < 1) throw new Error("Initialize and review this private workspace first.");
    const state = hydrateSnapshot(clone(snapshot)), summary2 = advisorSummary(state);
    const review = {
      app: "plan-advisor-review",
      schema: 1,
      owner,
      workspace,
      version: state.version,
      requestId,
      prompt,
      summary: summary2,
      workspaceDigest: await digest(canonicalJson(state)),
      summaryDigest: await digest(JSON.stringify(summary2)),
      promptDigest: await digest(prompt),
      configurationHash,
      configuration: clone(config),
      reservedMicroUsd,
      recordsChanged: false
    };
    return { ...review, digest: await digest(canonicalJson(review)) };
  }
  return {
    history: async ({ token, workspace, before = null, limit = 20 }) => {
      const owner = await actor(token);
      if (typeof conversations.read !== "function" || typeof workspace !== "string" || !workspace || workspace.length > 200 || before !== null && !UUID5.test(before) || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Choose a bounded private history page.");
      const snapshot = await store.read(owner, workspace);
      if (!snapshot || snapshot.workspace !== workspace || snapshot.version < 1) throw new Error("Review the owned private workspace first.");
      const page = await conversations.read({ owner, workspace, before, limit });
      if (!page || !Array.isArray(page.messages) || page.messages.length > limit || page.nextCursor !== null && !UUID5.test(page.nextCursor || "")) throw new Error("Private history could not be verified.");
      const seen = /* @__PURE__ */ new Set();
      const messages = page.messages.map((message) => {
        if (!message || !UUID5.test(message.requestId || "") || seen.has(message.requestId) || typeof message.question !== "string" || !message.question.trim() || new TextEncoder().encode(message.question).byteLength > 2e4 || typeof message.answer !== "string" || !message.answer.trim() || new TextEncoder().encode(message.answer).byteLength > 1e5 || typeof message.at !== "string" || !Number.isFinite(Date.parse(message.at))) throw new Error("Private history could not be verified.");
        seen.add(message.requestId);
        return { requestId: message.requestId, question: message.question, answer: message.answer, at: message.at };
      });
      if (page.nextCursor !== null && messages.at(-1)?.requestId !== page.nextCursor) throw new Error("Private history could not be verified.");
      return { workspace, messages, nextCursor: page.nextCursor, recordsChanged: false };
    },
    preview: async ({ token, workspace, prompt }) => prepare(await actor(token), workspace, prompt, crypto.randomUUID()),
    ask: async ({ token, review, reviewDigest, confirmed = false }) => {
      const selected = clone(review);
      if (confirmed !== true) throw new Error("Review this question, exact summary, provider and maximum cost before sending.");
      const owner = await actor(token);
      if (selected?.app !== "plan-advisor-review" || selected.owner !== owner || selected.digest !== reviewDigest) throw new Error("Use the exact review for the signed-in account.");
      const current = await prepare(owner, selected.workspace, selected.prompt, selected.requestId);
      if (!sameJson(current, selected)) throw new Error("Records, question or provider quote changed. Prepare a fresh review.");
      const admittedWorkspace = selected.workspace, question = selected.prompt;
      const response = await budgeted({
        owner,
        requestId: selected.requestId,
        workspaceDigest: selected.workspaceDigest,
        summaryDigest: selected.summaryDigest,
        summary: selected.summary,
        prompt: question,
        consent: { confirmed: true, provider: config.provider, model: config.model, workspaceDigest: selected.workspaceDigest, summaryDigest: selected.summaryDigest, promptDigest: selected.promptDigest, configurationHash }
      });
      if (response.status !== "complete") return response;
      let historySaved = false;
      try {
        const saved = await conversations.save({ owner, requestId: selected.requestId, workspace: admittedWorkspace, question, answer: response.result.text });
        historySaved = ["saved", "duplicate"].includes(saved?.status);
      } catch {
      }
      return { status: "complete", text: response.result.text, chargedMicroUsd: response.chargedMicroUsd, historySaved, requestId: selected.requestId, workspace: admittedWorkspace, contextVersion: selected.version, summaryDigest: selected.summaryDigest, recordsChanged: false };
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

// server/advisor-http.mjs
var UUID6 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
var exact = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
function command(input) {
  if (exact(input, ["action", "workspace", "prompt"]) && input.action === "preview") return input;
  if (exact(input, ["action", "workspace", "before", "limit"]) && input.action === "history") return input;
  if (exact(input, ["action", "review", "reviewDigest", "confirmed"]) && input.action === "ask" && input.confirmed === true && typeof input.reviewDigest === "string" && /^[a-f0-9]{64}$/.test(input.reviewDigest) && input.review && typeof input.review === "object" && !Array.isArray(input.review)) return input;
  throw new Rejected(400, "invalid_request");
}
async function createAdvisorHttpHandler({ origin, verifySession, admit, bodyTimeoutMs = 1e4, ...dependencies }) {
  let pinned;
  try {
    pinned = new URL(origin);
  } catch {
    throw new Error("Configure the exact private HTTPS app origin.");
  }
  if (pinned.protocol !== "https:" || pinned.origin !== origin || pinned.username || pinned.password) throw new Error("Configure the exact private HTTPS app origin.");
  if (typeof verifySession !== "function" || typeof admit !== "function") throw new Error("Configure verified sessions and a durable private account rate limit.");
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 1 || bodyTimeoutMs > 1e4) throw new Error("Invalid request read timeout.");
  const service = await advisorService({ ...dependencies, verifySession });
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (url.origin !== origin || url.pathname !== "/api/plan/advisor" || url.search) throw new Rejected(404, "not_found");
      if (request.method !== "POST") return reply(405, { error: "post_required" });
      if (request.headers.get("origin") !== origin || !["same-origin", "none", null].includes(request.headers.get("sec-fetch-site"))) throw new Rejected(403, "origin_rejected");
      const authorization = request.headers.get("authorization") || "";
      if (!/^Bearer [A-Za-z0-9._~-]{1,10000}$/.test(authorization)) throw new Rejected(401, "sign_in_required");
      const token = authorization.slice(7);
      let actor;
      try {
        actor = await verifySession(token);
      } catch {
        throw new Rejected(503, "sign_in_unavailable");
      }
      if (!UUID6.test(actor?.id || "") || actor.is_anonymous !== false) throw new Rejected(401, "sign_in_required");
      let admission;
      try {
        admission = await admit({ owner: actor.id });
      } catch {
        throw new Rejected(503, "advisor_unavailable");
      }
      if (typeof admission?.allowed !== "boolean") throw new Rejected(503, "advisor_unavailable");
      if (!admission.allowed) {
        const retry = Number.isInteger(admission.retryAfterSeconds) && admission.retryAfterSeconds >= 1 && admission.retryAfterSeconds <= 3600 ? admission.retryAfterSeconds : 60;
        const response = reply(429, { error: "rate_limited", retryAfterSeconds: retry });
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
      if (current?.id !== actor.id || current?.is_anonymous !== false) throw new Rejected(401, "sign_in_required");
      let result;
      try {
        result = input.action === "preview" ? await service.preview({ token, workspace: input.workspace, prompt: input.prompt }) : input.action === "history" ? await service.history({ token, workspace: input.workspace, before: input.before, limit: input.limit }) : await service.ask({ token, review: input.review, reviewDigest: input.reviewDigest, confirmed: input.confirmed });
      } catch {
        return reply(422, { error: "review_required", message: "The answer or charge was not confirmed. Keep any cost hold, review the request and do not retry automatically." });
      }
      const output = JSON.stringify({ action: input.action, result });
      if (new TextEncoder().encode(output).byteLength > 1e6) throw new Rejected(413, "response_too_large");
      return reply(200, JSON.parse(output));
    } catch (error) {
      return error instanceof Rejected ? reply(error.status, { error: error.code }) : reply(500, { error: "request_failed" });
    }
  };
}

// server/advisor-route.mjs
var unavailable = () => Response.json({ error: "private_advisor_not_configured" }, { status: 503, headers: { "cache-control": "no-store, private", "pragma": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "vary": "Origin, Authorization" } });
async function configuredAdvisorRoute({ env = {}, fetchImpl = globalThis.fetch, generate, configuration } = {}) {
  if (env.PLAN_PRIVATE_DATABASE_VERIFIED !== "true" || env.PLAN_PRIVATE_ADVISOR_ENABLED !== "true" || env.PLAN_AI_PROVIDER_VERIFIED !== "true" || typeof generate !== "function" || !configuration) return async () => unavailable();
  try {
    const adapter = supabaseAdapter({ url: env.PLAN_SUPABASE_URL, publishableKey: env.PLAN_SUPABASE_PUBLISHABLE_KEY, secretKey: env.PLAN_SUPABASE_SECRET_KEY, fetchImpl });
    return await createAdvisorHttpHandler({ origin: env.PLAN_APP_ORIGIN, verifySession: adapter.verifySession, admit: adapter.admit, store: adapter.store, ledger: adapter.ledger, conversations: adapter.conversations, generate, configuration });
  } catch {
    return async () => unavailable();
  }
}

// server/advisor-entry.mjs
var handle = await configuredAdvisorRoute({ env: process.env });
var advisor_entry_default = { fetch: (request) => handle(request) };
export {
  advisor_entry_default as default
};
