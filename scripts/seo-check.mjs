import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const pages = [
  {
    file: 'portfolio.html',
    canonical: 'https://pixelrebels.space/portfolio',
    type: 'CollectionPage',
    caseStudy: false
  },
  {
    file: 'coffee-matters.html',
    canonical: 'https://pixelrebels.space/coffee-matters',
    type: 'Article',
    caseStudy: true,
    forbidden: [/4\.8★/i, /200\+ Google reviews/i]
  },
  {
    file: 'ictinus-contractors.html',
    canonical: 'https://pixelrebels.space/ictinus-contractors',
    type: 'Article',
    caseStudy: true,
    forbidden: [/9\.97\/10/i, /60\+ verified reviews/i]
  },
  {
    file: 'artiling-studio/index.html',
    canonical: 'https://pixelrebels.space/artiling-studio',
    type: 'Article',
    caseStudy: true
  },
  {
    file: 'greenwood-food-wine.html',
    canonical: 'https://pixelrebels.space/greenwood-food-wine',
    type: 'Article',
    caseStudy: true,
    concept: true
  }
];

const errors = [];
const pass = message => console.log(`PASS  ${message}`);
const fail = message => errors.push(message);
const getMatch = (html, pattern) => html.match(pattern)?.[1]?.trim() ?? '';
const hasType = (node, type) => {
  const value = node?.['@type'];
  return Array.isArray(value) ? value.includes(type) : value === type;
};

const sitemap = readFileSync(join(websiteRoot, 'sitemap.xml'), 'utf8');
const redirects = readFileSync(join(websiteRoot, '_redirects'), 'utf8');
const redirectLines = redirects
  .split(/\r?\n/)
  .map(line => line.trim())
  .filter(line => line && !line.startsWith('#'));

for (const page of pages) {
  const fullPath = join(websiteRoot, page.file);
  const html = readFileSync(fullPath, 'utf8');
  const title = getMatch(html, /<title>([\s\S]*?)<\/title>/i);
  const description = getMatch(html, /<meta\s+name="description"\s+content="([^"]+)"/i);
  const canonical = getMatch(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i);
  const robots = getMatch(html, /<meta\s+name="robots"\s+content="([^"]+)"/i);
  const h1Count = (html.match(/<h1(?:\s|>)/gi) ?? []).length;
  const h2Count = (html.match(/<h2(?:\s|>)/gi) ?? []).length;
  const jsonBlocks = [...html.matchAll(/<script\s+type="application\/ld\+json">\s*([\s\S]*?)<\/script>/gi)];
  const nodes = [];

  if (title.length < 30 || title.length > 60) fail(`${page.file}: title length is ${title.length}; expected 30-60`);
  else pass(`${page.file}: title length ${title.length}`);

  if (description.length < 120 || description.length > 160) fail(`${page.file}: meta description length is ${description.length}; expected 120-160`);
  else pass(`${page.file}: meta description length ${description.length}`);

  if (canonical !== page.canonical) fail(`${page.file}: canonical mismatch (${canonical || 'missing'})`);
  else pass(`${page.file}: canonical URL`);

  if (!robots.includes('index, follow') || !robots.includes('max-image-preview:large')) fail(`${page.file}: incomplete robots directive`);
  else pass(`${page.file}: crawl and preview directives`);

  if (h1Count !== 1) fail(`${page.file}: expected one H1, found ${h1Count}`);
  if (h2Count < 2) fail(`${page.file}: expected at least two H2 headings, found ${h2Count}`);

  if (jsonBlocks.length === 0) fail(`${page.file}: JSON-LD is missing`);
  for (const block of jsonBlocks) {
    try {
      const data = JSON.parse(block[1]);
      nodes.push(...(Array.isArray(data['@graph']) ? data['@graph'] : [data]));
    } catch (error) {
      fail(`${page.file}: invalid JSON-LD (${error.message})`);
    }
  }

  if (!nodes.some(node => hasType(node, page.type))) fail(`${page.file}: ${page.type} schema is missing`);
  else pass(`${page.file}: ${page.type} schema`);

  const ogImage = getMatch(html, /<meta\s+property="og:image"\s+content="([^"]+)"/i);
  if (!ogImage || !html.includes('property="og:site_name"') || !html.includes('name="twitter:image:alt"')) {
    fail(`${page.file}: social metadata is incomplete`);
  }
  if (ogImage.startsWith('https://pixelrebels.space/')) {
    const localImage = join(websiteRoot, new URL(ogImage).pathname.replace(/^\//, ''));
    if (!existsSync(localImage)) fail(`${page.file}: local OG image does not exist (${ogImage})`);
  }

  if (!sitemap.includes(`<loc>${page.canonical}</loc>`)) fail(`${page.file}: canonical URL is missing from sitemap.xml`);

  const route = new URL(page.canonical).pathname;
  if (redirectLines.some(line => line.startsWith(`${route} `))) {
    fail(`${page.file}: clean canonical route must not be rewritten in _redirects`);
  } else {
    pass(`${page.file}: native clean route has no conflicting rewrite`);
  }

  for (const pattern of page.forbidden ?? []) {
    if (pattern.test(html)) fail(`${page.file}: stale metric remains (${pattern})`);
  }

  if (page.caseStudy) {
    const faqNode = nodes.find(node => hasType(node, 'FAQPage'));
    const breadcrumbNode = nodes.find(node => hasType(node, 'BreadcrumbList'));
    const visibleFaqCount = (html.match(/<details\s+class="case-faq-item/gi) ?? []).length;
    const relatedCount = (html.match(/class="case-related-link"/gi) ?? []).length;

    if (!html.includes('class="case-breadcrumb"') || !breadcrumbNode) fail(`${page.file}: visible or structured breadcrumb is missing`);
    if (!faqNode || visibleFaqCount !== faqNode.mainEntity?.length || visibleFaqCount < 3) {
      fail(`${page.file}: visible FAQ and FAQPage schema are not aligned`);
    }
    if (relatedCount < 3) fail(`${page.file}: expected at least three related case-study links`);
    if (!html.includes('<time datetime="2026-08-15">')) fail(`${page.file}: visible update date is missing`);
  }

  if (page.concept && !/self-initiated/i.test(html)) fail(`${page.file}: concept disclosure is missing`);
}

if (redirectLines.some(line => line.startsWith('/* '))) {
  fail('_redirects: SPA fallback must not mask static multi-page routes');
}

for (const file of ['index.html', 'portfolio.html']) {
  const html = readFileSync(join(websiteRoot, file), 'utf8');
  if (/\/(?:coffee-matters|ictinus-contractors|greenwood-food-wine)\.html/i.test(html)) {
    fail(`${file}: internal case-study links should use canonical clean URLs`);
  }
}

if (errors.length > 0) {
  console.error(`\nSEO check failed with ${errors.length} issue${errors.length === 1 ? '' : 's'}:`);
  errors.forEach(error => console.error(`- ${error}`));
  process.exitCode = 1;
} else {
  console.log(`\nSEO check passed for ${pages.length} pages.`);
}
