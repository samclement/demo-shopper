// One visit to the shop, against a stand-in for demo-shop (npm run build first).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const seen = [];
const stub = http.createServer((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    seen.push({ method: request.method, url: request.url, body });
    response.writeHead(request.method === "POST" ? 201 : 200, { "content-type": "application/json" });
    response.end("{}");
  });
});
await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));
// The worker module starts working when it is loaded: a long interval keeps it to the one run at start.
Object.assign(process.env, { WORK_INTERVAL_MS: "3600000", SWHURL_SERVICE_DEMO_SHOP_URL: `http://127.0.0.1:${stub.address().port}` });
const { visitShop } = await import("../dist/worker.js");

test("a visit buys a small quantity of something, then looks at the shop", async (t) => {
  t.after(() => { stub.close(); process.kill(process.pid, "SIGTERM"); });
  // The worker's own first visit, made when the module loaded, must be over before this one is counted.
  for (let waited = 0; seen.length < 2 && waited < 5000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
  seen.length = 0;
  const visit = await visitShop();
  assert.equal(visit.status, 201);
  const [buy, look] = seen.slice(-2);
  assert.deepEqual([buy.method, buy.url, look.method, look.url], ["POST", "/api/buy", "GET", "/api/shop"]);
  const { item, quantity } = JSON.parse(buy.body);
  assert.ok(["tea", "coffee", "biscuits", "milk", "sugar"].includes(item));
  assert.ok(quantity >= 1 && quantity <= 3, "small on purpose: ten or more would notify the team");
  assert.equal(visit.bought, `${quantity} ${item}`);
});
