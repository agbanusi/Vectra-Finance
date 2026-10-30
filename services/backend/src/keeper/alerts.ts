import { BPS } from "@vectra/sdk";
import type { KeeperPolicy } from "../config.js";
import type { Logger } from "../util/log.js";
import { errorMessage } from "../util/log.js";
import { claimOf, isExpired, targetBalance } from "./decisions.js";
import type { IndexState } from "./state.js";

export type AlertSeverity = "info" | "warning" | "critical";

export type AlertCode =
  | "ADAPTER_UNHEALTHY"
  | "NAV_UNHEALTHY"
  | "DEPOSITS_PAUSED"
  | "REDEMPTIONS_PAUSED"
  | "SHUTDOWN"
  | "QUEUE_STALE"
  | "QUEUE_FLOOR_BLOCKED"
  | "LIQUIDITY_BELOW_BUFFER"
  | "TX_FAILED"
  | "KEEPER_ERROR";

export interface Alert {
  code: AlertCode;
  severity: AlertSeverity;
  index: string;
  /** Distinguishes alerts of the same code (e.g. which adapter); used for de-duplication. */
  subject: string;
  message: string;
}

type Check = (state: IndexState, policy: KeeperPolicy) => Alert[];

const alert = (state: IndexState, code: AlertCode, severity: AlertSeverity, message: string, subject = ""): Alert => ({
  code,
  severity,
  index: state.view.vault,
  subject,
  message,
});

const adapterHealth: Check = (s) =>
  s.view.adapters
    .filter((a) => !a.quarantined && (!a.healthy || !a.valuationOk))
    .map((a) => alert(s, "ADAPTER_UNHEALTHY", "warning", `adapter ${a.adapter} healthy=${a.healthy} valuationOk=${a.valuationOk}`, a.adapter));

const flags: Check = (s) => {
  const out: Alert[] = [];
  if (!s.view.navHealthy) out.push(alert(s, "NAV_UNHEALTHY", "critical", "lens reports navHealthy=false"));
  if (s.view.shutdown) out.push(alert(s, "SHUTDOWN", "critical", "index is in emergency shutdown"));
  if (s.view.depositsPaused) out.push(alert(s, "DEPOSITS_PAUSED", "info", "deposits are paused"));
  if (s.view.redemptionsPaused) out.push(alert(s, "REDEMPTIONS_PAUSED", "warning", "redemptions are paused"));
  return out;
};

const queueAge: Check = (s, policy) => {
  const live = s.openRequests.filter((r) => !isExpired(r, s.now));
  const oldest = live[0];
  if (!oldest) return [];
  const age = s.now - Number(oldest.request.requestedAt);
  if (age <= policy.queueAgeAlertSeconds) return [];
  return [alert(s, "QUEUE_STALE", "warning", `oldest open request #${oldest.id} is ${age}s old`)];
};

/** Requests whose minAssetsOut exceeds the current claim are skipped by processRedemptions until expiry. */
const floorBlocked: Check = (s) => {
  const blocked = s.openRequests.filter((r) => !isExpired(r, s.now) && claimOf(s.view, r.request.shares) < r.request.minAssetsOut);
  if (blocked.length === 0) return [];
  const ids = blocked.map((r) => r.id.toString()).join(",");
  return [alert(s, "QUEUE_FLOOR_BLOCKED", "info", `requests skipped because NAV is below their floor: ${ids}`)];
};

const liquidity: Check = (s, policy) => {
  const target = targetBalance(s.view);
  if (s.view.baseBalance >= target || s.view.nav === 0n) return [];
  const shortfallBps = ((target - s.view.baseBalance) * BPS) / s.view.nav;
  if (shortfallBps <= BigInt(policy.rebalanceThresholdBps)) return [];
  return [alert(s, "LIQUIDITY_BELOW_BUFFER", "warning", `base balance ${s.view.baseBalance} below target ${target}`)];
};

const CHECKS: readonly Check[] = [adapterHealth, flags, queueAge, floorBlocked, liquidity];

export function evaluateAlerts(state: IndexState, policy: KeeperPolicy): Alert[] {
  return CHECKS.flatMap((check) => check(state, policy));
}

export type WebhookPost = (url: string, body: string) => Promise<void>;

const WEBHOOK_TIMEOUT_MS = 5_000;

export const fetchWebhook: WebhookPost = async (url, body) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`webhook responded ${res.status}`);
};

/** Logs every alert and forwards it to the webhook at most once per cooldown per (code, index, subject). */
export class AlertNotifier {
  private readonly lastSent = new Map<string, number>();

  constructor(
    private readonly logger: Logger,
    private readonly opts: { webhookUrl: string | undefined; cooldownMs: number; post?: WebhookPost; now?: () => number },
  ) {}

  async notify(alerts: Alert[]): Promise<number> {
    let sent = 0;
    for (const a of alerts) if (await this.notifyOne(a)) sent++;
    return sent;
  }

  private async notifyOne(a: Alert): Promise<boolean> {
    const now = (this.opts.now ?? Date.now)();
    const key = `${a.code}:${a.index}:${a.subject}`;
    const last = this.lastSent.get(key);
    if (last !== undefined && now - last < this.opts.cooldownMs) return false;
    this.lastSent.set(key, now);
    const level = a.severity === "critical" ? "error" : a.severity === "warning" ? "warn" : "info";
    this.logger[level]("alert", { ...a });
    if (!this.opts.webhookUrl) return true;
    try {
      await (this.opts.post ?? fetchWebhook)(this.opts.webhookUrl, JSON.stringify({ ...a, at: new Date(now).toISOString() }));
    } catch (err) {
      this.logger.error("alert webhook failed", { code: a.code, err: errorMessage(err) });
    }
    return true;
  }
}
