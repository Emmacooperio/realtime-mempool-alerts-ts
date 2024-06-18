/**
 * realtime-mempool-alerts-ts
 * Rule-based mempool watcher using ethers v6 WebSocket provider.
 * Filters by min value, method selector whitelist/blacklist and recipient set.
 * Prints JSON alerts; you can pipe to a file or forward to Telegram later.
 */
import { WebSocketProvider, TransactionResponse } from "ethers";

type Rule = {
  minEth?: number;                          // minimal ETH value in tx
  allowSelectors?: string[];                // e.g., ["0xa9059cbb"]
  denySelectors?: string[];
  watchRecipients?: string[];               // lowercase addresses
};

const RULES: Rule = {
  minEth: 0.5,
  allowSelectors: [],
  denySelectors: ["0x095ea7b3"],           // deny approve()
  watchRecipients: [],
};

// infer selector from input data
function selectorOf(input: string): string {
  if (!input || input.length < 10) return "0x00000000";
  return input.slice(0, 10).toLowerCase();
}

function weiToEth(wei: bigint): number {
  return Number(wei) / 1e18;
}

function matchRules(tx: TransactionResponse, rules: Rule): {ok: boolean, reason: string[]} {
  const reasons: string[] = [];
  const sel = selectorOf(tx.data ?? "0x");
  const eth = weiToEth(tx.value ?? 0n);

  if (rules.minEth && eth < rules.minEth) reasons.push(`value<${rules.minEth}`);
  if (rules.allowSelectors && rules.allowSelectors.length && !rules.allowSelectors.includes(sel)) reasons.push(`!allowed:${sel}`);
  if (rules.denySelectors && rules.denySelectors.includes(sel)) reasons.push(`denied:${sel}`);
  if (rules.watchRecipients && rules.watchRecipients.length && !rules.watchRecipients.includes((tx.to ?? "").toLowerCase())) reasons.push("!watched:to");

  return { ok: reasons.length === 0, reason: reasons };
}

async function main() {
  // Prefer WSS for real-time. Works with public endpoints too.
  const url = process.env.WSS_URL ?? "wss://eth.drpc.org"; // change to your provider
  const provider = new WebSocketProvider(url);

  console.error(`[mempool] connected to ${url}`);

  provider.on("pending", async (hash: string) => {
    try {
      const tx = await provider.getTransaction(hash);
      if (!tx) return;
      const { ok, reason } = matchRules(tx, RULES);
      if (!ok) return;

      const alert = {
        type: "mempool_alert",
        hash: tx.hash,
        from: (tx.from ?? "").toLowerCase(),
        to: (tx.to ?? "").toLowerCase(),
        eth: weiToEth(tx.value ?? 0n),
        selector: selectorOf(tx.data ?? "0x"),
        nonce: tx.nonce,
        ts: Math.floor(Date.now()/1000),
      };
      console.log(JSON.stringify(alert));
    } catch (e) {
      // swallow transient errors
    }
  });

  process.on("SIGINT", () => { provider.destroy(); process.exit(0); });
}

main().catch((e) => { console.error(e); process.exit(1); });
