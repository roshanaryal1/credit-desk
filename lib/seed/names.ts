// Invented business names for synthetic data. Combinations are generated, not
// copied from any register.

export const CLIENT_PROFILES = [
  { name: "Tidewater Linehaul Ltd", industry: "logistics", termsDays: 30 },
  {
    name: "Brackenridge Trade Supplies Ltd",
    industry: "wholesale",
    termsDays: 20,
  },
  {
    name: "Copperleaf Fabrication Ltd",
    industry: "manufacturing",
    termsDays: 30,
  },
  {
    name: "Northgate Workforce Partners Ltd",
    industry: "recruitment",
    termsDays: 14,
  },
] as const;

const FIRST = [
  "Amberlight",
  "Bellbird",
  "Cobaltine",
  "Driftwood",
  "Emberfield",
  "Fernvale",
  "Glasshouse",
  "Hollowtree",
  "Ironsand",
  "Juniper",
  "Kestrel",
  "Lowland",
  "Moonraker",
  "Nettlebank",
  "Oakridge",
  "Pumicestone",
  "Quarryside",
  "Riverbend",
  "Saltmarsh",
  "Thornbury",
];

const SECOND = [
  "Retail",
  "Builders",
  "Foods",
  "Hospitality",
  "Engineering",
  "Health",
  "Logistics",
  "Interiors",
  "Agritech",
  "Motors",
];

/** Unique debtor names for one dataset, in a deterministic order. */
export function debtorNames(count: number, offset: number): string[] {
  const names: string[] = [];
  for (let i = 0; names.length < count; i++) {
    const first = FIRST[(i + offset) % FIRST.length];
    const second = SECOND[(i * 3 + offset) % SECOND.length];
    const name = `${first} ${second} Ltd`;
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/**
 * Synthetic NZBN: 13 digits starting 9429 with a deliberately wrong GS1 check
 * digit, so it can never match a real business (SPEC 4.2).
 */
export function syntheticNzbn(serial: number): string {
  const body = `9429${String(serial).padStart(8, "0")}`;
  const valid = gs1CheckDigit(body);
  return `${body}${(valid + 1) % 10}`;
}

export function gs1CheckDigit(body12: string): number {
  let sum = 0;
  for (let i = 0; i < body12.length; i++) {
    const digit = Number(body12[body12.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}
