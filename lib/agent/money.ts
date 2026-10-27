/** Monetary literals, never arithmetic: preserve complete unsupported tokens. */
export interface CurrencyToken {
  token: string;
  cents: number | null;
}

const MARKER = /[-+−]?(?:NZ\$|\$|(?<![\p{L}_])NZD(?![\p{L}]))/giu;
const NUMBER = /^-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/;
const WORD = /^[^\s()[\]{};!?`"“”]+/u;
const LAST_WORD = /[^\s()[\]{};!?`"“”]+$/u;
const MAGNITUDE_WORD =
  "(?:(?:(?:hundred|thousand|million|billion|trillion)s?|mn|bn)(?![\\p{L}\\p{N}])|[kmb](?=$|[\\s\\p{P}\\p{S}]))";
const MAGNITUDE = new RegExp(`^[^\\p{L}\\p{N}]*${MAGNITUDE_WORD}`, "iu");
// A magnitude after a literal, with only spacing/punctuation between, scales
// it ("'$1 million'", "$1 (million)", "$1 million-dollar").
const TRAILING_MAGNITUDE = new RegExp(`^[\\s\\p{P}]*${MAGNITUDE_WORD}`, "iu");
const OPERATOR = /^[\p{Sm}\p{Pd}\p{Pc}\p{Cf}\p{M}*/%\\·∙⁄＊'’]+$/u;
const PREFIX_OPERATOR = /^[\p{Sm}\p{Pd}\p{Pc}\p{Cf}\p{M}*/%\\·∙⁄＊]+$/u;
const NUMERIC =
  /^(?:[+−-]?(?:\p{N}|\.\p{N})|[^\p{L}\p{N}]*\p{N}|NaN\b|Infinity\b|∞)/iu;

// Markdown list item markers: "- ", "* ", "+ ", "1. ", "2) ".
const LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/u;
const LIST_PREFIX = /^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+$/u;

interface Candidate {
  raw: string;
  start: number;
  end: number;
  /** A digit-bearing word that is not a clean number, e.g. "Total~999". */
  labelled?: boolean;
}

function following(text: string, start: number): Candidate | null {
  const space = /^\s*/u.exec(text.slice(start))![0].length;
  // A literal never continues into the next list item.
  if (
    /[\r\n]/u.test(text.slice(start, start + space)) &&
    LIST_ITEM.test(text.slice(start + space))
  )
    return null;
  start += space;
  let first = WORD.exec(text.slice(start))?.[0];
  // "$1.00,$2.00": a comma or semicolon before another marker ends the list item.
  const listed = first && /^[^$]*?[,;](?=[-+−]?(?:NZ)?\$)/iu.exec(first)?.[0];
  if (listed) first = listed;
  // "NZD $6,047.50": the dollar marker starts its own literal.
  if (first && /^(?:NZ)?\$/iu.test(first)) return null;
  if (!first || !NUMERIC.test(first)) {
    // Unsupported punctuation/operator-wrapped numeric assertions must not
    // become a harmless standalone NZD label.
    const rest = text.slice(start);
    // A bracketed ISO date is grounded separately by dateMentions().
    if (/^[^\p{L}\p{N})\]};.,!?$]*\d{4}-\d{2}-\d{2}\b/u.test(rest)) return null;
    // "(30 days overdue)" annotates; "(999999)" or "[999999.00]" asserts.
    if (/^[^\p{L}\p{N})\]};.,!?$]*[\p{N}.,]+\s*\p{L}/u.test(rest)) return null;
    const wrapped = /^[^\p{L}\p{N})\]};.,!?$]*\p{N}+/u.exec(rest)?.[0];
    return wrapped
      ? { raw: wrapped, start, end: start + wrapped.length }
      : null;
  }
  let raw = first;
  let end = start + first.length;
  // Spaces and Unicode spacing cannot turn an unsupported grouping or
  // multiplier into a smaller, apparently grounded literal.
  for (;;) {
    const gap = /^\s+/u.exec(text.slice(end))?.[0];
    if (!gap) break;
    const nextText = text.slice(end + gap.length);
    if (/[\r\n]/u.test(gap) && LIST_ITEM.test(nextText)) break;
    const next = WORD.exec(nextText)?.[0];
    if (next && /[.,:]$/u.test(raw) && /^\d{4}-\d{2}-\d{2}[.,:]?$/u.test(next))
      break;
    // Sentence or list punctuation ends a literal ("$1.00, $2.00", "$1.00.
    // 30 days"), unless the next word could still be a space-separated
    // thousands group, magnitude or operator ("$1, 000", "$1.00, × 1000").
    if (
      next &&
      /[.,:]$/u.test(raw) &&
      // A literal that already has decimals cannot continue as a thousands
      // group: "$1.00. 100 days" is two statements.
      (/\.\d/u.test(raw) || !/^\d{3}[.,:]?$/u.test(next)) &&
      !MAGNITUDE.test(next) &&
      !OPERATOR.test(next)
    )
      break;
    if (
      !next ||
      (!NUMERIC.test(next) && !MAGNITUDE.test(next) && !OPERATOR.test(next))
    )
      break;
    // "$6,047.50 - please reconcile" is prose; "$1 - 999" is arithmetic.
    if (OPERATOR.test(next) && !/\p{N}/u.test(next)) {
      const operand = WORD.exec(
        nextText.slice(next.length).replace(/^\s+/u, ""),
      )?.[0];
      if (!operand || (!NUMERIC.test(operand) && !MAGNITUDE.test(operand)))
        break;
    }
    raw += gap + next;
    end += gap.length + next.length;
  }
  return { raw, start, end };
}

