/* ═══════════════════════════════════════════════
   XYNEX — News Intelligence · frontend
   ═══════════════════════════════════════════════ */
"use strict";

const state = { stories: [], filter: "ALL", summaries: new Map(), active: null };
const REFRESH_MS = 5 * 60 * 1000;

const $ = (s) => document.querySelector(s);
const feedGrid = $("#feedGrid");
const tickerTrack = $("#tickerTrack");
const panel = $("#detailPanel");
const panelScroll = $("#panelScroll");
const overlay = $("#overlay");

/* ── helpers ─────────────────────────────── */
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}
function escapeHTML(str = "") {
  return str.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function impactHTML(level) {
  const l = (level || "MEDIUM").toUpperCase();
  return `<span class="impact lvl-${l}"><i></i>${l}</span>`;
}

/* ── reveal on scroll ────────────────────── */
const revealObs = new IntersectionObserver(
  (entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); revealObs.unobserve(e.target); }
  }), { threshold: 0.08 });
function observeReveals(root = document) {
  root.querySelectorAll(".reveal:not(.in)").forEach((el) => revealObs.observe(el));
}

/* ── data ────────────────────────────────── */
async function loadNews() {
  $("#refreshBtn").classList.add("spinning");
  try {
    const res = await fetch("/api/news");
    if (!res.ok) throw new Error("feed error");
    const data = await res.json();
    state.stories = data.stories || [];
    renderAll();
    $("#liveText").textContent = "LIVE";
    $("#lastUpdated").textContent = "UPDATED " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (err) {
    $("#liveText").textContent = "OFFLINE";
    feedGrid.innerHTML = `<div class="skel" style="grid-column:1/-1;height:auto;padding:30px">
      <div class="s1" style="width:60%"></div>
      <div class="s3" style="width:90%"></div></div>`;
  } finally {
    $("#refreshBtn").classList.remove("spinning");
  }
}

function renderAll() {
  renderStats();
  renderFilters();
  renderTicker();
  renderFeed();
}

function renderStats() {
  const sources = new Set(state.stories.map((s) => s.source)).size;
  const high = state.stories.filter((s) => ["CRITICAL", "HIGH"].includes(s.impact)).length;
  $("#statsRow").innerHTML = `
    <div class="stat-chip"><b>${state.stories.length}</b>SIGNALS TRACKED</div>
    <div class="stat-chip"><b>${sources}</b>SOURCES</div>
    <div class="stat-chip"><b>${high}</b>HIGH-IMPACT</div>
    <div class="stat-chip"><b>XYNEX</b>ANALYSIS ENGINE</div>`;
}

function renderFilters() {
  const sources = ["ALL", ...new Set(state.stories.map((s) => s.source))];
  $("#feedFilters").innerHTML = sources.map((s) =>
    `<button class="filter-btn ${s === state.filter ? "active" : ""}" data-f="${escapeHTML(s)}">${escapeHTML(s.toUpperCase())}</button>`
  ).join("");
  document.querySelectorAll(".filter-btn").forEach((b) =>
    b.addEventListener("click", () => { state.filter = b.dataset.f; renderFilters(); renderFeed(); }));
}

function renderTicker() {
  const items = state.stories.slice(0, 12).map((s, i) =>
    `<span class="ticker-item" data-i="${i}"><span class="tick-dot">◆</span>${escapeHTML(s.title)}</span>`
  ).join("");
  tickerTrack.innerHTML = items + items; /* duplicate for seamless loop */
  tickerTrack.querySelectorAll(".ticker-item").forEach((el) =>
    el.addEventListener("click", () => openStory(state.stories[+el.dataset.i])));
}

function renderFeed() {
  const list = state.filter === "ALL"
    ? state.stories
    : state.stories.filter((s) => s.source === state.filter);

  feedGrid.innerHTML = list.map((s, i) => `
    <article class="card" data-link="${escapeHTML(s.link)}" style="transition-delay:${Math.min(i * 45, 400)}ms">
      <div class="card-top">
        <span class="card-idx">${String(i + 1).padStart(2, "0")}</span>
        <span class="card-src">${escapeHTML(s.source)}</span>
        <span class="card-time">${timeAgo(s.publishedAt)}</span>
      </div>
      <h3 class="card-title">${escapeHTML(s.title)}</h3>
      <p class="card-teaser">${escapeHTML(s.teaser || "")}</p>
      <div class="card-bottom">
        ${impactHTML(s.impact)}
        <span class="card-cta">FULL ANALYSIS →</span>
      </div>
    </article>`).join("");

  feedGrid.querySelectorAll(".card").forEach((card) =>
    card.addEventListener("click", () =>
      openStory(state.stories.find((s) => s.link === card.dataset.link))));

  /* staggered entrance */
  requestAnimationFrame(() =>
    feedGrid.querySelectorAll(".card").forEach((c) => c.classList.add("in")));
}

/* ── detail panel ────────────────────────── */
function openStory(story) {
  if (!story) return;
  state.active = story;
  panelScroll.innerHTML = `
    <div class="panel-loading"><div class="rings"></div><br>ANALYZING SIGNAL…</div>`;
  panel.classList.add("open");
  overlay.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  panelScroll.scrollTop = 0;
  fetchSummary(story);
}

function closePanel() {
  panel.classList.remove("open");
  overlay.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

async function fetchSummary(story) {
  /* instant if cached */
  if (state.summaries.has(story.link)) return renderSummary(story, state.summaries.get(story.link));

  try {
    const res = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: story.title, teaser: story.teaser, link: story.link, source: story.source }),
    });
    if (!res.ok) throw new Error("summarize failed");
    const data = await res.json();
    state.summaries.set(story.link, data);
    renderSummary(story, data);
  } catch (err) {
    /* graceful fallback — show raw teaser */
    renderSummary(story, {
      what: story.teaser || story.title,
      why: "Analysis engine unavailable. Open the source for full context.",
      how: "—",
      impact_next: "—",
      impact: story.impact || "MEDIUM",
    });
  }
}

