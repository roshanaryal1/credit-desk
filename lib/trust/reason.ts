// The HIGH-risk override reason rule (#237), shared by the decision form and
// the decision transaction so both reject the same text. Pure, client-safe.

export const MIN_REASON_CHARACTERS = 5;
export const HIGH_RISK_REASON_MESSAGE = `Explain why you are approving an invoice with a HIGH finding. Enter at least ${MIN_REASON_CHARACTERS} visible, non-space characters.`;

// trim() keeps zero-width spaces, bidi controls, NEL and other code points
// that render as nothing, so count only code points outside White_Space, Cc,
// Cf and Default_Ignorable_Code_Point. The Unicode flag counts supplementary
// code points once. The audit record keeps the original reason unchanged.
const meaningfulCharacter =
  /[^\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/gu;

export function meetsReasonMinimum(reason: string): boolean {
  return (
    (reason.match(meaningfulCharacter)?.length ?? 0) >= MIN_REASON_CHARACTERS
  );
}
