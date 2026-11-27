import { expect, it } from "vitest";

import { meetsReasonMinimum } from "@/lib/trust/reason";

it.each([
  ["four visible letters with internal whitespace", "ab \t cd", false],
  ["four supplementary code points", "\u{1F600}".repeat(4), false],
  ["a default-ignorable combining mark", "abcd\u034F", false],
  ["a format character outside the default-ignorable set", "abcd\uFFF9", false],
  ["a control character", "abcd\u0007", false],
  ["next line characters, which trim() keeps", "\u0085".repeat(5), false],
  ["zero-width spaces, which trim() keeps", "\u200B".repeat(5), false],
  [
    "Hangul fillers (letters, but default-ignorable)",
    "\u3164".repeat(5),
    false,
  ],
  [
    "bidi controls, variation selectors and tags",
    "\u202E\u2066\uFE0F\u{E0061}\u00AD",
    false,
  ],
  ["five visible letters with a joiner", "ab\u200D cde", true],
  ["five supplementary code points", "\u{1F600}".repeat(5), true],
] as const)("checks the override minimum for %s", (_, reason, expected) => {
  expect(meetsReasonMinimum(reason)).toBe(expected);
});
