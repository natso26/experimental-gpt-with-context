Inventio
========

https://experimental-gpt-with-context-cbzjb4ar2q-as.a.run.app

https://nightly---experimental-gpt-with-context-cbzjb4ar2q-as.a.run.app

NB: need user ID granted by me.


Data
----

Sequence of ``(query, reply)`` with internal flow:

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
   scored by recency and embedding similarity.
   Long-term context of ``summary`` and ``imagination``,
   scored by embedding similarity.

2. Consolidation. ``(query, reply)`` to ``summary``;
   ``summary`` to higher-order ``summary``.

3. Introspection. Analyze ``(query, reply)`` some time after user becomes idle.

4. Imagination. Story on random related selection of ``summary``, ``imagination``.

5. Action. Launch subtasks.

6. Knowledge. Wolfram|Alpha, Google search engine results pages.

7. Research. Scrape web pages.


Engineering
-----------

- Google Cloud Run, Firestore.
- OpenAI API, Wolfram|Alpha API, SerpApi, ZenRows.
- Security by manually added user IDs and secret key.
- Consolidation, introspection by HTTP requests keeping Cloud Run awake.
- Imagination by Cloud Scheduler polling.
- Frontend of query and history pages; VanillaJS.


Local run
---------

0. Pay for Firestore and external APIs.
1. Have ``node``.
2. ``npm install``.
3. ``cp env_data/.dev.env .env``; edit ``.env`` following in-file instructions.
4. ``npm start``.
