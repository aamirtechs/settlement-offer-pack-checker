const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../src/logic.js");
const good = { pack_id:"P1", client_ref:"Client 001", creditor:"Creditor A", enrolled_balance:"10000", offer_amount:"4000", offer_expiry:"2027-06-01", payment_schedule:"1000;1000;2000", client_approval:"yes", fee_amount:"2500", fee_percent:"25", state:"FL" };
const cfg = { expectedFeePercent:25, accountBalance:5000, monthlyDraft:300, referenceDate:"2026-01-01" };
test("parseCSV parses offer rows", () => { const rows = L.parseCSV("pack_id,creditor\nP1,Creditor A\nP2,Bank Example"); assert.equal(rows.length,2); assert.equal(rows[1].creditor,"Bank Example"); });
test("parseSchedule splits semicolon amounts", () => { assert.deepEqual(L.parseSchedule("250;250;500"), [250,250,500]); });
test("complete pack passes", () => { const r = L.checkPack(good, cfg); assert.equal(r.status,"PASS"); assert.equal(r.scheduleSum,4000); });
test("missing creditor and approval fail with exact checks", () => { const r = L.checkPack({...good, creditor:"", client_approval:"no"}, cfg); assert.equal(r.status,"FAIL"); assert.ok(r.failedChecks.includes("Missing creditor")); assert.ok(r.failedChecks.includes("Missing client approval")); });
test("schedule that does not sum to offer fails", () => { const r = L.checkPack({...good, payment_schedule:"1000;1000"}, cfg); assert.ok(r.failedChecks.some(x=>x.includes("Payment schedule sums"))); });
test("fee amount mismatch on enrolled balance basis fails", () => { const r = L.checkPack({...good, fee_amount:"1000"}, cfg); assert.ok(r.failedChecks.some(x=>x.includes("does not match"))); assert.equal(r.expectedFeeAmount,2500); });
test("expected fee percent mismatch fails", () => { const r = L.checkPack({...good, fee_percent:"20", fee_amount:"2000"}, cfg); assert.ok(r.failedChecks.some(x=>x.includes("expected fee percent"))); });
test("expiry risk when funding date is after expiry", () => { const r = L.checkPack({...good, offer_expiry:"2026-03-01"}, { expectedFeePercent:25, accountBalance:0, monthlyDraft:100, referenceDate:"2026-01-01" }); assert.ok(r.failedChecks.some(x=>x.includes("Expiry risk"))); assert.equal(r.fundingDate,"2029-05-01"); });
test("funding projection when balance already covers offer", () => { const f = L.fundingProjection(5000,300,4000,"2026-01-01"); assert.equal(f.monthsNeeded,0); assert.equal(f.fundingDate,"2026-01-01"); });
test("client summary states payee, expiry, fee and total cost", () => { const s = L.buildClientSummary(good, L.checkPack(good,cfg)); assert.ok(s.includes("Creditor A")); assert.ok(s.includes("2027-06-01")); assert.ok(s.includes("Total cost: 6500.00")); });
test("audit summary and CSV export", () => { const a = L.auditPacks([good, {...good, pack_id:"P2", creditor:""}], cfg); assert.equal(a.summary.pass,1); assert.equal(a.summary.fail,1); assert.ok(L.toAuditCSV(a.results).includes("failed_checks")); });

test("fee basis is normalized and shown in the audit export", () => {
  assert.equal(L.normalizeFeeBasis("Enrolled Balance"), "enrolled_balance");
  assert.equal(L.normalizeFeeBasis("savings"), "savings");
  assert.equal(L.normalizeFeeBasis(""), "");
  const row = {
    pack_id: "p1", client_ref: "c1", creditor: "Bank",
    enrolled_balance: "10000", offer_amount: "5000", offer_expiry: "2026-06-01",
    payment_schedule: "1000;1000;1000;1000;1000", client_approval: "yes",
    fee_amount: "150", fee_percent: "1.5", fee_basis: "savings",
  };
  const result = L.checkPack(row, {});
  assert.equal(result.feeBasis, "savings");
  const csv = L.toAuditCSV([result]);
  assert.ok(csv.indexOf("fee_basis") !== -1);
  assert.ok(csv.indexOf("savings") !== -1);
});