function preceding(text: string, end: number): Candidate | null {
  end -= /\s*$/u.exec(text.slice(0, end))![0].length;
  const word = LAST_WORD.exec(text.slice(0, end))?.[0];
  // A list number ("2. NZD $1.00") is a marker, not an amount.
  if (
    LIST_PREFIX.test(text.slice(text.lastIndexOf("\n", end - 1) + 1, end) + " ")
  )
    return null;
  const first = word?.replace(/^[\p{L}_][\p{L}\p{N}_-]*[:=]/u, "");
  if (
    word &&
    first &&
    !NUMERIC.test(first) &&
    !MAGNITUDE.test(first) &&
    /\p{N}/u.test(first)
  )
    // "Total~999999.00 NZD" must not hide its amount behind a label; it is
    // dropped only when a literal follows the code ("INV-40229 NZD 1.00").
    return { raw: word, start: end - word.length, end, labelled: true };
  if (!first || (!NUMERIC.test(first) && !MAGNITUDE.test(first))) {
    const wrapped = /[([{][^\p{L}]*\p{N}[^\p{L}]*[)\]}]$/u.exec(
      text.slice(0, end),
    )?.[0];
    return wrapped ? { raw: wrapped, start: end - wrapped.length, end } : null;
  }
  let raw = first;
  let start = end - first.length;
  for (;;) {
    const prefix = text.slice(0, start);
    const gap = /\s+$/u.exec(prefix)?.[0];
    if (!gap) break;
    if (LIST_PREFIX.test(prefix.slice(prefix.lastIndexOf("\n") + 1))) break;
    const previous = LAST_WORD.exec(prefix.slice(0, -gap.length))?.[0];
    if (!previous || (!NUMERIC.test(previous) && !OPERATOR.test(previous)))
      break;
    // A sentence ending in an ISO date is not part of the next amount.
    if (/^\d{4}-\d{2}-\d{2}[.,:;]?$/u.test(previous)) break;
    // "NZD 1.00, 1.00 NZD" lists two literals; "1, 000 NZD" is one grouping.
    const leftmost = raw.split(/\s+/u)[0]!;
    if (
      /[.,:]$/u.test(previous) &&
      (/\.\d/u.test(previous) || !/^\d{3}[.,:]?$/u.test(leftmost)) &&
      !MAGNITUDE.test(leftmost) &&
      !OPERATOR.test(leftmost)
    )
      break;
    raw = previous + gap + raw;
    start -= previous.length + gap.length;
  }
  return { raw, start, end };
}

