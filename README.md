 ◈ XYNEX — News Intelligence Dashboard

News, distilled to the essentials. Every story is decoded into
** WHAT happened → WHY → HOW → IMPACT / what's next **, analyzed live.

![stack](https://img.shields.io/badge/stack-Node%20%C2%B7%20Express%20%C2%B7%20Gemini%20API-22d3ee)

## Features

- **Live feed** — aggregated from TechCrunch, The Verge, MIT News, VentureBeat, The Decoder (RSS, auto-refresh every 5 min)
- **Impact indicators** — CRITICAL / HIGH / MEDIUM / LOW with heuristic pre-badge
- **Headline ticker** — seamless marquee of the latest signals
- **Dark futuristic UI** — sharp cards, neon accents, subtle animations, skeleton loaders, fully responsive
- **Source attribution** — original article link on every analysis

## Project structure

```javascript
ai-news-dashboard/
├── index.html        # UI shell
├── css/style.css     # dark futuristic theme
├── js/app.js         # feed rendering, ticker, detail panel
├── server.js         # RSS aggregation + Gemini proxy + static hosting
├── package.json
├── .env.example
└── README.md
```

## Setup

```bash
git clone https://github.com/<you>/ai-news-dashboard.git
cd ai-news-dashboard
npm install
cp .env.example .env        # paste your key
npm start                   # → http://localhost:3000
```


> Your key lives only in `.env` on the server — never exposed to the browser.

## Deploy (with server)

GitHub Pages hosts static files only, so deploy the full app to a Node host:

- **Render / Railway / Fly.io** — free tiers work. Set env var `GEMINI_API_KEY`, start command `npm start`.
- Or use **GitHub Actions + GitHub Pages** with a serverless Gemini proxy (advanced).

## API

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/news` | GET | Latest aggregated stories (cached 5 min) |
| `/api/summarize` | POST | `{title, teaser, link, source}` → Gemini analysis |

## License

MIT — build, remix, ship.
