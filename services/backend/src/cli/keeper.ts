import { viemProtocolReader } from "../chain/reader.js";
import { AlertNotifier } from "../keeper/alerts.js";
import { viemTxBackend } from "../keeper/backend.js";
import { Executor } from "../keeper/executor.js";
import { Keeper } from "../keeper/keeper.js";
import { bootstrap, fatal, indexAddresses, instanceId, runLoop } from "../runtime.js";

const rt = (() => {
  try {
    return bootstrap("keeper");
  } catch (err) {
    return fatal(undefined, err);
  }
})();

const { config, deployment, db, client, logger } = rt;
const kc = config.keeper;
const backend = viemTxBackend({ publicClient: client, chainId: config.chainId, rpcUrl: config.rpcUrl, privateKey: kc.privateKey });
const notifier = new AlertNotifier(logger, { webhookUrl: kc.alertWebhookUrl, cooldownMs: kc.alertCooldownMs });
const executor = new Executor({
  db,
  backend,
  chainId: config.chainId,
  instanceId: instanceId("keeper"),
  leaseTtlMs: kc.leaseTtlMs,
  maxFeePerGasWei: kc.maxFeePerGasWei,
  retry: { maxAttempts: kc.retryMaxAttempts, baseDelayMs: kc.retryBaseDelayMs, maxDelayMs: kc.retryMaxDelayMs },
  logger,
  onAlert: async (a) => void (await notifier.notify([a])),
});
const keeper = new Keeper({
  reader: viemProtocolReader(client, deployment.lens),
  executor,
  notifier,
  policy: kc.policy,
  logger,
  indexes: () => indexAddresses(db, config.chainId, deployment),
});

logger.info("keeper starting", { dryRun: !backend.canSend, account: backend.account ?? null, policy: kc.policy });
await runLoop("keeper", kc.pollMs, logger, async () => {
  await keeper.tick();
});
db.close();
