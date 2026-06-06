import axios from 'axios';
import * as cheerio from 'cheerio';
import { format, addDays } from 'date-fns';
import crypto from 'crypto';
import { adminDbWrapper as adminDb } from '../lib/firebase-admin.js';
import { sendTelegramMessage } from './telegram.js';

const PMMP_BASE = "https://www.marchespublics.gov.ma/";
const BDC_URL = "https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseAdvancedSearch&AllBdc&searchAnnounce";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8",
  "Cache-Control": "no-cache"
};

const BDC_TEMPLATES: [string, string, number][] = [
  ["Fourniture de consommables bureautiques", "Fournitures", 45000],
  ["Acquisition de matériels informatiques", "Informatique", 120000],
  ["Prestations de nettoyage", "Services", 80000],
  ["Fourniture de carburant", "Fournitures", 200000],
  ["Maintenance préventive des équipements", "Services", 95000],
  ["Achat de mobilier de bureau", "Fournitures", 60000],
  ["Prestations de gardiennage", "Sécurité", 150000],
  ["Fourniture de pièces de rechange", "Fournitures", 75000],
  ["Services de traduction", "Services", 30000],
  ["Impression et reprographie", "Services", 25000],
];

const ORGANIZATIONS = [
  "Ministère des Finances", "Ministère de la Santé", "Direction Régionale des Impôts",
  "Wilaya de Casablanca", "Préfecture de Rabat", "Académie Régionale de l'Education",
  "CHU Ibn Rochd", "Haut-Commissariat au Plan", "Agence Urbaine de Marrakech"
];

const REGIONS = [
  "Casablanca", "Rabat", "Marrakech", "Fès", "Tanger", "Agadir", "Meknès", "Oujda"
];

const FIRESTORE_BATCH_LIMIT = 400;

async function getSessionCookies(): Promise<string[]> {
  try {
    const res = await axios.get(PMMP_BASE, { headers: HEADERS, timeout: 8000 });
    return res.headers['set-cookie'] || [];
  } catch {
    return [];
  }
}

function buildRequestHeaders(cookies: string[]) {
  return {
    ...HEADERS,
    ...(cookies.length > 0 ? { "Cookie": cookies.map(c => c.split(';')[0]).join('; ') } : {})
  };
}

function parseAmount(text: string): number | null {
  const cleaned = text.replace(/\s/g, '').replace(/,/g, '.');
  const match = cleaned.match(/[\d]+\.?\d*/);
  if (!match) return null;
  const num = parseFloat(match[0]);
  return (!isNaN(num) && num > 100) ? num : null;
}

async function scrapeBdcPage(
  url: string,
  bdcs: any[],
  seenRefs: Set<string>,
  cookies: string[]
): Promise<string | null> {
  try {
    const response = await axios.get(url, {
      headers: buildRequestHeaders(cookies),
      timeout: 25000,
      validateStatus: () => true
    });

    if (response.status !== 200) return null;

    const $ = cheerio.load(response.data);
    const rows = $('.table-results tr').get();

    for (const el of rows) {
      const cells = $(el).find('td');
      if (cells.length < 4) continue;

      const reference = $(el).find('.ref').text().trim();
      if (!reference || seenRefs.has(reference)) continue;
      seenRefs.add(reference);

      let title = '', organization = '', amount: number | null = null;

      $(el).find('.objet-line').each((_j, obj) => {
        $(obj).find('br').replaceWith(' ');
        const text = $(obj).text().replace(/\s+/g, ' ').trim();
        if (!title && /objet\s*:/i.test(text)) {
          title = text.split(/objet\s*:/i)[1]?.replace(/\.\.\..*/s, '').trim() || '';
        }
        if (!organization && /acheteur\s+public\s*:/i.test(text)) {
          organization = text.split(/acheteur\s+public\s*:/i)[1]?.trim() || '';
        }
        // BDC often shows amount directly in the listing
        if (amount === null && /montant|budget|estimat/i.test(text)) {
          const after = text.replace(/.*(?:montant|budget|estimat)[^:]*:/i, '');
          amount = parseAmount(after);
        }
      });

      // Try cells directly for amount (BDC typically has a montant column)
      if (amount === null) {
        cells.each((_i, cell) => {
          if (amount !== null) return false;
          const text = $(cell).text().trim().replace(/\s/g, '');
          if (/^\d{4,}(\.\d+)?$/.test(text)) {
            const num = parseFloat(text);
            if (!isNaN(num) && num > 100) { amount = num; return false; }
          }
        });
      }

      $(el).find('.cloture-line br, .date-line br').replaceWith(' ');
      const dateRaw = $(el).find('.cloture-line, .date-line').first().text().replace(/\s+/g, ' ').trim();
      const region = $(el).find('[id*="panelBlocLieuxExec"]').text().replace(/\s+/g, ' ').trim().split(' ')[0] || 'National';
      const category = $(el).find('[id*="panelBlocCategorie"]').text().replace(/\s+/g, ' ').trim() || 'Non spécifié';

      const href = $(el).find('a[href*="EntrepriseDetail"]').attr('href') || '';
      const detailUrl = href
        ? (href.startsWith('?') ? `${PMMP_BASE}index.php${href}` : `${PMMP_BASE}${href}`)
        : BDC_URL;

      if (!title || !reference) continue;

      bdcs.push({
        title,
        organization: organization || 'Organisme Public',
        date: dateRaw.split(' ')[0] || new Date().toISOString().split('T')[0],
        category,
        region: region.split('\n')[0].trim(),
        amount,
        reference,
        url: detailUrl,
        is_live: true
      });
    }

    const nextLink = $('.pagination a, a[title*="Suivant"], a:contains(">")')
      .filter((_i, el) => {
        const t = $(el).text().toLowerCase() + ($(el).attr('title') || '').toLowerCase();
        return t.includes('>') || t.includes('suivant');
      })
      .first().attr('href');

    if (nextLink && nextLink !== '#') {
      return nextLink.startsWith('http')
        ? nextLink
        : `${PMMP_BASE}${nextLink.startsWith('/') ? nextLink.substring(1) : nextLink}`;
    }
  } catch (e) {
    console.warn(`❌ BDC page failed: ${url}`, e instanceof Error ? e.message : e);
  }
  return null;
}

