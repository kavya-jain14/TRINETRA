# Package 1B — bounded graph risk

## Product boundary

TRINETRA uses graph proximity as one explainable NETRA-III signal. It does not infer guilt from a
name, token string, or single relationship. The prototype contains fixed synthetic, tokenised data
only and does not claim access to a bank, PSP, NPCI, or real customer graph.

## Durable model

PostgreSQL stores tenant-scoped `graph_nodes` and `graph_edges`. Composite foreign keys prevent an
edge from crossing tenant boundaries, stable external references make fixture writes idempotent,
and a self-loop constraint rejects invalid relationships. Nodes may carry a
`CONFIRMED_FRAUD` label only for the fixed synthetic cases; edges carry observation and expiry
timestamps.

## Traversal contract

Every assessment applies all of these bounds before producing risk:

- exact tenant boundary;
- maximum two hops;
- maximum 250 returned nodes;
- maximum 500 eligible edges;
- 90-day observation window;
- active node and edge expiry checks.

The PostgreSQL adapter first caps the eligible edge pool, then performs the recursive traversal.
The in-memory test adapter enforces the same domain limits. A truncation flag tells the analyst when
the cap affected the returned topology. The exact bounded snapshot used by a decision is copied into
that payment's append-only risk-decision event, so later expiry or graph updates cannot rewrite the
historical analyst evidence.

## Scenario D fixture

The fixed destination `vpa_tok_graph_destination_47` connects to one shared-device cluster. At the
second hop, the cluster connects to two confirmed synthetic cases and two additional synthetic
customers. This produces a capped graph contribution of 75, NETRA-III score 92, and `BLOCK` before
provider submission. One `HIGH / RISK_REVIEW` case records `GRAPH_LINKED_DESTINATION` evidence.

## Safety properties

- Risk comes from explicit repository evidence, never from substrings in a beneficiary token.
- A truncated graph check produces a visible `STEP_UP`; it never silently degrades to `ALLOW`.
- Expired intermediate nodes cannot propagate a relationship to an otherwise active node.
- A blocked graph-linked payment cannot be submitted to the provider.
- Replaying the same demo run returns the same payment and case and creates no provider attempt.
- Browser views receive bounded synthetic references, not raw VPAs or signing material.
- Analyst and consumer copy states that association is a review signal, not proof of guilt.
