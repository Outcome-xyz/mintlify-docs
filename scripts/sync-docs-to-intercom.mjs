import { readFileSync } from 'fs';
import { marked } from 'marked';

// --- Env validation ---
const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;
const AUTHOR_ID = process.env.INTERCOM_AUTHOR_ID;

if (!INTERCOM_TOKEN || !AUTHOR_ID) {
  console.error('Missing required env vars: INTERCOM_TOKEN, INTERCOM_AUTHOR_ID');
  process.exit(1);
}

const DOCS_BASE = 'https://docs.outcome.xyz';

// --- Derive pages from docs.json (single source of truth) ---
const docsJson = JSON.parse(readFileSync(new URL('../docs.json', import.meta.url), 'utf8'));

function extractPages(pages, group) {
  const result = [];
  for (const page of pages) {
    if (typeof page === 'string') {
      result.push({ slug: page, collection: group });
    } else if (page.pages) {
      result.push(...extractPages(page.pages, page.group ?? group));
    }
  }
  return result;
}

const PAGES = [];
for (const tab of docsJson.navigation.tabs) {
  if (tab.href) continue; // skip external tabs (Support)
  const pages = tab.pages ?? tab.groups?.flatMap(g => extractPages(g.pages, g.group)) ?? [];
  PAGES.push(...extractPages(pages, tab.tab));
}

// --- Intercom API helpers ---
async function intercomRequest(method, path, body) {
  const res = await fetch(`https://api.intercom.io/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${INTERCOM_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Intercom ${method} ${path} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchAllPages(path) {
  const results = [];
  let url = `${path}${path.includes('?') ? '&' : '?'}per_page=250&page=1`;
  while (url) {
    const data = await intercomRequest('GET', url);
    results.push(...data.data);
    url = data.pages?.next ?? null;
  }
  return results;
}

// --- Main sync ---
async function sync() {
  const [allCollections, allArticles] = await Promise.all([
    fetchAllPages('help_center/collections'),
    fetchAllPages('articles'),
  ]);

  const collectionByName = Object.fromEntries(allCollections.map(c => [c.name, c.id]));
  const articleBySlug = Object.fromEntries(
    allArticles.filter(a => a.url).map(a => [a.url.split('/').pop(), a.id])
  );

  const missingCollections = [...new Set(PAGES.map(p => p.collection))].filter(c => !collectionByName[c]);
  if (missingCollections.length) {
    console.error(`Missing Intercom collections: ${missingCollections.join(', ')}`);
    console.error('Create them in Intercom → Help Center → Collections, then re-run.');
    process.exit(1);
  }

  let created = 0, updated = 0, failed = 0;

  for (const page of PAGES) {
    try {
      const res = await fetch(`${DOCS_BASE}/${page.slug}.md`);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${page.slug}.md`);
      let body = await res.text();
      body = body.replace(/!\[.*?\]\(.*?\)/g, '');
      body = marked.parse(body);

      const slug = page.slug.split('/').pop();
      const title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

      const payload = {
        title,
        body,
        author_id: Number(AUTHOR_ID),
        state: 'published',
        parent_id: Number(collectionByName[page.collection]),
        parent_type: 'collection',
      };

      if (articleBySlug[slug]) {
        await intercomRequest('PUT', `articles/${articleBySlug[slug]}`, payload);
        console.log(`Updated: ${title}`);
        updated++;
      } else {
        await intercomRequest('POST', 'articles', payload);
        console.log(`Created: ${title}`);
        created++;
      }
    } catch (err) {
      console.error(`Failed: ${page.slug} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Created: ${created}, Updated: ${updated}, Failed: ${failed}`);

  if (failed > 0) process.exit(1);
}

sync();