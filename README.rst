Experimental Intelligence
=========================

GPT in the machine.


Data
----

Sequence of ``query`` and ``reply`` pairs. Internal flow:

.. code-block:: none

   knowledge
   |                     +--\
   v                    |    v
   [(query, reply) <-> action] <-> introspection
   ^                         ^     |
   |      /------------------+------
   v     v                    \----+
   summary ----------------------> imagination
     |   ^                               |   ^
     +--/                                +--/


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

5. Action. Can launch subtasks including recursion.

6. Knowledge. Query Wolfram|Alpha and Google search engine results pages.

7. Research. Search for information from web sites.


Engineering
-----------

- Google Cloud Run, Firestore.
- Security by manually added user IDs and secret key.
- Consolidation, introspection by HTTP requests to keep Cloud Run awake.
- Imagination by Cloud Scheduler polling.
- Frontend of query and history pages; VanillaJS.