function renderSummary(story, a) {
  const lvl = (a.impact || "MEDIUM").toUpperCase();
  panelScroll.innerHTML = `
    <div class="panel-kicker">◈ SIGNAL ANALYSIS</div>
    <h2 class="panel-title">${escapeHTML(story.title)}</h2>
    <div class="panel-meta">
      <span>SRC // ${escapeHTML(story.source.toUpperCase())}</span>
      <span>${timeAgo(story.publishedAt)}</span>
      <a href="${escapeHTML(story.link)}" target="_blank" rel="noopener">ORIGINAL ARTICLE ↗</a>
    </div>
    <div class="panel-impact lvl-${lvl}">IMPACT · ${lvl}</div>

    <div class="block">
      <div class="block-head"><span class="block-num">01</span><span class="block-label">WHAT HAPPENED</span></div>
      <p>${escapeHTML(a.what)}</p><div class="block-bar"></div>
    </div>
    <div class="block">
      <div class="block-head"><span class="block-num">02</span><span class="block-label">WHY IT HAPPENED</span></div>
      <p>${escapeHTML(a.why)}</p><div class="block-bar"></div>
    </div>
    <div class="block">
      <div class="block-head"><span class="block-num">03</span><span class="block-label">HOW IT HAPPENED</span></div>
      <p>${escapeHTML(a.how)}</p><div class="block-bar"></div>
    </div>
    <div class="block">
      <div class="block-head"><span class="block-num">04</span><span class="block-label next">IMPACT / WHAT'S NEXT</span></div>
      <p>${escapeHTML(a.impact_next)}</p><div class="block-bar next"></div>
    </div>

    <div class="block">
      <div class="block-head"><span class="block-num">05</span><span class="block-label">SOURCES</span></div>
      <div class="panel-sources">
        <a href="${escapeHTML(story.link)}" target="_blank" rel="noopener">◆ ${escapeHTML(story.source)} — original report ↗</a>
      </div>
      <span class="gemini-tag"><i></i>ANALYZED BY XYNEX ENGINE</span>
    </div>`;
}

/* ── boot ────────────────────────────────── */
function skeletons() {
  feedGrid.innerHTML = Array.from({ length: 6 }, () =>
    `<div class="skel"><div class="s1"></div><div class="s2"></div><div class="s3"></div><div class="s4"></div></div>`).join("");
}

$("#refreshBtn").addEventListener("click", loadNews);
$("#panelClose").addEventListener("click", closePanel);
overlay.addEventListener("click", closePanel);
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });

skeletons();
observeReveals();
loadNews();
setInterval(loadNews, REFRESH_MS);
setInterval(() => { /* live timestamps */
  document.querySelectorAll(".card-time").forEach((el, i) => {
    const list = state.filter === "ALL" ? state.stories : state.stories.filter((s) => s.source === state.filter);
    if (list[i]) el.textContent = timeAgo(list[i].publishedAt);
  });
}, 30000);
