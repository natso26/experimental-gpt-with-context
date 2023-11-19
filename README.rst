Experimental GPT
================

Towards artificial consciousness.


Persistence
-----------

Sequence of ``(query, reply)`` pairs externally. Internally:

.. code-block:: none

                   /---
                  v   |
   subroutine <-> (query, reply) <-> introspection
                  ^          ^      /
                  |      /---+------
                  v     v    |
                  summary -> imagination
                   ^   |      ^   |
                    \---       \---


Mechanism
---------

1. Context. Short-term context of ``(query, reply)`` and ``introspection``,
   scored by recency and cosine similarity of embeddings.
   Long-term context of ``summary`` and ``imagination``,
   scored by cosine similarity of embeddings.

2. Consolidation. Summarize ``(query, reply)`` as ``summary``;
   summarize ``summary`` as higher-order ``summary``.

3. Introspection. Thoughts on ``(query, reply)``
   some amount of time after the user's idleness.

4. Imagination. Thoughts on random selection of related ``summary`` and ``imagination``,
   scheduled in advance after user interaction.

5. Subroutine. Can recursively query to itself.


Engineering
-----------

- Google Cloud Run, Firestore.
- Consolidation, Introspection by separate HTTP requests to keep Cloud Run awake.
- Imagination by Cloud Scheduler polling.
- Frontend of chat and history pages; static HTML, vanilla JS.
