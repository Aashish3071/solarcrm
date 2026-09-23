import { describe, expect, it } from "vitest";
import { matchPayment, parseCsv, parseStatement } from "./reconciliation";
import { messageFor } from "./notifications";

describe("CSV parsing", () => {
  it("handles quotes, commas and CRLF", () => {
    expect(parseCsv('a,"b,c","d ""q"""\r\n1,2,3\r\n')).toEqual([["a", "b,c", 'd "q"'], ["1", "2", "3"]]);
  });
});

describe("Booklet §6.4 bank statement import", () => {
  const csv = [
    "Txn Date,Narration,Chq/Ref No,Debit,Credit",
    '2026-09-20,"NEFT CR-HDFC0001-RAMESH KUMAR-N240926123456",N240926123456,,"81,000.00"',
    "2026-09-21,UPI/ACME/UPI998877,UPI998877,,45000",
    "2026-09-21,ATM WDL,,5000,",
    "bad-date,Something,X1,,10",
  ].join("\n");

  it("reads credits, skips debits and reports bad rows", () => {
    const { lines, errors } = parseStatement(csv);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ amount: 81000, reference: "N240926123456", txnDate: "2026-09-20" });
    expect(errors).toHaveLength(1);
  });

  it("refuses files without the needed columns", () => {
    expect(parseStatement("Foo,Bar\n1,2").errors.length).toBeGreaterThan(0);
  });

  it("matches by UTR and checks the amount", () => {
    const { lines } = parseStatement(csv);
    expect(matchPayment({ utr: "n240926123456", amount: 81000 }, lines).result).toBe("MATCHED");
    expect(matchPayment({ utr: "UPI998877", amount: 40000 }, lines).result).toBe("AMOUNT_MISMATCH");
    expect(matchPayment({ utr: "NOPE", amount: 1 }, lines).result).toBe("NOT_FOUND");
  });

  it("finds a UTR inside the narration when there is no reference column", () => {
    const { lines } = parseStatement("Date,Description,Amount\n2026-09-20,NEFT-XYZ-UTR777,1500");
    expect(matchPayment({ utr: "UTR777", amount: 1500 }, lines).result).toBe("MATCHED");
  });
});

describe("FR-044 messages", () => {
  it("customer messages are plain and addressed to them", () => {
    const m = messageFor("PAYMENT_VERIFIED", { customer: "Ramesh", code: "SLR-1" }, true);
    expect(m.body).toMatch(/^Hello Ramesh/);
  });
});