function parseDate(raw: string): Date {
  try {
    const parts = raw.split('/');
    if (parts.length === 3) {
      const y = parseInt(parts[2].substring(0, 4));
      const m = parseInt(parts[1]) - 1;
      const d = parseInt(parts[0]);
      const date = new Date(y, m, d);
      if (!isNaN(date.getTime())) return date;
    }
  } catch {}
  return new Date();
}

export async function scrapeBdc(): Promise<any[]> {
  const bdcs: any[] = [];
  const seenRefs = new Set<string>();
  const cookies = await getSessionCookies();

  try {
    let currentUrl: string | null = BDC_URL;
    let pages = 0;
    const maxPages = 25;

    while (currentUrl && pages < maxPages) {
      currentUrl = await scrapeBdcPage(currentUrl, bdcs, seenRefs, cookies);
      pages++;
      if (currentUrl) await new Promise(r => setTimeout(r, 300));
    }
    console.log(`📋 BDC scraped: ${bdcs.length} from ${pages} pages`);
  } catch (e) {
    console.warn('⚠️ BDC scrape error:', e);
  }

  if (bdcs.length > 0) return bdcs;

  // Demo fallback
  console.warn('⚠️ BDC portal unreachable — using demo data');
  return Array.from({ length: 12 }, (_, i) => {
    const tpl = BDC_TEMPLATES[i % BDC_TEMPLATES.length];
    const org = ORGANIZATIONS[i % ORGANIZATIONS.length];
    const region = REGIONS[i % REGIONS.length];
    const date = format(addDays(new Date(), -Math.floor(Math.random() * 30)), 'dd/MM/yyyy');
    const amount = Math.floor(tpl[2] * (0.8 + Math.random() * 0.4));
    const uid = crypto.createHash('md5').update(`${tpl[0]}${org}${date}`).digest('hex').substring(0, 8).toUpperCase();
    return {
      title: tpl[0], organization: org, category: tpl[1],
      region, date, amount,
      reference: `BDC-${uid}`,
      url: 'https://www.marchespublics.gov.ma/',
      is_live: false
    };
  });
}

export async function scrapeAndNotifyBdc(broadcast: (msg: any) => void) {
  console.log(`🔍 Scraping BDC...`);
  const raw = await scrapeBdc();

  const bdcCol = adminDb.collection('bons_commande');

  // Bulk read existing
  const existingSnapshot = await bdcCol.get();
  const existingByRef = new Map<string, { id: string; data: any }>();
  existingSnapshot.docs.forEach((d: any) => {
    const data = d.data();
    if (data.reference) existingByRef.set(data.reference, { id: d.id, data });
  });

  const scrapeBaseTime = Date.now();
  const toInsert: { ref: any; data: any; item: any }[] = [];
  const toUpdate: { id: string; data: any }[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const dateObj = parseDate(item.date);
    const existing = existingByRef.get(item.reference);
    const portalOrderTime = new Date(scrapeBaseTime - i * 1000).toISOString();

    const bdcData = {
      title: item.title,
      organization: item.organization,
      category: item.category || 'Non spécifié',
      region: item.region || 'National',
      date: dateObj.toISOString(),
      amount: item.amount ?? existing?.data?.amount ?? null,
      url: item.url,
      reference: item.reference,
      is_live: item.is_live === true,
      published_at: existing?.data?.published_at ?? portalOrderTime
    };

    if (existing) {
      toUpdate.push({ id: existing.id, data: bdcData });
    } else {
      toInsert.push({ ref: bdcCol.newDocRef(), data: bdcData, item });
    }
  }

  // Batch inserts
  for (let i = 0; i < toInsert.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = toInsert.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = adminDb.batch();
    for (const { ref, data } of chunk) batch.set(ref, data);
    await batch.commit();
    for (const { item, data } of chunk) {
      broadcast({ type: 'new_bdc', data });
      if (item.is_live) {
        const msg = `🛒 <b>Nouveau Bon de Commande</b>\n\n📝 ${data.title}\n🏢 ${data.organization}\n💰 ${data.amount ? `${data.amount.toLocaleString('fr-MA')} MAD` : 'N/A'}\n🆔 <code>${data.reference}</code>`;
        sendTelegramMessage(msg).catch(() => {});
      }
    }
  }

  // Batch updates
  for (let i = 0; i < toUpdate.length; i += FIRESTORE_BATCH_LIMIT) {
    const chunk = toUpdate.slice(i, i + FIRESTORE_BATCH_LIMIT);
    const batch = adminDb.batch();
    for (const { id, data } of chunk) batch.update(bdcCol.doc(id).ref, data);
    await batch.commit();
  }

  await adminDb.collection('stats').doc('last_bdc_scrape').set({
    scraped_at: new Date().toISOString(),
    new_bdcs: toInsert.length,
    total_found: raw.length
  });

  console.log(`✅ BDC complete: ${toInsert.length} new / ${raw.length} total`);
}
