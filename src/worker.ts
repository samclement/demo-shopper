import { trace } from "@opentelemetry/api";
import pino from "pino";
import { closeEvents, declaredSubscriptions, subscribe } from "./events.js";
import { watchFlags } from "./flags.js";
import { service } from "./platform.js";

// A background worker: no web address. Every WORK_INTERVAL_MS (default half a minute) it buys
// something from demo-shop and looks at the shop, as a person would. That keeps a little traffic
// flowing through the demo apps (demo-shop, demo-orders, the created event, demo-notifier), so
// their dashboards, traces and logs always have something to show.
const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

const serviceName = process.env.OTEL_SERVICE_NAME ?? "swhurl-app";
const intervalMs = Number.parseInt(process.env.WORK_INTERVAL_MS ?? "30000", 10);
const ITEMS = ["tea", "coffee", "biscuits", "milk", "sugar"];
const pick = <T>(choices: T[]): T => choices[Math.floor(Math.random() * choices.length)] as T;

// One visit to the shop: buy one to three of something, then look at the latest orders. demo-shop
// is called as another app would call it: this app declared the call (calls: [demo-shop]), so the
// platform gives it the shop's address and a token only the shop accepts. Quantities stay small on
// purpose: demo-notifier tells the team about an order of ten or more, and this must not.
export async function visitShop(): Promise<{ bought: string | null; status: number }> {
  const shop = service("demo-shop");
  const item = pick(ITEMS);
  const quantity = 1 + Math.floor(Math.random() * 3);
  const bought = await shop.fetch("/api/buy", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item, quantity }),
  });
  await bought.arrayBuffer();
  const looked = await shop.fetch("/api/shop");
  await looked.arrayBuffer();
  return { bought: bought.ok ? `${quantity} ${item}` : null, status: bought.status };
}
const tracer = trace.getTracer(serviceName);

async function work(): Promise<void> {
  await tracer.startActiveSpan("work", async (span) => {
    try {
      // A visit that fails (the shop is away, the call is not declared yet) is logged and tried
      // again next time: the worker keeps going.
      try {
        const visit = await visitShop();
        logger.info({ bought: visit.bought, status: visit.status, trace_id: span.spanContext().traceId }, "work done");
      } catch (error) {
        logger.warn({ err: error, trace_id: span.spanContext().traceId }, "the shop could not be visited");
        logger.info({ bought: null, trace_id: span.spanContext().traceId }, "work done");
      }
    } catch (error) {
      logger.error({ err: error }, "work failed");
      span.recordException(error as Error);
    } finally {
      span.end();
    }
  });
}

// Feature flag overrides set from the console (src/flagstore.ts).
watchFlags({
  onChange: (flag, value) => logger.info({ flag, value: value ?? null }, value === undefined ? "flag override cleared" : "flag override set"),
  onProblem: (error) => logger.warn({ err: error }, "flag overrides"),
});

const timer = setInterval(() => void work(), intervalMs);
void work();
logger.info({ service: serviceName, interval_ms: intervalMs }, "worker started");

// An example of receiving: log every event this app declared it subscribes to (events.subscribe in
// swhurl.yaml). Each is handled inside the publisher's trace; throw to receive it again.
for (const name of declaredSubscriptions()) {
  subscribe(name, (event) => {
    logger.info({ event_type: event.type, event_id: event.id, source: event.source,
      trace_id: trace.getActiveSpan()?.spanContext().traceId ?? null }, "event received");
  }, (error) => logger.warn({ err: error, subscription: name }, "not receiving yet; trying again"));
}

// Kubernetes sends SIGTERM before stopping the pod.
process.on("SIGTERM", () => {
  clearInterval(timer);
  logger.info("worker stopping");
  void closeEvents().finally(() => process.exit(0));
});
