experimental-gpt-with-context
=============================

Bring GPT-4 close to an "artificially conscious agent,"
while improving conversational abilities along the way.


Features
--------

``(question, reply)`` pairs of lengths <= ``(256, 512)`` tokens,
+ internal items.

Relevance computation using OpenAI embedding ``text-embedding-ada-002``
via vector search.

- **Short-term memory**. 7 slots of either ``(question, reply)``
  or ``introspection``, ranked by relevance and recency
  (index position and timestamp).

- **Long-term memory**. 2 slots of either ``summary`` or ``imagination``,
  ranked by relevance only.

  - Auto-consolidate ``(question, reply)`` as ``summary`` (8 at a time,
    interleaving at every 4).

  - Hierarchically auto-consolidate ``summary`` as higher-level ``summary``
    (4 at a time, up to 8 extra levels).

  - Cut off at 63 most recent ``summary`` in each level.

- **Introspection**. 3 to 15 minutes, exponentially sampled, after an interaction,
  an ``introspection`` of 6 most recent ``(question, reply)`` occurs,
  unless a newer ``(question, reply)`` has been added.

  - It goes into the short-term memory.

- **Imagination**. Weirdly named, at a scheduled time occurring between roughly
  6 and 12 hours in the future, a ``summary`` or ``imagination`` is randomly selected,
  3 more closest items from the long-term memory are taken, and an ``imagination``
  is generated from these 4 items.

  - After an imagination occurs, the schedule is cleared, and the next interaction
    will schedule a new imagination.

  - It goes into its own level in the long-term memory, and is cut off
    and searched along with ``summary``.


Diagram
-------

.. code-block:: none

                       /---
                      v   |
   Short-term memory: (question, reply) <-> introspection
                      ^          ^         /
                      |      /---+---------
                      v     v    |
   Long-term memory:  summary -> imagination
                      ^   |      ^   |
                       \---       \---


Infrastructure
--------------

- We deploy on GCP Cloud Run + Firestore. Provide your own ``OPENAI_API_KEY``
  and other necessary environment variables.

- Summarization and introspection are launched as "background" HTTP requests
  to the same Cloud Run URL rather than Node.js async tasks, to keep
  Cloud Run awake.

- Imagination is launched by polling from Cloud Scheduler every 15 minutes.

- Frontend consists of 2 "static" HTML pages: ``/`` for chat
  and ``/history`` for history. We have minimal but effective reactivity
  via vanilla JS.


Does it work?
-------------

Yes. Already much better than expected with ``gpt-4-0613``, it seems exponentially
better with ``gpt-4-1106-preview``.
