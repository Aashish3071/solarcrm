/**
 * Booklet §6.4: bank-statement import for UTR-based reconciliation. The
 * statement only *suggests* a match; Accounts still approves each payment (FR-010).
 */
export interface StatementLine {
  txnDate: string;
  amount: number;
  reference: string;
  narration: string;
}

/** Minimal RFC-4180 CSV parser: quoted fields, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const HEADERS = {
  date: ["txn date", "transaction date", "value date", "date", "posting date"],
  amount: ["credit", "deposit", "credit amount", "amount", "cr"],
  reference: ["utr", "utr no", "reference", "ref no", "reference no", "chq/ref no", "cheque/ref no", "transaction id"],
  narration: ["narration", "description", "remarks", "particulars", "details"],
};

const find = (header: string[], names: string[]) => {
  const h = header.map((x) => x.trim().toLowerCase().replace(/[._]/g, " ").replace(/\s+/g, " "));
  for (const n of names) {
    const i = h.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
};

const money = (s: string) => Number(s.replace(/[₹,\s]/g, "").replace(/cr$/i, ""));

/** Parses a statement with a header row. Returns credit lines only, plus readable errors. */
export function parseStatement(text: string): { lines: StatementLine[]; errors: string[] } {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  if (rows.length < 2) return { lines: [], errors: ["The file has no data rows."] };
  const [header, ...data] = rows;
  const col = {
    date: find(header, HEADERS.date),
    amount: find(header, HEADERS.amount),
    reference: find(header, HEADERS.reference),
    narration: find(header, HEADERS.narration),
  };
  const errors: string[] = [];
  if (col.date < 0) errors.push("No date column found (expected e.g. 'Txn Date' or 'Date').");
  if (col.amount < 0) errors.push("No credit/amount column found.");
  if (col.reference < 0 && col.narration < 0) errors.push("No UTR/reference or narration column found.");
  if (errors.length) return { lines: [], errors };

  const lines: StatementLine[] = [];
  data.forEach((r, i) => {
    const amount = money(r[col.amount] ?? "");
    if (!Number.isFinite(amount) || amount <= 0) return; // debits and blank credits are skipped
    const date = new Date(r[col.date] ?? "");
    if (Number.isNaN(date.getTime())) {
      errors.push(`Row ${i + 2}: unreadable date "${r[col.date]}".`);
      return;
    }
    lines.push({
      txnDate: date.toISOString().slice(0, 10),
      amount: Math.round(amount * 100) / 100,
      reference: (col.reference >= 0 ? r[col.reference] : "").trim(),
      narration: (col.narration >= 0 ? r[col.narration] : "").trim(),
    });
  });
  return { lines, errors };
}

export type MatchResult = "MATCHED" | "AMOUNT_MISMATCH" | "NOT_FOUND";

/** UTR must match (in the reference column or inside the narration); then the amount must match too. */
export function matchPayment(payment: { utr: string; amount: number }, lines: StatementLine[]): { result: MatchResult; line?: StatementLine } {
  const utr = payment.utr.trim().toUpperCase();
  if (!utr) return { result: "NOT_FOUND" };
  const hit = lines.find((l) => l.reference.toUpperCase() === utr || l.narration.toUpperCase().includes(utr));
  if (!hit) return { result: "NOT_FOUND" };
  return { result: Math.abs(hit.amount - payment.amount) < 0.01 ? "MATCHED" : "AMOUNT_MISMATCH", line: hit };
}
