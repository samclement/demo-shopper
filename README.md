# demo-shopper

> **A demo app of the swhurl platform.** With [demo-shop](https://github.com/samclement/demo-shop), [demo-orders](https://github.com/samclement/demo-orders) and [demo-notifier](https://github.com/samclement/demo-notifier) it shows how apps on the platform work together. This one shows:
>
> - **A worker.** No web address: `src/worker.ts` works every half minute (`WORK_INTERVAL_MS`).
> - **One app calling another as itself.** `swhurl.yaml` says `calls: [demo-shop]`; each visit buys one to three of something from demo-shop and looks at the shop, and demo-shop sees the caller as the app `demo-shopper`.
> - **Light, steady traffic.** About four requests a minute through demo-shop and demo-orders, and two events, so the demo apps' dashboards, traces and logs always have something to show. To pause it, scale the app to zero replicas on the platform.

Demo: a worker that buys something from demo-shop every half minute, so there is always some traffic

A TypeScript app on the [swhurl platform](https://github.com/samclement/swhurl-platform), made from the [swhurl TypeScript template](https://github.com/samclement/swhurl-app-template-typescript). Every push to `main` is checked, published to `ghcr.io/<owner>/demo-shopper` and deployed to staging; production changes through **Promote to production**. What the image must provide, the checks and the dependency updates: the [template's guide](https://github.com/samclement/swhurl-app-template-typescript#readme). What the app needs from the platform: [`swhurl.yaml`](swhurl.yaml).

A background worker with no web address: `src/worker.ts` runs `work()` every `WORK_INTERVAL_MS` (default a minute).

## Callers and calling other apps

`src/platform.ts` holds what the platform gives the app ([calling another app](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#calling-another-app)):

- **Calling another app.** Add `calls: [orders]` to `swhurl.yaml` before the app is created (afterwards: `make app-calls` on the platform, or the app page's **Calls** form). Then `await service("orders").fetch("/path")` reaches the same environment's `orders` with this app's token for it; the callee's spans join the same trace.

## Notifications

`await notify("Order backlog", { message: "412 orders waiting", priority: "high" })` (from `src/platform.ts`) sends a message to the notification channel of the team that owns this app ([notifications](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#notifications)). Nothing is declared in `swhurl.yaml`: the platform gives every app the address and a token. The message arrives titled `<app>/<env>: Order backlog`. The call resolves to whether the platform accepted it and never throws; an app may send 30 an hour, and a team without a channel delivers nothing. Locally there is no notify service: `notify` resolves to `false` and sends nothing.

## Events

`src/events.ts` publishes and receives events on the platform's NATS ([events](https://github.com/samclement/swhurl-platform/blob/main/docs/apps.md#events)). Declare them in `swhurl.yaml` before the app is created (afterwards: `make app-events` on the platform):

```yaml
events:
  publish: [created]               # other apps see demo-shopper.created
  subscribe: [orders.created]      # <app>.<event>
```

Then `await publish("created", data)` and `await subscribe("orders.created", async (event) => { ... })`. An event is a CloudEvents envelope (`event.data` is what was published); a handler runs inside the publisher's trace, and if it throws the event comes back, five tries in all. `src/worker.ts` logs every event it subscribes to: examples to replace. `subscribe` keeps trying until it is receiving, since a new app can start before NATS knows it. Locally there is no NATS: `publish` returns `null` and `subscribe` never calls back.

## Without the platform

Locally there are no platform keys or tokens: to call another app, set `SWHURL_SERVICE_<NAME>_URL` to a local stub.

The image build compiles and tests once. Matching merges to `main` publish the image that passed the pull request tests and smoke test; see the [template guide](https://github.com/samclement/swhurl-app-template-typescript#readme) for reuse checks and fallback builds.

## Local development

```bash
npm install
npm run dev                             # the SDK stays off locally (the image turns it on)
npm run check                           # type-check without writing JavaScript
npm run build && npm test               # the tests run against the built app
```

To see telemetry locally, `npm run build`, then `OTEL_TRACES_EXPORTER=console node --import ./dist/instrumentation.js dist/main.js` prints spans (or run an OpenTelemetry collector on `localhost:4318` and drop the variable).
