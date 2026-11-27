# SKYJO Classic — rules implemented

## Authority and scope

This is an implementation-oriented paraphrase of the published Magilano Classic rules, not SKYJO Action or Junior. Sources: [English Magilano instruction sheet, pp. 2–3 (retailer-hosted scan)](https://debordspelbar.nl/wp-content/uploads/2025/01/Skyjo-rules-of-the-game-EN.pdf), [French Magilano/Blackrock instruction sheet (card distribution and cross-check)](https://media.play-in.com/pdf/rules_games/skyjo_regles_fr.pdf), and [publisher product page](https://magilano.com/en/products/skyjo). The English sheet specifies the next-round starter; that rule is used here. Sources checked 2026-11-25.

## Equipment and objective

- Two to eight players; 150 cards: five −2s, fifteen zeros, and ten of every other integer from −1 through 12.
- Minimize your cumulative score. Finish the round in which someone reaches at least 100; the lowest overall total wins.

## Round setup

Shuffle the complete deck anew. Deal twelve unseen cards to each player in a 3-row by 4-column grid. Turn one undealt card face up as the discard; the remainder is the draw pile. Each player chooses exactly two distinct cards to expose. In round one, compare the sums of those pairs; the largest starts. In subsequent rounds, the previous round's finisher starts. The ordered lobby seats represent clockwise seating.

## Turn

Choose one pile. Taking the discard commits you to replacing an occupied slot of your own grid. A blind draw may instead be rejected. For either replacement, put the acquired card face up in the chosen slot and discard the displaced card face up; do not inspect a hidden target beforehand. On rejection, put the drawn card on the discard, then expose one still-hidden card of your grid. Play advances clockwise only after this action is completed.

## Matching columns

Whenever a column contains three exposed cards with identical numerical values, remove all three and place them on the discard. This is compulsory, including during the scoring reveal. On a swap the displaced card goes onto the pile first. Removed slots remain empty; horizontal and diagonal matches are irrelevant.

## Closing and scoring

The first player whose remaining grid has no hidden cards is the finisher. Every other player receives exactly one further turn; the finisher receives none. Reveal all remaining hidden cards, resolve newly formed matching columns, and sum each player's remaining cards. Removed cards contribute nothing. If the finisher's raw score is positive and another player has an equal or lower raw score, double only the finisher's round score. For example, raw totals of 10, 24, 10 with the first player finishing become 20, 24, 10. Negative and zero totals are never doubled. Add the resulting round scores to the cumulative totals. If all totals remain below 100, start another round; otherwise declare the lowest cumulative score the winner.

## Digital conventions (not additional official rules)

The cited sheets do not prescribe all operational edge cases. This app chooses the earliest seat among tied initial sums, reports all tied lowest final totals as co-winners, and replenishes an exhausted draw pile by shuffling the discard except its top card. Anyone seated may advance from the round score screen; the server still selects the proper starter. A late guest spectates until the next match. The game does not impose a turn timer, forfeits or bot substitution. All hidden values and blind draws are kept on the server; the drawing player alone sees their pending card.
