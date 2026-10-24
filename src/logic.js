"use strict";

function parseCSV(text) {
  const rows = []; let row = [], field = "", inQ = false;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) { if (c === '"') { if (s[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const clean = rows.filter(r => r.some(v => String(v).trim() !== ""));
  if (!clean.length) return [];
  const headers = clean[0].map(h => String(h).trim().toLowerCase().replace(/\s+/g, "_"));
  return clean.slice(1).map(r => { const o = {}; headers.forEach((h, idx) => { o[h] = r[idx] === undefined ? "" : String(r[idx]).trim(); }); return o; });
}
function csvEscape(v) { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
function toCSV(headers, rows) { return [headers.join(",")].concat(rows.map(r => headers.map(h => csvEscape(r[h])).join(","))).join("\n") + "\n"; }
function num(v) { if (v === "" || v === null || v === undefined) return null; const n = Number(String(v).replace(/[$,]/g, "")); return isFinite(n) ? n : null; }
function round2(n) { return Math.round(n * 100) / 100; }
function parseDate(v) { if (!v) return null; const d = new Date(String(v).trim() + "T00:00:00Z"); return isNaN(d.getTime()) ? null : d; }
function fmtDate(d) { return d ? d.toISOString().slice(0, 10) : ""; }
function daysBetween(a, b) { const da = parseDate(a), db = parseDate(b); if (!da || !db) return null; return Math.round((db.getTime() - da.getTime()) / 86400000); }

function parseScheduleEntries(v) {
  // each instalment is "amount" or "amount@YYYY-MM-DD"; the date is optional
  if (!v) return [];
  return String(v).split(";").map(x => x.trim()).filter(Boolean).map(x => {
    const at = x.indexOf("@");
    const amount = num(at >= 0 ? x.slice(0, at).trim() : x);
    const date = at >= 0 ? parseDate(x.slice(at + 1).trim()) : null;
    return amount === null ? null : { amount, date: date ? fmtDate(date) : "" };
  }).filter(x => x !== null);
}
function parseSchedule(v) { return parseScheduleEntries(v).map(e => e.amount); }
function fundingProjection(balance, monthlyDraft, offerAmount, referenceDate) {
  const bal = Number(balance) || 0, monthly = Number(monthlyDraft) || 0, offer = Number(offerAmount) || 0;
  const ref = parseDate(referenceDate) || new Date("2026-01-01T00:00:00Z");
  if (offer <= 0) return { funded: false, fundingDate: "", monthsNeeded: null };
  if (bal >= offer) return { funded: true, fundingDate: fmtDate(ref), monthsNeeded: 0 };
  if (monthly <= 0) return { funded: false, fundingDate: "", monthsNeeded: null };
  const months = Math.ceil((offer - bal) / monthly);
  const d = new Date(ref.getTime()); d.setUTCMonth(d.getUTCMonth() + months);
  return { funded: true, fundingDate: fmtDate(d), monthsNeeded: months };
}
function checkPack(row, config) {
  const cfg = config || {};
  const expectedFeePercent = cfg.expectedFeePercent !== undefined ? Number(cfg.expectedFeePercent) : null;
  const scheduleTolerance = cfg.scheduleTolerance !== undefined ? Number(cfg.scheduleTolerance) : 1;
  const feeTolerance = cfg.feeTolerance !== undefined ? Number(cfg.feeTolerance) : 1;
  const failed = [];
  const creditor = row.creditor || "";
  const enrolled = num(row.enrolled_balance), offer = num(row.offer_amount);
  const feeAmount = num(row.fee_amount), feePercent = num(row.fee_percent);
  const entries = parseScheduleEntries(row.payment_schedule);
  const schedule = entries.map(e => e.amount);
  const scheduleSum = round2(schedule.reduce((a, b) => a + b, 0));
  if (!creditor) failed.push("Missing creditor");
  if (enrolled === null || enrolled <= 0) failed.push("Missing or invalid enrolled_balance");
  if (offer === null || offer <= 0) failed.push("Missing or invalid offer_amount");
  if (!row.offer_expiry || !parseDate(row.offer_expiry)) failed.push("Missing or invalid offer_expiry");
  if (!schedule.length) failed.push("Missing payment_schedule");
  if (String(row.client_approval || "").toLowerCase() !== "yes") failed.push("Missing client approval");
  if (schedule.length && offer !== null && Math.abs(scheduleSum - offer) > scheduleTolerance) failed.push("Payment schedule sums to " + scheduleSum + ", not offer amount " + offer);
  const expiry = parseDate(row.offer_expiry);
  const dated = entries.filter(e => e.date);
  if (dated.length && expiry) {
    const latest = dated.reduce((a, b) => a.date > b.date ? a : b);
    if (parseDate(latest.date) > expiry) failed.push("Final payment " + latest.date + " lands after offer expiry " + row.offer_expiry);
  }
  let expectedFeeAmount = null;
  if (enrolled !== null && feePercent !== null) {
    expectedFeeAmount = round2(enrolled * feePercent / 100);
    if (feeAmount === null) failed.push("Missing fee_amount");
    else if (Math.abs(feeAmount - expectedFeeAmount) > feeTolerance) failed.push("Fee amount " + feeAmount + " does not match " + feePercent + "% of enrolled balance (" + expectedFeeAmount + ")");
  } else if (feeAmount === null || feePercent === null) failed.push("Missing fee_amount or fee_percent");
  if (expectedFeePercent !== null && feePercent !== null && Math.abs(feePercent - expectedFeePercent) > 0.001) failed.push("Fee percent " + feePercent + " does not match expected fee percent " + expectedFeePercent);
  let funding = { funded: false, fundingDate: "", monthsNeeded: null };
  if (offer !== null && offer > 0) {
    funding = fundingProjection(cfg.accountBalance || 0, cfg.monthlyDraft || 0, offer, cfg.referenceDate || "2026-01-01");
    if (!funding.funded) failed.push("Dedicated account cannot fund this offer on current drafts");
    else if (row.offer_expiry && parseDate(row.offer_expiry) && funding.fundingDate > row.offer_expiry) failed.push("Expiry risk: account can fund on " + funding.fundingDate + ", after offer expiry " + row.offer_expiry);
  }
  return { packId: row.pack_id || "", clientRef: row.client_ref || "", creditor, enrolledBalance: enrolled, offerAmount: offer, offerExpiry: row.offer_expiry || "", scheduleSum, expectedFeeAmount, feeAmount, feePercent, fundingDate: funding.fundingDate, status: failed.length ? "FAIL" : "PASS", failedChecks: failed };
}
function auditPacks(rows, config) { const results = (rows || []).map(r => checkPack(r, config)); return { results, summary: { total: results.length, pass: results.filter(r => r.status === "PASS").length, fail: results.filter(r => r.status === "FAIL").length } }; }
function buildClientSummary(row, result) {
  const offer = num(row.offer_amount) || 0, fee = num(row.fee_amount) || 0;
  const lines = [
    "Settlement offer summary for " + (row.client_ref || "client"),
    "",
    "What you will pay: " + offer.toFixed(2),
    "To whom: " + (row.creditor || "the creditor listed in your offer pack"),
    "By when: the offer expires on " + (row.offer_expiry || "the date in your offer pack") + ". Payments follow this schedule: " + (row.payment_schedule || "") + ".",
    "What the fee is: " + fee.toFixed(2) + (row.fee_percent ? " (" + row.fee_percent + "% of your enrolled balance)" : ""),
    "Total cost: " + (offer + fee).toFixed(2) + " (offer amount plus fee)",
    "",
    "Please review this summary with your program team before you approve. This is an operations checklist summary, not legal or financial advice."
  ];
  return lines.join("\n");
}
function toAuditCSV(results) { return toCSV(["pack_id","client_ref","creditor","offer_amount","schedule_sum","funding_date","status","failed_checks"], (results||[]).map(r => ({ pack_id: r.packId, client_ref: r.clientRef, creditor: r.creditor, offer_amount: r.offerAmount, schedule_sum: r.scheduleSum, funding_date: r.fundingDate, status: r.status, failed_checks: r.failedChecks.join("; ") }))); }
const api = { parseCSV, parseSchedule, parseScheduleEntries, fundingProjection, checkPack, auditPacks, buildClientSummary, toAuditCSV };
if (typeof module !== "undefined" && module.exports) { module.exports = api; }
if (typeof window !== "undefined") { window.SettlementOfferPackChecker = api; }
