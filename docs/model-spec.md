# Executable model specification

The implementation is [src/model.ts](../src/model.ts). This document specifies the modeled transition system in plain language. No external formal-language tool was used.

## State domains

| Field | Domain | Persistence / meaning |
| --- | --- | --- |
| `started` | Boolean | Whether the one transaction has begun. Retained through coordinator crash. |
| `coordinatorUp` | Boolean | Coordinator availability. |
| `coordinatorDecision` | `_`, `C`, `A` | Durable undecided, commit, or abort. |
| `decisionBroadcast` | Boolean | Volatile send flag; reset on coordinator crash. |
| `observedVotes[p]` | `_`, `Y`, `N` | Volatile coordinator vote cache; cleared on crash. |
| `participantVotes[p]` | `_`, `Y`, `N` | Durable participant vote. YES means prepared. |
| `participantDecisions[p]` | `_`, `C`, `A` | Durable final participant decision. |
| `messages` | Multiset of message strings | In-flight network messages, retained across coordinator crashes. |
| `losses`, `duplicates`, `crashes` | Nonnegative integers | Consumed global fault budgets; retained in state identity. |

The initial state has `coordinatorUp=true` and everything else unset/false/empty/zero. Participants are indexed `0..N-1`; they are always available. The model assumes atomic local persistent state transitions and excludes storage corruption or torn writes.

Messages are `prepare:p`, `vote-Y:p`, `vote-N:p`, `decision-C:p`, or `decision-A:p`. The integer identifies the receiving participant for PREPARE/decision and the sending participant for a vote. There is exactly one transaction, so no transaction-ID domain is needed. Delivery, loss and duplication select a message kind in the current multiset and consume/add one copy as specified.

## Transitions

1. **Start:** if the coordinator is up and the transaction has not started, mark it started and enqueue one PREPARE per participant.
2. **Deliver PREPARE:** consume one PREPARE. If the participant has a durable vote, resend that vote unchanged. Otherwise, if it has already aborted, persist and send NO. Otherwise nondeterministically persist YES or NO and enqueue the corresponding vote. NO also sets the participant decision to ABORT. Participants never overwrite a prior vote.
3. **Deliver vote:** only while the coordinator is up, consume the vote and set that participant's cache slot. Message provenance ensures repeated votes from a participant agree; the model has no Byzantine or fabricated messages.
4. **Persist COMMIT:** while up, started and undecided, the correct coordinator may commit only when every cache slot is YES. The partial-vote mutant weakens this to any YES slot. This transition does not send decisions yet.
5. **Persist ABORT:** while up, started and undecided, the coordinator may abort after any NO reaches its cache. There is no modeled coordinator timeout or spontaneous abort.
6. **Broadcast decision:** while up with a durable decision and no completed current broadcast, mark the broadcast done and enqueue one decision message per participant. Enqueueing all recipients is atomic in the model; delivery is not.
7. **Deliver decision:** consume one decision message. A participant with a final decision keeps it. An undecided participant accepts ABORT, or accepts COMMIT only when it has a durable YES vote. A premature COMMIT to an unprepared participant is consumed without deciding. The correct model never generates this premature case; the partial-vote mutant can.
8. **Coordinator crash:** if up and crash budget remains, mark down, clear observed votes and broadcast flag, and increment crash count. Durable decisions, participant votes/decisions, transaction-start marker, and in-flight messages remain.
9. **Coordinator recovery:** if down, mark up. If the transaction started and the coordinator is still undecided, enqueue one PREPARE per participant. If it has a durable final decision, the ordinary decision-broadcast transition becomes enabled. No further crash is possible when the one-crash budget is consumed.
10. **Drop:** if loss budget remains, consume one message and increment loss count.
11. **Duplicate:** if duplication budget remains, add a copy of one existing message and increment duplication count.
12. **Prepared timeout abort (mutant only):** a participant with durable YES and no final decision may set its durable decision to ABORT. The action has no clock precondition. It is deliberately unsafe.

Enabled transitions are enumerated in a deterministic order. Any may be selected by the search. The search does not impose delivery order, fairness, automatic eventual recovery or an eventual-decision obligation.

## Safety predicates

**Agreement:** no state contains both `C` and `A` in the participant decision vector.

**Validity:** if the coordinator or any participant is committed, every participant vote equals `Y`. This is a necessary commit-validity property, not a separate proof that the coordinator received each vote before committing. Receipt is enforced by the baseline transition guard.

**Durable monotonicity:** for every transition, each already-set coordinator decision, participant decision, or participant vote equals its value in the successor. Unset values may become set. Vote-cache loss is allowed because the cache is volatile.

State predicates are counted once per unique discovered state. Durable monotonicity is counted per traversed edge, including edges whose target state was already seen. These count units are explicit in the JSON and CSV.

## Conditional blocking predicate

The coordinator is down and undecided; every participant has durably voted YES and remains undecided; and no decision message exists. Under continued coordinator unavailability, allowed network actions cannot produce a decision. Recovery is nevertheless enabled in the global transition system. The witness is not called a deadlock, and no liveness/fairness result follows from it.

## Finite bounds and completion

Recorded configurations are exactly those in [src/scenarios.ts](../src/scenarios.ts). Maximum participants is three; maximum recorded loss/duplication/crash budget is one, with all three fault dimensions applied together only to two participants. A crash count of zero or one is the supported implementation domain. Recovery occurs only from down, so no separate unbounded recovery count exists.

Without crashes, the maximum possible in-flight messages is bounded by `2N + D`; with one crash, by `3N + D`. Every delivered PREPARE replaces itself with one response. At most one initial phase, one recovery resend, and one decision phase can contribute messages in the undecided-at-crash case. If a durable decision already existed, recovery replaces the prepare resend with a decision resend. Additional duplicate messages are bounded by `D`; loss only decreases the multiset. The bound is an assertion, not an action filter.

Breadth-first search canonicalizes the message bag, tracks visited keys, and explores all successor edges until the queue is empty. The 100,000-state resource guard is not part of the protocol semantics; hitting it marks the search incomplete. It does not silently remove states. First-discovery depth is measured in unit transitions, so the first witness of a state predicate has shortest action length. The checker stores predecessor links for selected witness reconstruction; the full graph is not published.

The peak frontier statistic includes the active state until all its edges finish. `statesExpanded` counts only fully processed states. A terminal state has no enabled transition; it may still contain undecided participants after a dropped message. Therefore terminal states are not interpreted as successful transaction completions.
