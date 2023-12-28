Limitations
===========

This work aims to construct a kind of "symbolic wrapper" around an LLM to compensate for abilities it lacks.
The following limitations of such an approach are uncovered.

1. Irreducibility. Certain tasks such as combining many sources of information into one cannot be decomposed
   into static steps, whereas doing them in one step has limited effectiveness.

2. Active memory. Approaches such as retrieving documents via embedding similarity are too passive for
   complex tasks. Ways for agents to actively construct their needed memory for current tasks are needed.

3. Granularity. Certain tasks may need self-reflection at, say, levels of words or tokens. Currently, we can
   self-reflect only at level of complete responses.

4. Tool use learning. Tools above certain levels of complexity take "time" to learn to use effectively.
   This limits what stateless agents can accomplish. The learning may involve point 2. as well.

I think solving these mentioned points cleanly has potential to lead to complete general intelligence.
Clearly, the current LLM architecture would need at least substantial modification to accomodate them
beyond mere size increases.
