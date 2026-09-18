/* ═══════════════════════════════════════════════
   XYNEX — News Intelligence · backend
   Serves static UI + live RSS feed + Gemini analysis
   ═══════════════════════════════════════════════ */
"use strict";
require("dotenv").config();
const express = require("express");
const path = require("path");
const Parser = require("rss-parser");
const rateLimit = require("express-rate-limit");

const app = express();
const parser = new Parser({ timeout: 8000 });

const PORT = process.env.PORT || 3000;
const GEMINI_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const NEWS_CACHE_MS = 5 * 60 * 1000;

/* ── sources ─────────────────────────────── */
const FEEDS = [
  { url: "https://techcrunch.com/category/artificial-intelligence/feed/", source: "TechCrunch" },
  { url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml", source: "The Verge" },
  { url: "https://news.mit.edu/rss/topic/artificial-intelligence", source: "MIT News" },
  { url: "https://venturebeat.com/category/ai/feed/", source: "VentureBeat" },
  { url: "https://the-decoder.com/feed/", source: "The Decoder" },
];

/* ── naive impact heuristic (pre-AI badge) ── */
function heuristicImpact(text) {
  const t = text.toLowerCase();
  if (/(safety|regulation|ban|lawsuit|antitrust|executive order|copyright suit|open letter)/.test(t)) return "CRITICAL";
  if (/(gpt-|gemini|claude|llama|frontier|agi|acquisition|funding|billion|open source)/.test(t)) return "HIGH";
  if (/(research|benchmark|model release|launch|api|chip|nvidia)/.test(t)) return "MEDIUM";
  return "LOW";
}
const clean = (s = "") => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

/* ── feed cache ──────────────────────────── */
let newsCache = { at: 0, stories: [] };

async function fetchNews() {
  if (Date.now() - newsCache.at < NEWS_CACHE_MS && newsCache.stories.length) return newsCache.stories;

  const settled = await Promise.allSettled(
    FEEDS.map(async (f) => {
      const feed = await parser.parseURL(f.url);
      return feed.items.slice(0, 8).map((it) => {
        const teaser = clean(it.contentSnippet || it.content || it.title).slice(0, 220);
        return {
          title: clean(it.title),
          link: it.link,
          source: f.source,
          publishedAt: it.isoDate || it.pubDate || new Date().toISOString(),
          teaser,
          impact: heuristicImpact(`${it.title} ${teaser}`),
        };
      });
    })
  );

  const stories = settled
    .filter((r) => r.status === "fulfilled")
    .flatMap((r) => r.value)
    .filter((s) => s.title && s.link)
    /* dedupe by title similarity */
    .filter((s, i, arr) => arr.findIndex((x) => x.title.slice(0, 40) === s.title.slice(0, 40)) === i)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt))
    .slice(0, 30);

  newsCache = { at: Date.now(), stories };
  return stories;
}

/* ── Gemini ──────────────────────────────── */
const summaryCache = new Map(); /* link → analysis */

async function callGemini(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0.25, maxOutputTokens: 900 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

function parseJSON(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("no JSON in response");
  return JSON.parse(m[0]);
}

async function summarize(story) {
  if (summaryCache.has(story.link)) return summaryCache.get(story.link);
  if (!GEMINI_KEY) return fallbackSummary(story);

  const prompt = `You are XYNEX, a razor-sharp AI industry analyst. A reader has 60 seconds. Decode this story with zero fluff.

TITLE: ${story.title}
SOURCE: ${story.source}
SUMMARY: ${story.teaser || "n/a"}

Return STRICT JSON only, no markdown fences, exactly these keys:
{
  "what": "2 sentences — exactly what happened, concrete facts only",
  "why": "2 sentences — the strategic/motivational reason behind it",
  "how": "2 sentences — the mechanism, method or technical path",
  "impact_next": "2 sentences — consequences and what to watch for next",
  "impact": "ONE of: CRITICAL | HIGH | MEDIUM | LOW — based on industry-wide consequence"
}
Rules: plain text, no jargon padding, no hedging, no repetition across fields.`;

  try {
    const raw = await callGemini(prompt);
    const parsed = parseJSON(raw);
    const out = {
      what: String(parsed.what || story.teaser),
      why: String(parsed.why || "—"),
      how: String(parsed.how || "—"),
      impact_next: String(parsed.impact_next || "—"),
      impact: ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(parsed.impact) ? parsed.impact : story.impact,
    };
    summaryCache.set(story.link, out);
    return out;
  } catch (err) {
    console.error("[gemini]", err.message);
    return fallbackSummary(story);
  }
}

function fallbackSummary(story) {
  return {
    what: story.teaser || story.title,
    why: "Automated analysis unavailable for this story.",
    how: "See the original source for technical detail.",
    impact_next: "Monitor this space for follow-up developments.",
    impact: story.impact,
  };
}

/* ── routes ──────────────────────────────── */
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const limiter = rateLimit({ windowMs: 60 * 1000, max: 60 });
app.use("/api/", limiter);

app.get("/api/news", async (req, res) => {
  try { res.json({ stories: await fetchNews() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/summarize", async (req, res) => {
  const { title, teaser, link, source } = req.body || {};
  if (!title || !link) return res.status(400).json({ error: "title and link required" });
  try {
    res.json(await summarize({ title, teaser, link, source: source || "unknown" }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.listen(PORT, () => {
  console.log(`◈ XYNEX online → http://localhost:${PORT}`);
  if (!GEMINI_KEY) console.log("⚠ GEMINI_API_KEY not set — running in fallback mode");
});
