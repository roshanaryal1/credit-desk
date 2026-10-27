# Complete monetary literal validation

Issue #186.

The former parser could validate the small prefix of a larger unsupported expression, such as `$1 000`, `$1_000` or `$1×10^9`, and ignored suffix forms such as `999999.00 NZD`. This allowed unsupported amounts into summaries, claims and questions despite citation validation.

The shared monetary tokenizer now recognizes prefix `$`, `NZ$`, `NZD` and suffix `NZD` literals. Supported amounts use ASCII digits, optional conventional comma grouping, up to two decimal places and an optional minus sign. Integer cents are constructed with BigInt and must fit safe integers. Ordinary sentence and list punctuation, quoted amounts, label-shaped IDs (such as `INV-NZD_123` or `INV-NZD-A1`), source citations and separately stated ISO dates remain supported. A hyphen-joined `NZD` followed by bare digits or decimals (`INV-NZD123`, `Balance-NZD999999.00`) is treated as money and must be grounded; this fails closed for that rare label form. Standalone ASCII Markdown bullets remain list punctuation; inline signs and operators before currency literals cannot be discarded across whitespace.

Unsupported numeric grouping, magnitude words (including quoted, bracketed, plural and hyphenated forms such as `'$1 million'` or `$1 million-dollar`), arithmetic operators, Unicode digits or numeric continuations, ambiguous adjacent amounts and unsafe cents produce invalid tokens. Validation rejects them rather than using a smaller numeric prefix. Unsupported foreign-currency codes are also rejected in suffix form. Malformed numeric source fields cannot be rounded into supporting evidence.

All displayed fields retain citation grounding. Tests exercise the independent audit reproductions, supported literals, safe-integer boundaries, adversarial full outputs and both legacy and captured stored explanations. Stored records and original capture transcripts are not rewritten. No provider calls, database migrations or dependencies are introduced.

This is literal grounding, not a claim that the validator can prove every natural-language inference or detect every spelled-out monetary assertion.

Six independent review rounds found and closed further bypasses and false rejections: separated hyphen labels, magnitude words before closing punctuation, label-shaped and exponent exemptions, punctuation continuations after suffix codes, label-prefixed suffix amounts, backward list scans, wrapped-number scans across brackets and dates, prose hyphens, combined `NZD $` spellings, Markdown emphasis and compact comma lists. Each has a regression test in `tests/agent/money.test.ts`.

The tokenizer remains regex-based. A structured amount contract in agent output (amounts as cited cent fields, no free-text currency) is the recommended follow-up and would remove this class of edge case.
