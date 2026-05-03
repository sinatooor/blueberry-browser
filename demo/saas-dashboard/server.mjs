// Tiny zero-dep dashboard server.
// Serves index.html, /api/v1/revenue?range=12m, /api/v1/billing-events.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);

const months = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Synthetic 12 months with a clear October dip.
const baseRevenue = 120_000;
function buildRevenue() {
  const now = new Date();
  const series = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthLabel = `${months[d.getMonth()]} ${d.getFullYear()}`;
    const trend = baseRevenue + (11 - i) * 4_500;
    const seasonal = Math.sin((d.getMonth() / 12) * Math.PI * 2) * 6_000;
    let revenue = Math.round(trend + seasonal);
    if (d.getMonth() === 9) revenue = Math.round(revenue * 0.62); // 38% dip in October
    series.push({ month: monthLabel, revenue });
  }
  return series;
}

function buildBillingEvents() {
  const now = new Date();
  // Failed-payment spike Oct 4-7
  const events = [];
  for (let i = 0; i < 14; i++) {
    const day = new Date(now.getFullYear(), 9, i + 1);
    const failed =
      [3, 4, 5, 6].includes(i) ? 38 + Math.floor(Math.random() * 12) : 4 + Math.floor(Math.random() * 6);
    events.push({
      date: day.toISOString().slice(0, 10),
      failed_payments: failed,
      successful_payments: 200 + Math.floor(Math.random() * 50),
    });
  }
  return events;
}

const REVENUE = buildRevenue();
const BILLING = buildBillingEvents();

const HTML = `<!doctype html>
<html><head>
  <meta charset="utf-8" />
  <title>Acme Analytics — SaaS investigation demo</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; margin: 0; padding: 24px; background: #fafafa; color: #111; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .sub { color: #666; font-size: 13px; margin-bottom: 24px; }
    .card { background: white; border: 1px solid #e5e5e5; border-radius: 12px; padding: 20px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #f0f0f0; }
    th { font-weight: 600; color: #555; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
    .stat { font-size: 28px; font-weight: 600; }
    .label { color: #888; font-size: 12px; }
    .chart { height: 240px; position: relative; padding: 20px 8px 24px; }
    .bar { display: inline-block; width: 6.5%; margin: 0 0.5%; background: linear-gradient(180deg, #38bdf8, #0ea5e9); border-radius: 4px 4px 0 0; vertical-align: bottom; }
    .bar-label { font-size: 10px; color: #999; text-align: center; margin-top: 4px; }
    .row { display: flex; align-items: flex-end; height: 200px; }
    .row > div { flex: 1; text-align: center; }
    .axis { font-size: 10px; color: #aaa; }
    button { background: #0ea5e9; color: white; border: 0; border-radius: 6px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
    button:hover { background: #0284c7; }
  </style>
</head><body>
  <h1>Acme Analytics</h1>
  <div class="sub">Q4 — SaaS revenue & billing</div>
  <div class="grid">
    <div class="card">
      <div class="label">Monthly revenue (last 12 months)</div>
      <div class="chart" id="chart"></div>
      <div style="text-align:right;"><button id="exportBtn">Export CSV</button></div>
    </div>
    <div class="card">
      <div class="label">Total — last 12 months</div>
      <div class="stat" id="total">…</div>
      <div class="label" style="margin-top: 12px;">YoY change</div>
      <div class="stat" id="yoy">…</div>
    </div>
  </div>
  <div class="card">
    <div class="label" style="margin-bottom: 8px;">Billing events — October</div>
    <table id="billing"><thead><tr><th>Date</th><th>Failed payments</th><th>Successful payments</th></tr></thead><tbody></tbody></table>
  </div>

<script>
async function load() {
  const r = await fetch('/api/v1/revenue?range=12m').then(r => r.json());
  const max = Math.max(...r.series.map(s => s.revenue));
  const chart = document.getElementById('chart');
  chart.innerHTML = '<div class="row">' + r.series.map(s => {
    const h = Math.round((s.revenue / max) * 200);
    return '<div><div class="bar" style="height:' + h + 'px"></div><div class="bar-label">' + s.month.split(' ')[0] + '</div></div>';
  }).join('') + '</div>';
  document.getElementById('total').textContent = '$' + r.series.reduce((a,b)=>a+b.revenue,0).toLocaleString();
  document.getElementById('yoy').textContent = '+' + ((r.series.at(-1).revenue / r.series[0].revenue - 1) * 100).toFixed(1) + '%';

  const b = await fetch('/api/v1/billing-events').then(r => r.json());
  document.querySelector('#billing tbody').innerHTML = b.events.map(e =>
    '<tr><td>' + e.date + '</td><td>' + e.failed_payments + '</td><td>' + e.successful_payments + '</td></tr>'
  ).join('');
}
load();

document.getElementById('exportBtn').addEventListener('click', async () => {
  const r = await fetch('/api/v1/revenue?range=12m').then(r => r.json());
  const csv = 'month,revenue\\n' + r.series.map(s => s.month + ',' + s.revenue).join('\\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'revenue-12m.csv';
  a.click();
});
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  if (!req.url) {
    res.writeHead(404);
    res.end();
    return;
  }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
    return;
  }
  if (url.pathname === "/api/v1/revenue") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ range: url.searchParams.get("range") ?? "12m", series: REVENUE }));
    return;
  }
  if (url.pathname === "/api/v1/billing-events") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ events: BILLING }));
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`[demo] dashboard at http://localhost:${PORT}`);
});
