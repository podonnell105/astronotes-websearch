# Astronotes

Search the live internet, extract a knowledge graph, validate claims with Jev, and interrogate the result.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and create an account. New accounts start with 5 research credits. Each new run or **Extend graph** costs 1 credit. Follow-up questions against the existing graph are free.

The primary artifact is a dated **Claims** table (supported / uncertain / contradicted) with export and a read-only share link. Graphs persist in `data/astronotes.json`.

## Environment

```
OPENAI_API_KEY=
TAVILY_API_KEY=
JEV_API_KEY=
AUTH_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID=
STRIPE_CREDIT_PACK=20
```

`TAVILY_API_KEY` is used for live web search. Without it, search falls back to OpenAI `web_search`. `JEV_API_KEY` is a TypeSafe / Jev key (`TYPESAFE_API_KEY` is also accepted). `AUTH_SECRET` is optional locally. Stripe keys are optional; without them, Buy credits is hidden and the credit meter still works.

## Modes

- **DEMO MODE** — no `OPENAI_API_KEY`. Uses a built-in lunar communications corpus and mock Jev decisions. The demo is labeled in the UI; mock validation is never presented as live Jev.
- **PARTIAL** — OpenAI present, Jev missing. Live search (Tavily when configured) and extraction; mock Jev.
- **LIVE** — OpenAI and Jev keys present. Tavily search (or OpenAI web search fallback) + extraction; Jev System One for claim classification and entity resolution.

Follow-up questions are answered from the graph unless **Extend graph** is checked, in which case the question is searched on the live web and new evidence is linked to existing entities with Jev before answering.