function parse(raw: string, sign: string): number | null {
  // One terminal mark is ordinary prose punctuation, not a numeric separator.
  const number = raw.replace(/['’][.,:]?$/u, "").replace(/[.,:]$/u, "");
  if (
    !NUMBER.test(number) ||
    /[+−]/u.test(sign) ||
    (sign === "-" && number.startsWith("-"))
  )
    return null;
  const [whole, fraction = ""] = number
    .replace(/^-/, "")
    .replaceAll(",", "")
    .split(".");
  const value =
    (BigInt(whole!) * BigInt(100) + BigInt(fraction.padEnd(2, "0"))) *
    (sign === "-" || number.startsWith("-") ? BigInt(-1) : BigInt(1));
  return value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
    ? null
    : Number(value);
}

export function currencyTokens(input: string): CurrencyToken[] {
  // Paired Markdown emphasis ("**$1.00**") is formatting, not arithmetic.
  // Replace the delimiters with equal-length spaces so offsets still match.
  const text = input.replace(
    /(?<![\p{L}\p{N}_*])(\*\*|__|\*|_)(?=\S)([^*_\n]+?)(?<=\S)\1(?![\p{L}\p{N}_*])/gu,
    (_match, delimiter: string, inner: string) =>
      " ".repeat(delimiter.length) + inner + " ".repeat(delimiter.length),
  );
  const tokens: (CurrencyToken & { start: number; end: number })[] = [];
  for (const marker of text.matchAll(MARKER)) {
    const start = marker.index!;
    const end = start + marker[0].length;
    let sign = /^[-+−]/u.exec(marker[0])?.[0] ?? "";
    const isCode = /NZD/i.test(marker[0]);
    if (isCode && /[\p{L}_][\p{L}\p{N}_-]*$/u.test(text.slice(0, start))) {
      // Only a complete contiguous label is exempt: INV-NZD123 is a record
      // ID. "Balance-NZD 999999.00" is a hyphen-joined unit before a separate
      // amount, so the hyphen is not a sign and the amount must be grounded.
      const run = (
        /^[\p{L}\p{N}_.,-]*/u.exec(text.slice(end))?.[0] ?? ""
      ).replace(/[.,]+$/u, "");
      // Exempt only label-shaped continuations (INV-NZD_123, INV-NZD-A1).
      // Digits, decimals, exponents or magnitudes (Balance-NZD999999.00,
      // NZD1e9, NZD1million) must be grounded.
      // A label followed by another number, magnitude or operator is not a
      // complete label: "Balance-NZD-1 000" still asserts money.
      const tail = text.slice(end + run.length);
      const nextWord = WORD.exec(tail.replace(/^\s+/u, ""))?.[0];
      const continued =
        /^\s/u.test(tail) &&
        !!nextWord &&
        (NUMERIC.test(nextWord) ||
          MAGNITUDE.test(nextWord) ||
          OPERATOR.test(nextWord));
      if (!continued && /^(?:[-_]?\p{L}[\p{L}\p{N}_-]*|[-_]\d+)$/u.test(run))
        continue;
      sign = "";
    }
    // "NZD $1.00": the code labels the dollar literal that follows it.
    let before = isCode ? preceding(text, start) : null;
    // Unless an amount precedes the code ("999999 NZD $1"), which must still
    // be grounded rather than discarded.
    if (
      isCode &&
      (!before || before.labelled) &&
      /^\s*[-+−]?(?:NZ)?\$/iu.test(text.slice(end))
    )
      continue;
    let after = following(text, end);
    if (before?.labelled && after) before = null;
    // Once a suffix currency code closes a literal, sentence/list punctuation
    // separates the next statement rather than extending its numeric token.
    // "1 NZD.50" is a continuation, not a sentence end.
    if (before && /^[.,:;!?](?:\s|$)/u.test(text.slice(end).trimStart()))
      after = null;
    // A comma/full stop separating two literals is ordinary list punctuation.
    if (before && after && /[.,:]$/u.test(before.raw)) before = null;
    // A currency label without a numeric assertion remains valid prose.
    if (isCode && !before && !after) continue;
    const candidate = before ?? after;
    const from = before?.start ?? start;
    const to = after?.end ?? end;
    const overlap = tokens.find(
      (token) =>
        candidate &&
        token.start <= candidate.start &&
        token.end >= candidate.end,
    );
    if (overlap) {
      // A suffix label must not conceal another number or operator.
      if (after) overlap.cents = null;
      continue;
    }
    const left = text.slice(0, start).match(/\S$/u)?.[0] ?? "";
    const ambiguous = !!before && !!after;
    const prefix = text.slice(0, start);
    const previous = prefix.trimEnd().slice(-1);
    const line = prefix.slice(prefix.lastIndexOf("\n") + 1);
    // Preserve ordinary Markdown bullets, but never discard a sign/operator
    // inside a monetary assertion just because whitespace separates it.
    const bullet = LIST_PREFIX.test(line);
    const scaled = TRAILING_MAGNITUDE.test(text.slice(to));
    const badPrefix =
      !before &&
      (/[\p{N}_+×÷*/^=−]/u.test(left) ||
        (!bullet && PREFIX_OPERATOR.test(previous)));
    tokens.push({
      start: from,
      end: to,
      token: text.slice(from, to),
      cents:
        !candidate || ambiguous || badPrefix || scaled
          ? null
          : parse(candidate.raw, sign),
    });
  }
  return tokens.map(({ token, cents }) => ({ token, cents }));
}

/** Supported NZD literals as integer cents; full validation rejects bad tokens. */
export function moneyMentions(text: string): number[] {
  return currencyTokens(text).flatMap(({ cents }) =>
    cents === null ? [] : [cents],
  );
}
