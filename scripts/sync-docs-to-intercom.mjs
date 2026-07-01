const INTERCOM_TOKEN = process.env.INTERCOM_TOKEN;
const AUTHOR_ID = process.env.INTERCOM_AUTHOR_ID;
const DOCS_BASE = 'https://docs.outcome.xyz';

const PAGES = [
  // Get Started
  { slug: 'introduction',                      title: 'Introduction',                    collection: 'Get Started' },
  { slug: 'wallets-and-accounts',              title: 'Wallets & Accounts',              collection: 'Get Started' },
  { slug: 'funding-your-account',              title: 'Funding Your Account',            collection: 'Get Started' },
  { slug: 'placing-your-first-trade',          title: 'Placing Your First Trade',        collection: 'Get Started' },
  // Concepts
  { slug: 'how-prediction-markets-work',       title: 'How Prediction Markets Work',     collection: 'Concepts' },
  { slug: 'outcome-and-hyperliquid',           title: 'Outcome & Hyperliquid',           collection: 'Concepts' },
  { slug: 'outcome-tokens-and-pricing',        title: 'Outcome Tokens & Pricing',        collection: 'Concepts' },
  { slug: 'market-types',                      title: 'Market Types',                    collection: 'Concepts' },
  { slug: 'recurring-markets',                 title: 'Recurring Markets',               collection: 'Concepts' },
  // Trading
  { slug: 'reading-the-order-book',            title: 'Reading the Order Book',          collection: 'Trading' },
  { slug: 'order-types',                       title: 'Order Types',                     collection: 'Trading' },
  { slug: 'order-lifecycle',                   title: 'Order Lifecycle',                 collection: 'Trading' },
  { slug: 'managing-your-positions',           title: 'Managing Your Positions',         collection: 'Trading' },
  { slug: 'closing-a-position',                title: 'Closing a Position',              collection: 'Trading' },
  { slug: 'resolution-and-settlement',         title: 'Resolution & Settlement',         collection: 'Trading' },
  // Platform
  { slug: 'withdrawing-funds',                 title: 'Withdrawing Funds',               collection: 'Platform' },
  { slug: 'trading-fee-discount',              title: 'Trading Fee Discount',            collection: 'Platform' },
  { slug: 'builder-codes',                     title: 'Builder Codes',                   collection: 'Platform' },
  { slug: 'badges-and-cards',                  title: 'Badges & Cards',                  collection: 'Platform' },
  { slug: 'leaderboard',                       title: 'Leaderboard',                     collection: 'Platform' },
  // Reference
  { slug: 'fees',                              title: 'Fees',                            collection: 'Reference' },
  { slug: 'risks',                             title: 'Risks',                           collection: 'Reference' },
  // SDK
  { slug: 'sdk/introduction',                  title: 'SDK Introduction',                collection: 'SDK' },
  { slug: 'sdk/installation',                  title: 'SDK Installation',                collection: 'SDK' },
  { slug: 'sdk/quickstart',                    title: 'SDK Quickstart',                  collection: 'SDK' },
  { slug: 'sdk/concepts/markets',              title: 'SDK: Markets',                    collection: 'SDK' },
  { slug: 'sdk/concepts/authentication',       title: 'SDK: Authentication',             collection: 'SDK' },
  { slug: 'sdk/concepts/coin-naming',          title: 'SDK: Coin Naming',                collection: 'SDK' },
  { slug: 'sdk/guides/fetch-markets',          title: 'SDK Guide: Fetch Markets',        collection: 'SDK' },
  { slug: 'sdk/guides/trading',                title: 'SDK Guide: Trading',              collection: 'SDK' },
  { slug: 'sdk/guides/conversions',            title: 'SDK Guide: Conversions',          collection: 'SDK' },
  { slug: 'sdk/guides/real-time-data',         title: 'SDK Guide: Real-time Data',       collection: 'SDK' },
  { slug: 'sdk/guides/wallet-funding',         title: 'SDK Guide: Wallet Funding',       collection: 'SDK' },
  { slug: 'sdk/reference/account-adapter',     title: 'SDK Ref: Account Adapter',        collection: 'SDK' },
  { slug: 'sdk/reference/auth-adapter',        title: 'SDK Ref: Auth Adapter',           collection: 'SDK' },
  { slug: 'sdk/reference/events-adapter',      title: 'SDK Ref: Events Adapter',         collection: 'SDK' },
  { slug: 'sdk/reference/market-data-adapter', title: 'SDK Ref: Market Data Adapter',    collection: 'SDK' },
  { slug: 'sdk/reference/trading-adapter',     title: 'SDK Ref: Trading Adapter',        collection: 'SDK' },
  { slug: 'sdk/reference/wallet-adapter',      title: 'SDK Ref: Wallet Adapter',         collection: 'SDK' },
  { slug: 'sdk/reference/types',               title: 'SDK Ref: Types',                  collection: 'SDK' },
  { slug: 'sdk/reference/utilities',           title: 'SDK Ref: Utilities',              collection: 'SDK' },
];

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
  if (!res.ok) throw new Error(`Intercom ${method} ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function getAllCollections() {
  const data = await intercomRequest('GET', 'help_center/collections');
  return Object.fromEntries(data.data.map(c => [c.name, c.id]));
}

async function getAllArticles() {
  const data = await intercomRequest('GET', 'articles?per_page=250');
  return Object.fromEntries(data.data.map(a => [a.title, a.id]));
}

async function sync() {
  const [collections, existingArticles] = await Promise.all([getAllCollections(), getAllArticles()]);

  const missingCollections = [...new Set(PAGES.map(p => p.collection))].filter(c => !collections[c]);
  if (missingCollections.length) {
    console.error(`Missing Intercom collections: ${missingCollections.join(', ')}`);
    console.error('Create them in the Intercom dashboard first: Help Center → Collections');
    process.exit(1);
  }

  let created = 0, updated = 0, failed = 0;

  for (const page of PAGES) {
    try {
      const res = await fetch(`${DOCS_BASE}/${page.slug}.md`);
      if (!res.ok) throw new Error(`Failed to fetch ${page.slug}: ${res.status}`);
      const body = await res.text();

      const payload = {
        title: page.title,
        body,
        author_id: Number(AUTHOR_ID),
        state: 'published',
        parent_id: Number(collections[page.collection]),
        parent_type: 'collection',
      };

      if (existingArticles[page.title]) {
        await intercomRequest('PUT', `articles/${existingArticles[page.title]}`, payload);
        console.log(`Updated: ${page.title}`);
        updated++;
      } else {
        await intercomRequest('POST', 'articles', payload);
        console.log(`Created: ${page.title}`);
        created++;
      }
    } catch (err) {
      console.error(`Failed: ${page.title} — ${err}`);
      failed++;
    }
  }

  console.log(`\nDone. Created: ${created}, Updated: ${updated}, Failed: ${failed}`);
}

sync();