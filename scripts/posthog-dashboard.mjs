/**
 * Builds the "Docs Master" PostHog dashboard from the events analytics.js emits.
 *
 * Dashboard-as-code: re-running this reconciles the dashboard in place (it
 * matches existing tiles by name and updates them), so the dashboard is
 * reviewable in git rather than being a thing someone clicked together once.
 *
 *   node scripts/posthog-dashboard.mjs          # create/update
 *   node scripts/posthog-dashboard.mjs --dry    # print the plan only
 *
 * Reads POSTHOG_* from .env.local (gitignored).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");

const env = Object.fromEntries(
  readFileSync(join(ROOT, ".env.local"), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const HOST = env.POSTHOG_HOST;
const PROJECT = env.POSTHOG_PROJECT_ID;
const KEY = env.POSTHOG_PERSONAL_API_KEY;
const API = `${HOST}/api/projects/${PROJECT}`;
const DASHBOARD_NAME = "📊 Docs Master — Outcome";

if (!KEY) throw new Error("POSTHOG_PERSONAL_API_KEY missing from .env.local");

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${res.status} non-JSON from ${path}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${JSON.stringify(json).slice(0, 300)}`);
  return json;
}

// ---------------------------------------------------------------------------
// Query builders
// ---------------------------------------------------------------------------

const DATE = { date_from: "-30d" };

const ev = (event, extra = {}) => ({ kind: "EventsNode", event, math: "total", ...extra });

const prop = (key, value, operator = "exact", type = "event") => ({
  key,
  value: Array.isArray(value) ? value : [value],
  operator,
  type,
});

const viz = (source) => ({ kind: "InsightVizNode", source });

function trends(series, { display = "ActionsLineGraph", breakdown, interval = "day", dateRange = DATE, formula, compare } = {}) {
  const source = {
    kind: "TrendsQuery",
    interval,
    dateRange,
    series,
    trendsFilter: { display, ...(formula ? { formula } : {}) },
    ...(compare ? { compareFilter: { compare: true } } : {}),
  };
  if (breakdown) {
    source.breakdownFilter = {
      breakdowns: [{ property: breakdown.property, type: breakdown.type || "event" }],
      breakdown_limit: breakdown.limit || 15,
    };
  }
  return viz(source);
}

function funnel(series, { dateRange = DATE } = {}) {
  return viz({
    kind: "FunnelsQuery",
    dateRange,
    series,
    funnelsFilter: { funnelVizType: "steps", funnelOrderType: "ordered" },
  });
}

function retention({ dateRange = { date_from: "-60d" } } = {}) {
  return viz({
    kind: "RetentionQuery",
    dateRange,
    retentionFilter: {
      period: "Week",
      totalIntervals: 8,
      targetEntity: { id: "$pageview", name: "$pageview", type: "events" },
      returningEntity: { id: "$pageview", name: "$pageview", type: "events" },
      retentionType: "retention_first_time",
      meanRetentionCalculation: "simple",
    },
  });
}

const hogql = (query) => ({
  kind: "DataTableNode",
  source: { kind: "HogQLQuery", query },
});

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

const TILES = [];
const text = (body) => TILES.push({ type: "text", body });
const insight = (name, description, query, layout) =>
  TILES.push({ type: "insight", name, description, query, layout });

// ── Section: the numbers you'd quote in a meeting ──────────────────────────
text("## 📈 Audience\nWho is reading the docs, on what, and how many of them come back.");

insight(
  "Readers (unique)",
  "Unique people who viewed any docs page. The headline number.",
  trends([ev("$pageview", { math: "dau" })], { display: "BoldNumber", dateRange: { date_from: "-30d" } }),
  { w: 3, h: 3 }
);

insight(
  "Pageviews",
  "Total docs pageviews, including SPA route changes.",
  trends([ev("$pageview")], { display: "BoldNumber" }),
  { w: 3, h: 3 }
);

insight(
  "Code copies",
  "Times a reader copied a code block — the strongest SDK-intent signal we have.",
  trends([ev("docs_code_copied")], { display: "BoldNumber" }),
  { w: 3, h: 3 }
);

insight(
  "Docs → App clicks",
  "Clicks on any outcome.xyz link. The docs' actual conversion event.",
  trends([ev("docs_app_cta_clicked")], { display: "BoldNumber" }),
  { w: 3, h: 3 }
);

insight(
  "Readers & pageviews over time",
  "Daily unique readers vs total pageviews, compared to the previous period.",
  trends([ev("$pageview", { math: "dau", custom_name: "Unique readers" }), ev("$pageview", { custom_name: "Pageviews" })], {
    display: "ActionsLineGraph",
    compare: true,
  }),
  { w: 12, h: 5 }
);

insight(
  "Traffic by tab",
  "Documentation vs SDK Reference vs Guides. Where attention actually goes.",
  trends([ev("$pageview")], { display: "ActionsPie", breakdown: { property: "docs_tab" } }),
  { w: 4, h: 5 }
);

insight(
  "Device class",
  "Mobile / tablet / desktop, bucketed by viewport at page load.",
  trends([ev("$pageview")], { display: "ActionsPie", breakdown: { property: "docs_device_class" } }),
  { w: 4, h: 5 }
);

insight(
  "Viewport width buckets",
  "Finer-grained than device class — shows which breakpoints to actually design for.",
  trends([ev("$pageview")], { display: "ActionsBarValue", breakdown: { property: "docs_viewport_bucket" } }),
  { w: 4, h: 5 }
);

insight(
  "Top pages",
  "Most-viewed pages over the period.",
  trends([ev("$pageview")], { display: "ActionsBarValue", breakdown: { property: "docs_slug", limit: 25 } }),
  { w: 6, h: 6 }
);

insight(
  "Top nav groups",
  "Which section of the docs pulls traffic, read from the rendered breadcrumb.",
  trends([ev("$pageview")], { display: "ActionsBarValue", breakdown: { property: "docs_group" } }),
  { w: 6, h: 6 }
);

insight(
  "Returning readers (weekly retention)",
  "Do people come back to the docs? First-time cohort, weekly.",
  retention(),
  { w: 12, h: 5 }
);

// ── Section: engagement ────────────────────────────────────────────────────
text(
  "## 📖 Reading & engagement\n`docs_engaged_ms` counts only *active* time — it stops after 30s idle and pauses on a hidden tab, so it's real reading time, not tab-left-open time."
);

insight(
  "Reading depth funnel",
  "Of readers who land on a page, how many actually scroll through it. Drop-off here = the page is too long, or the top isn't earning the scroll.",
  funnel([
    ev("docs_page_entered", { custom_name: "Landed" }),
    ev("docs_scroll_depth", { custom_name: "25%", properties: [prop("docs_depth_pct", "25")] }),
    ev("docs_scroll_depth", { custom_name: "50%", properties: [prop("docs_depth_pct", "50")] }),
    ev("docs_scroll_depth", { custom_name: "75%", properties: [prop("docs_depth_pct", "75")] }),
    ev("docs_scroll_depth", { custom_name: "100%", properties: [prop("docs_depth_pct", "100")] }),
  ]),
  { w: 8, h: 6 }
);

insight(
  "Median engaged time",
  "Median active seconds per page visit.",
  trends([ev("docs_page_exited", { math: "median", math_property: "docs_engaged_ms" })], {
    display: "ActionsLineGraph",
  }),
  { w: 4, h: 6 }
);

insight(
  "Hardest pages to finish",
  "Median max-scroll per page. Low = people bail before the end. Pair with the recordings.",
  hogql(`
SELECT
  properties.docs_slug AS page,
  count() AS visits,
  round(median(toFloat(properties.docs_max_scroll_pct))) AS median_scroll_pct,
  round(100 * countIf(properties.docs_read_to_end = true) / count()) AS pct_read_to_end,
  round(median(toFloat(properties.docs_engaged_ms)) / 1000) AS median_engaged_s
FROM events
WHERE event = 'docs_page_exited' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY page
HAVING visits > 2
ORDER BY median_scroll_pct ASC
LIMIT 25`),
  { w: 12, h: 6 }
);

// ── Section: SDK ───────────────────────────────────────────────────────────
text("## 💻 SDK & code\nWhat developers copy is what they're actually building. This is the closest thing the docs have to a usage metric.");

insight(
  "Code copies by language",
  "Which languages readers copy. A language nobody copies is a language nobody uses.",
  trends([ev("docs_code_copied")], { display: "ActionsPie", breakdown: { property: "docs_code_language" } }),
  { w: 4, h: 5 }
);

insight(
  "Code copies by page",
  "Which pages drive real SDK usage.",
  trends([ev("docs_code_copied")], { display: "ActionsBarValue", breakdown: { property: "docs_slug", limit: 20 } }),
  { w: 8, h: 5 }
);

insight(
  "Most-copied snippets",
  "The exact snippets people take. If one dominates, it belongs in the quickstart.",
  hogql(`
SELECT
  properties.docs_code_language AS lang,
  properties.docs_code_preview AS snippet,
  properties.docs_slug AS page,
  count() AS copies
FROM events
WHERE event = 'docs_code_copied' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY lang, snippet, page
ORDER BY copies DESC
LIMIT 25`),
  { w: 12, h: 6 }
);

// ── Section: search ────────────────────────────────────────────────────────
text(
  "## 🔍 Search & content gaps\nA search with no result click is a reader telling you the page doesn't exist. This is the highest-signal table on the dashboard."
);

insight(
  "Searches with no result clicked",
  "Content gaps, ranked. Each row is a question the docs failed to answer.",
  hogql(`
SELECT
  lower(trim(properties.docs_query)) AS query,
  count() AS searches,
  max(properties.docs_result_count) AS results_shown
FROM events
WHERE event = 'docs_search_query'
  AND timestamp > now() - INTERVAL 30 DAY
  AND lower(trim(properties.docs_query)) NOT IN (
    SELECT lower(trim(properties.docs_query))
    FROM events
    WHERE event = 'docs_search_result_clicked' AND timestamp > now() - INTERVAL 30 DAY
  )
GROUP BY query
ORDER BY searches DESC
LIMIT 30`),
  { w: 6, h: 6 }
);

insight(
  "Top search queries",
  "Everything people search for, whether or not it worked out.",
  hogql(`
SELECT
  lower(trim(properties.docs_query)) AS query,
  count() AS searches,
  uniq(person_id) AS people
FROM events
WHERE event = 'docs_search_query' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY query
ORDER BY searches DESC
LIMIT 30`),
  { w: 6, h: 6 }
);

insight(
  "Search: opened → typed → clicked",
  "Where the search experience loses people.",
  funnel([
    ev("docs_search_opened", { custom_name: "Opened search" }),
    ev("docs_search_query", { custom_name: "Typed a query" }),
    ev("docs_search_result_clicked", { custom_name: "Clicked a result" }),
  ]),
  { w: 12, h: 5 }
);

// ── Section: conversion ────────────────────────────────────────────────────
text("## 🎯 Conversion & AI surfaces\nThe docs exist to get people into the app — and increasingly, into an agent.");

insight(
  "Docs → App by placement",
  "Which CTA placement actually earns the click: navbar, banner, sidebar, or in-content.",
  trends([ev("docs_app_cta_clicked")], { display: "ActionsBarValue", breakdown: { property: "docs_cta_location" } }),
  { w: 4, h: 5 }
);

insight(
  "AI / contextual actions",
  "docs.json exposes copy-page, ChatGPT, Claude, Cursor, VS Code and MCP. This is which ones developers actually use.",
  trends([ev("docs_contextual_action")], { display: "ActionsBarValue", breakdown: { property: "docs_action" } }),
  { w: 4, h: 5 }
);

insight(
  "Outbound links by host",
  "Where the docs send people — Discord, GitHub, Hyperliquid, elsewhere.",
  trends([ev("docs_external_link_clicked")], { display: "ActionsBarValue", breakdown: { property: "docs_link_host" } }),
  { w: 4, h: 5 }
);

insight(
  "Pages that convert to the app",
  "Read-then-click, by page. These pages are doing the selling.",
  hogql(`
SELECT
  properties.docs_slug AS page,
  count() AS cta_clicks,
  uniq(person_id) AS people
FROM events
WHERE event = 'docs_app_cta_clicked' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY page
ORDER BY cta_clicks DESC
LIMIT 20`),
  { w: 12, h: 5 }
);

// ── Section: friction ──────────────────────────────────────────────────────
text(
  "## 🩹 Friction & health\nRage clicks and dead clicks are readers trying to interact with something that isn't interactive. Every row here has a session recording behind it."
);

insight(
  "Rage & dead clicks",
  "$rageclick = 3 clicks in ~1s in the same spot. $dead_click = a click that changed nothing.",
  trends([ev("$rageclick", { custom_name: "Rage clicks" }), ev("$dead_click", { custom_name: "Dead clicks" })], {
    display: "ActionsLineGraph",
  }),
  { w: 6, h: 5 }
);

insight(
  "Where readers rage-click",
  "Ranked by page. Open the recording for any of these.",
  trends([ev("$rageclick")], { display: "ActionsBarValue", breakdown: { property: "docs_slug" } }),
  { w: 6, h: 5 }
);

insight(
  "Broken assets & JS errors",
  "Images that 404 and scripts that throw — invisible in pageview stats, very visible to the reader.",
  trends(
    [ev("docs_asset_failed", { custom_name: "Broken assets" }), ev("docs_js_error", { custom_name: "JS errors" })],
    { display: "ActionsLineGraph" }
  ),
  { w: 6, h: 5 }
);

insight(
  "Core Web Vitals (p75)",
  "PostHog captures LCP/CLS/INP/FCP via $web_vitals. p75 is what Google grades you on.",
  trends(
    [
      ev("$web_vitals", { custom_name: "LCP p75", math: "p75", math_property: "$web_vitals_LCP_value" }),
      ev("$web_vitals", { custom_name: "INP p75", math: "p75", math_property: "$web_vitals_INP_value" }),
      ev("$web_vitals", { custom_name: "FCP p75", math: "p75", math_property: "$web_vitals_FCP_value" }),
    ],
    { display: "ActionsLineGraph" }
  ),
  { w: 6, h: 5 }
);

insight(
  "Theme preference",
  "Dark vs light, as actually rendered.",
  trends([ev("$pageview")], { display: "ActionsPie", breakdown: { property: "docs_theme" } }),
  { w: 4, h: 4 }
);

insight(
  "Exit reasons",
  "How page visits end: SPA navigation vs leaving the site entirely.",
  trends([ev("docs_page_exited")], { display: "ActionsPie", breakdown: { property: "docs_exit_reason" } }),
  { w: 4, h: 4 }
);

insight(
  "Top exit pages",
  "Where readers leave the docs for good — high exits on a mid-funnel page is a problem.",
  hogql(`
SELECT
  properties.docs_slug AS page,
  countIf(properties.docs_exit_reason = 'pagehide') AS left_site,
  count() AS all_exits,
  round(100 * countIf(properties.docs_exit_reason = 'pagehide') / count()) AS pct_left
FROM events
WHERE event = 'docs_page_exited' AND timestamp > now() - INTERVAL 30 DAY
GROUP BY page
HAVING all_exits > 2
ORDER BY left_site DESC
LIMIT 20`),
  { w: 4, h: 4 }
);

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

async function main() {
  const insights = TILES.filter((t) => t.type === "insight");
  console.log(`Plan: ${insights.length} insights + ${TILES.length - insights.length} section headers\n`);
  if (DRY) {
    for (const t of TILES) {
      console.log(t.type === "text" ? `\n  ── ${t.body.split("\n")[0].replace(/^##\s*/, "")}` : `     • ${t.name}`);
    }
    return;
  }

  const existing = await api(`/dashboards/?limit=100`);
  let dash = (existing.results || []).find((d) => d.name === DASHBOARD_NAME);
  if (dash) {
    console.log(`Reusing dashboard ${dash.id}`);
  } else {
    dash = await api(`/dashboards/`, {
      method: "POST",
      body: JSON.stringify({
        name: DASHBOARD_NAME,
        description: "Everything readers do on docs.outcome.xyz. Generated by scripts/posthog-dashboard.mjs.",
        pinned: true,
      }),
    });
    console.log(`Created dashboard ${dash.id}`);
  }

  // The dashboard detail endpoint is the only reliable way to read what's
  // already on it — /insights/?dashboards=<id> 500s on this deployment.
  const detail = await api(`/dashboards/${dash.id}/`);
  const tiles = detail.tiles || [];
  const byName = new Map(
    tiles.filter((t) => t.insight && !t.insight.deleted).map((t) => [t.insight.name, t.insight])
  );
  const existingText = new Set(tiles.filter((t) => t.text).map((t) => (t.text.body || "").trim()));

  let created = 0;
  let updated = 0;
  const failures = [];

  for (const t of TILES) {
    if (t.type === "text") {
      // Text tiles have no natural key, so match on body to stay idempotent.
      if (existingText.has(t.body.trim())) continue;
      try {
        // create_text_tile wants `body` at the top level, not nested under `text`
        // (the response nests it, the request does not).
        await api(`/dashboards/${dash.id}/create_text_tile/`, {
          method: "POST",
          body: JSON.stringify({ body: t.body }),
        });
      } catch (e) {
        failures.push(`text tile: ${e.message.slice(0, 120)}`);
      }
      continue;
    }

    const body = {
      name: t.name,
      description: t.description,
      query: t.query,
      dashboards: [dash.id],
      saved: true,
    };
    try {
      const prev = byName.get(t.name);
      if (prev) {
        await api(`/insights/${prev.id}/`, { method: "PATCH", body: JSON.stringify(body) });
        updated++;
      } else {
        await api(`/insights/`, { method: "POST", body: JSON.stringify(body) });
        created++;
      }
      process.stdout.write(".");
    } catch (e) {
      failures.push(`${t.name}: ${e.message.slice(0, 220)}`);
      process.stdout.write("x");
    }
  }

  console.log(`\n\ncreated=${created} updated=${updated} failed=${failures.length}`);
  for (const f of failures) console.log("  ❌ " + f);
  console.log(`\n${HOST}/project/${PROJECT}/dashboard/${dash.id}`);
}

await main();
