const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

// Legal pages, public (the app stores ask for their URL): /legal/confidentialite, /legal/cgu,
// /legal/mentions-legales. The texts live in ../legal/*.html (content only), wrapped here.

const PAGES = {
  confidentialite: 'Politique de confidentialité',
  cgu: 'Conditions générales d’utilisation',
  'mentions-legales': 'Mentions légales'
};

const LEGAL_DIR = path.join(__dirname, '..', 'legal');

function render(slug) {
  const content = fs.readFileSync(path.join(LEGAL_DIR, `${slug}.html`), 'utf8');
  const nav = Object.entries(PAGES)
    .map(([key, label]) => (key === slug ? `<strong>${label}</strong>` : `<a href="/legal/${key}">${label}</a>`))
    .join(' · ');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${PAGES[slug]} · Mesnia</title>
  <style>
    :root { color-scheme: light dark; --text: #2D2D2D; --muted: #6B7280; --brand: #3F7A66; --bg: #F6FAF8; --card: #FFFFFF; --border: #E1EBE6; }
    @media (prefers-color-scheme: dark) { :root { --text: #E8EFEC; --muted: #9DB0A8; --brand: #8CC7B2; --bg: #111816; --card: #1B2421; --border: #2A3632; } }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.65 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }
    main { max-width: 760px; margin: 0 auto; padding: 32px 16px 64px; }
    header { display: flex; align-items: center; gap: 10px; margin-bottom: 24px; font-weight: 800; font-size: 20px; color: var(--brand); }
    header span { display: inline-flex; width: 32px; height: 32px; border-radius: 9px; background: #74B39D; color: #fff; align-items: center; justify-content: center; font-size: 18px; }
    nav { font-size: 14px; color: var(--muted); margin-bottom: 24px; }
    article { background: var(--card); border: 1px solid var(--border); border-radius: 16px; padding: 28px 24px; }
    h1 { font-size: 26px; line-height: 1.25; margin: 0 0 6px; }
    h2 { font-size: 19px; margin: 32px 0 8px; }
    h3 { font-size: 16px; margin: 20px 0 6px; }
    .updated { color: var(--muted); font-size: 14px; margin: 0 0 24px; }
    a { color: var(--brand); }
    table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 12px 0; }
    th, td { text-align: left; vertical-align: top; padding: 8px 10px 8px 0; border-bottom: 1px solid var(--border); }
    th { font-weight: 700; }
    .table-wrap { overflow-x: auto; }
    footer { text-align: center; color: var(--muted); font-size: 13px; margin-top: 24px; }
  </style>
</head>
<body>
  <main>
    <header><span>⌂</span> Mesnia</header>
    <nav>${nav}</nav>
    <article>
${content}
    </article>
    <footer>© ${new Date().getFullYear()} Mesnia</footer>
  </main>
</body>
</html>`;
}

const cache = new Map();

router.get('/', (req, res) => res.redirect('/legal/confidentialite'));

router.get('/:page', (req, res) => {
  const slug = req.params.page;
  if (!Object.hasOwn(PAGES, slug)) return res.status(404).send('Page introuvable');
  if (!cache.has(slug) || process.env.NODE_ENV !== 'production') cache.set(slug, render(slug));
  res.type('html').set('Cache-Control', 'public, max-age=3600').send(cache.get(slug));
});

module.exports = router;
