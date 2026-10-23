import { PageHeader, Section } from "@/components/page";

export const metadata = { title: "About" };

const LAYERS = [
  {
    name: "Checks",
    body: "Eleven deterministic rules compare each invoice with the client's ledger, bank receipts and debtor history as of the submission date.",
  },
  {
    name: "Agent",
    body: "An LLM reads the evidence through read-only tools and writes a short explanation in which every claim cites the records it used.",
  },
  {
    name: "Validator",
    body: "Rejects any explanation that cites a record no tool returned, or states an amount or date that is not in the records it cites.",
  },
  {
    name: "Analyst",
    body: "Decides. In shadow mode the agent's view stays hidden until the decision is saved, so agreement can be measured honestly.",
  },
  {
    name: "Snapshot",
    body: "Freezes everything the decision rested on, with a SHA-256 checksum chained to the previous decision, so it can be replayed exactly.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHeader
        title="About Credit Desk"
        description="A prototype of how a lender could bring AI into credit decisions without giving it the decision."
      />

      <Section title="The problem">
        <p className="max-w-prose text-sm leading-relaxed">
          Invoice finance advances most of an invoice&apos;s value before the
          debtor pays. Money is lost when an invoice is fake, duplicated,
          disputed, or credited after funding. Checking every invoice by hand is
          slow; handing the check to a model is hard to trust, prove or audit.
        </p>
      </Section>

      <Section title="The approach">
        <p className="max-w-prose text-sm leading-relaxed">
          Rules detect, the model explains, a validator checks the model, and a
          person decides. The agent never approves, funds or changes anything.
          Shadow mode measures how often the agent agrees with analysts before
          anyone relies on it, and every decision can be replayed exactly as it
          was made.
        </p>
      </Section>

      <Section title="How a decision flows">
        <ol className="bg-card flex flex-col gap-0 rounded-md border">
          {LAYERS.map((l, i) => (
            <li
              key={l.name}
              className="grid gap-1 border-b px-4 py-3 last:border-b-0 sm:grid-cols-[10rem_1fr]"
            >
              <span className="font-medium">
                {i + 1}. {l.name}
              </span>
              <span className="text-muted-foreground text-sm">{l.body}</span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="What is real and what is not">
        <ul className="max-w-prose list-disc space-y-1 pl-5 text-sm">
          <li>
            All clients, debtors, invoices, ledgers and bank lines are
            synthetic, shaped like Xero and Akahu data.
          </li>
          <li>
            Past analyst decisions used for the agreement history are simulated
            and marked as simulated everywhere.
          </li>
          <li>
            Explanations come from a real open-weight model on Groq, precomputed
            and validated.
          </li>
          <li>Thresholds are defaults, not calibrated on real losses.</li>
        </ul>
      </Section>

      <Section title="What production would need">
        <ul className="max-w-prose list-disc space-y-1 pl-5 text-sm">
          <li>Real authentication with roles and maker-checker approval.</li>
          <li>Xero and Akahu integrations under the relevant accreditation.</li>
          <li>
            Immutable audit storage with external anchoring of snapshot hashes.
          </li>
          <li>
            Retention and access under the Privacy Act 2020, and AML/CFT
            considerations.
          </li>
          <li>
            Threshold calibration on real loss data, monitoring and alerting.
          </li>
          <li>
            A provider and data-residency review before any real customer data
            reaches a model.
          </li>
        </ul>
      </Section>

      <p className="text-muted-foreground text-sm">
        Built as a prototype for discussion with Runway&apos;s team.
      </p>
    </>
  );
}
