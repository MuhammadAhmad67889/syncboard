# Timed voting sessions

## What it is

A voting round with a clock. The facilitator picks a length — 1, 3, or 5
minutes — and starts a timed session from the dot-voting bar. A countdown
shows for everyone on the board. While the clock runs, each voter sees only
their own dots; nobody sees anyone else's dots or any totals. When the time
runs out, every dot reveals at once, with the totals in the badges.

## Why

Open dot voting lets the first votes steer the room: people pile dots where
dots already are. Hiding the votes until the reveal keeps each person's
first instinct honest, and the shared countdown makes the round feel like
an event instead of a slow trickle.

## Design

- **The end time lives in the shared document.** Starting a timed session
  writes `timed: true` and `endsAt` (epoch ms) into the `voting` Y.Map,
  next to the existing session fields. Every client counts down to the
  same moment, and a late joiner reads the end time and sees the right
  remaining time. Old sessions written before this feature read as
  `timed: false, endsAt: 0` — plain open voting, unchanged.
- **The reveal follows the clock, not a write.** `visibleVotes` hides
  other people's dots from the current session while
  `isTimedSessionRunning` is true (timed, open, end time still ahead).
  The moment the clock passes the end time the votes are visible on every
  client, even before any client writes the session closed.
- **The end is still written.** A clock effect ticks twice a second while
  a timed session runs; when the time is up it writes the session closed
  (`active: false`). Any client with the board open ends it — so if the
  facilitator leaves mid-session, the timer still ends it on time. A
  client that opens the board after the end time ends it on the spot.
- **Dots from earlier sessions stay visible.** They were already public,
  so hiding them would be a surprise. Only the current session's dots are
  hidden, and only from other people — each voter still sees their own.
- **The facilitator can end early.** An "End now" button shows only to
  the person who started the session. Anyone could end plain open voting
  before; a timed round is the starter's call, and the timer is the
  backstop if they walk away.
- **Clearing is off while a round runs.** Clear votes would delete hidden
  dots nobody can see. The button is disabled until the session ends,
  then works exactly as before.

## Rules

- One session at a time per board. Starting a timed session while one is
  open does nothing; starting plain voting is likewise unavailable while
  a session runs.
- The dots-per-person allocation works exactly as in open voting: only
  the current session's dots count toward the limit.
- The countdown shows minutes and seconds (`2:34`, `0:07`) and never
  shows a negative time.
- Ending a timed session — on the clock or early — leaves the dots frozen
  and visible, like ending open voting. A new session, timed or open,
  gives everyone a fresh allocation.

## What it is not

- No anonymous voting: after the reveal, every dot is still tied to the
  person who placed it (the existing vote record already stores that).
- No per-item results panel: the reveal is the existing badge totals.
- No recurring sessions: one round, then the facilitator starts another
  if the room wants one.
