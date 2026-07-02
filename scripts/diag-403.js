'use strict';

// Script de diagnostic ponctuel : dump statut HTTP, headers de reponse et
// extrait du HTML pour identifier la nature du blocage (WAF, captcha,
// fingerprinting) sur les sites qui renvoient 403/404 malgre l'UA correct.
//   node scripts/diag-403.js
require('dotenv').config();

const { withPage, closeBrowser } = require('../lib/browser');

const targets = [
  { id: 'darty', url: 'https://www.darty.com/nav/recherche/MMCS-12HRN8-QRD0.html' },
  { id: 'fnac', url: 'https://www.fnac.com/a21457105' },
  { id: 'ebay', url: 'https://www.ebay.fr/sch/i.html?_nkw=midea+portasplit+12000&_sop=10' },
];

(async () => {
  for (const t of targets) {
    console.log('\n=== ' + t.id + ' : ' + t.url + ' ===');
    try {
      await withPage(async (page) => {
        const resp = await page.goto(t.url, { waitUntil: 'domcontentloaded' });
        console.log('status:', resp && resp.status());
        console.log('headers:', JSON.stringify(resp && resp.headers(), null, 2));
        const wd = await page.evaluate(() => navigator.webdriver);
        console.log('navigator.webdriver:', wd);
        const html = await page.content();
        console.log('body (500 premiers car.):');
        console.log(html.slice(0, 500));
      });
    } catch (e) {
      console.log('erreur:', e.message);
    }
  }
  await closeBrowser();
  process.exit(0);
})();
