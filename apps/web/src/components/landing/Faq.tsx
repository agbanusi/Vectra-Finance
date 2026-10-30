import { Accordion } from "../ui/Accordion";
import { Section } from "./Section";

const ITEMS = [
  { q: "What is a Vectra index token?", a: "An ERC-20 issued by an index vault. The vault holds a USDC buffer plus positions in several strategy vaults; the token's price per share equals net asset value divided by supply, so it rises as the strategies earn." },
  { q: "How is APY calculated?", a: "Vectra only shows realised APY: the annualised growth of an index's price per share over a stated window (for example 7d, 24h or since launch), read from indexed snapshots or historical chain state. If there is not enough history, the app shows a dash instead of a number. Past performance does not predict future returns." },
  { q: "Can I withdraw at any time?", a: "Yes. If free liquidity covers your claim you are paid instantly. Otherwise you can opt in to a first-in, first-out queue: your shares are escrowed and paid at the NAV when filled, never below the floor you set. You can cancel an open request whenever you like." },
  { q: "Who decides the allocation?", a: "Each index has target weights across governance-approved strategies. Rebalancing is automated by keepers within on-chain drift tolerances, and only adapters and targets on the registry allowlist can be used." },
  { q: "What are the fees?", a: "There are no deposit or withdrawal fees. Each index may charge a management fee and a performance fee above its high-water mark, both capped in the contracts and shown on the index page." },
  { q: "Why are some indexes restricted?", a: "Indexes holding real-world assets can enforce an allowlist through a compliance module. If your wallet is not eligible, the deposit form is replaced with an explanation." },
  { q: "Is this live with real money?", a: "The current deployment runs on the Sepolia testnet with test USDC from the in-app faucet and yield-emulating strategy vaults. Strategy names such as “Gauntlet-style” describe an allocation style only and do not imply affiliation." },
];

export function Faq() {
  return (
    <Section id="faq" eyebrow="FAQ" title="Questions, answered">
      <div className="max-w-3xl"><Accordion items={ITEMS} /></div>
    </Section>
  );
}
