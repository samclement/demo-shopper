import { trace } from "@opentelemetry/api";
import pino from "pino";
import { closeEvents, declaredSubscriptions, subscribe } from "./events.js";

// A background worker: no web address. It does one unit of work every WORK_INTERVAL_MS
// (default a minute); replace work() with the app's job. The platform restarts it if it exits.
const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

const serviceName = process.env.OTEL_SERVICE_NAME ?? "swhurl-app";
const intervalMs = Number.parseInt(process.env.WORK_INTERVAL_MS ?? "60000", 10);
const tracer = trace.getTracer(serviceName);

async function work(): Promise<void> {
  await tracer.startActiveSpan("work", async (span) => {
    try {
      logger.info({ trace_id: span.spanContext().traceId }, "work done");
    } catch (error) {
      logger.error({ err: error }, "work failed");
      span.recordException(error as Error);
    } finally {
      span.end();
    }
  });
}

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
