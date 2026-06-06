import axios from 'axios';
import * as cheerio from 'cheerio';
import { format, addDays } from 'date-fns';
import crypto from 'crypto';
import { adminDbWrapper as adminDb } from '../lib/firebase-admin.js';
import { sendTelegramMessage, formatTenderMessage } from './telegram.js';

const PMMP_BASE = "https://www.marchespublics.gov.ma/";
const SEARCH_URL = "https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseAdvancedSearch&AllCons&EnCours&searchAnnounce";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache"
};

// Fallback demo data when the portal is unreachable
const TENDER_TEMPLATES: [string, string, number][] = [
  ["Construction d'un centre de santé", "Travaux", 3500000],
  ["Fourniture de matériel informatique", "Informatique", 850000],
  ["Étude d'impact environnemental", "Études", 420000],
  ["Réhabilitation de routes rurales", "Génie Civil", 12000000],
  ["Acquisition de véhicules administratifs", "Fournitures", 2200000],
  ["Services de gardiennage et sécurité", "Sécurité", 680000],
  ["Travaux d'électrification rurale", "Électricité", 4800000],
  ["Fourniture de médicaments et consommables", "Santé", 1900000],
  ["Développement d'une application web", "Informatique", 550000],
  ["Construction d'un lycée technique", "Éducation", 18000000],
];

const ORGANIZATIONS = [
  "Ministère des Finances", "Ministère de la Santé", "Ministère de l'Éducation",
  "Ministère des Travaux Publics", "Office National de l'Électricité",
  "Commune de Casablanca", "Commune de Rabat", "Commune de Marrakech"
];

const REGIONS = [
  "Casablanca-Settat", "Rabat-Salé-Kénitra", "Marrakech-Safi",
  "Fès-Meknès", "Tanger-Tétouan-Al Hoceïma", "Souss-Massa"
];

const SECTORS = [
  "1.12", "1.13", "1.15", "1.17", "2.11", "3.13",
  "1.11", "1.14", "1.16", "2.12", "2.13", "3.11", "3.12",
  "1.18", "1.19", "2.14", "2.15", "3.14", "3.15"
];

export async function checkConnectivity() {
  try {
    const res = await axios.get(PMMP_BASE, { headers: HEADERS, timeout: 8000, validateStatus: () => true });
    return { status: 'online', code: res.status };
  } catch (e) {
    return { status: 'offline', error: e instanceof Error ? e.message : String(e) };
  }
}

// Obtain session cookies from the portal homepage
async function getSessionCookies(): Promise<string[]> {
  try {
    const res = await axios.get(PMMP_BASE, { headers: HEADERS, timeout: 8000 });
    const setCookie = res.headers['set-cookie'];
    if (setCookie && setCookie.length > 0) {
      console.log(`🍪 Session cookies obtained (${setCookie.length})`);
      return setCookie;
    }
  } catch (e) {
    console.warn("⚠️ Failed to obtain session cookies:", e instanceof Error ? e.message : String(e));
  }
  return [];
}

function buildRequestHeaders(cookies: string[]) {
  return {
    ...HEADERS,
    ...(cookies.length > 0 ? { "Cookie": cookies.map(c => c.split(';')[0]).join('; ') } : {})
  };
}

async function scrapeTenderDetails(url: string, cookies: string[]): Promise<number | null> {
  try {
    const response = await axios.get(url, {
      headers: { ...buildRequestHeaders(cookies), "Referer": SEARCH_URL },
      timeout: 12000
    });

    if (response.status !== 200) return null;

    const html = response.data as string;
    if (!html.toLowerCase().includes("estimation")) return null;

    const $ = cheerio.load(html);
    let budget: number | null = null;

    $('tr, div, p, td, th').each((_i, el) => {
      const text = $(el).text().trim();
      if (text.toLowerCase().includes("estimation") && text.toLowerCase().includes("dhs")) {
        const matches = text.match(/[\d\s ]+[.,]\d{2}/g) || text.match(/\d[\d\s ]+\d/g);
        if (matches) {
          for (const match of matches) {
            const num = parseFloat(match.replace(/[\s ]/g, '').replace(',', '.'));
            if (!isNaN(num) && num > 1000) { budget = num; return false; }
          }
        }
        // Try sibling or last cell
        const sibling = $(el).next().text().trim() || $(el).closest('tr').find('td').last().text().trim();
        if (sibling) {
          const num = parseFloat(sibling.replace(/[\s ]/g, '').replace(',', '.').replace(/[^\d.]/g, ''));
          if (!isNaN(num) && num > 1000) { budget = num; return false; }
        }
      }
    });

    return budget;
  } catch (e) {
    console.warn(`⚠️ Detail fetch failed for ${url}:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

async function scrapeUrl(
  url: string,
  tenders: any[],
  seenRefs: Set<string>,
  cookies: string[],
  isQuick: boolean
): Promise<string | null> {
  try {
    console.log(`🌐 Scraping: ${url}`);
    const response = await axios.get(url, {
      headers: buildRequestHeaders(cookies),
      timeout: 25000,
      validateStatus: () => true
    });

    if (response.status !== 200) {
      console.warn(`⚠️ HTTP ${response.status} for ${url}`);
      return null;
    }

    const $ = cheerio.load(response.data);
    const rows = $('.table-results tr').get();

    for (const el of rows) {
      const cells = $(el).find('td');
      if (cells.length < 5) continue;

      const reference = $(el).find('.ref').text().trim();
      if (!reference || seenRefs.has(reference)) continue;
      seenRefs.add(reference);

      let title = "";
      let organization = "";
      $(el).find('.objet-line').each((_j, obj) => {
        // Replace <br> tags with space so date/text don't concatenate
        $(obj).find('br').replaceWith(' ');
        const text = $(obj).text().replace(/\s+/g, ' ').trim();
        if (!title && /objet\s*:/i.test(text)) {
          title = text.split(/objet\s*:/i)[1]?.replace(/\.\.\..*/s, '').trim() || "";
        }
        if (!organization && /acheteur\s+public\s*:/i.test(text)) {
          organization = text.split(/acheteur\s+public\s*:/i)[1]?.trim() || "";
        }
      });

      // Replace <br> before reading deadline so date and time don't fuse together
      $(el).find('.cloture-line br').replaceWith(' ');
      const deadlineRaw = $(el).find('.cloture-line').first().text().replace(/\s+/g, ' ').trim();
      const region = $(el).find('[id*="panelBlocLieuxExec"]').text().replace(/\s+/g, ' ').trim().split(' ')[0] || "National";
      const category = $(el).find('[id*="panelBlocCategorie"]').text().replace(/\s+/g, ' ').trim() || "Non spécifié";

      // Build detail page URL
      const refCons = $(el).find('input[id*="_refCons"]').val() as string;
      const orgCons = $(el).find('input[id*="_orgCons"]').val() as string;
      let detailUrl = SEARCH_URL;
      if (refCons && orgCons) {
        detailUrl = `${PMMP_BASE}index.php?page=entreprise.EntrepriseDetailsConsultation&refConsultation=${refCons}&orgAcronyme=${orgCons}`;
      } else {
        const href = $(el).find('a[href*="EntrepriseDetailConsultation"]').attr('href');
        if (href) {
          const link = href.startsWith('?') ? 'index.php' + href : href;
          detailUrl = `${PMMP_BASE}${link}`.replace('EntrepriseDetailConsultation', 'EntrepriseDetailsConsultation');
        }
      }

      if (!title || !reference) continue;

      // Quick mode: skip per-tender budget HTTP requests (too slow for Vercel timeout)
      let budget: number | null = null;
      if (!isQuick) {
        console.log(`📄 Fetching budget for: ${reference}`);
        budget = await scrapeTenderDetails(detailUrl, cookies);
        await new Promise(r => setTimeout(r, 300));
      }

      tenders.push({
        title,
        organization: organization || "Organisme Public",
        deadline: deadlineRaw.split(' ')[0],
        category,
        region: region.split('\n')[0].trim(),
        budget,
        reference,
        url: detailUrl,
        is_live: true
      });
    }

    // Find next page
    const nextLink = $('.pagination a, a[title*="Suivant"], a:contains(">")')
      .filter((_i, el) => {
        const t = $(el).text().toLowerCase() + ($(el).attr('title') || '').toLowerCase();
        return t.includes('>') || t.includes('suivant');
      })
      .first().attr('href');

    if (nextLink && nextLink !== "#") {
      return nextLink.startsWith('http')
        ? nextLink
        : `${PMMP_BASE}${nextLink.startsWith('/') ? nextLink.substring(1) : nextLink}`;
    }
  } catch (e) {
    console.warn(`❌ Scrape failed for ${url}:`, e instanceof Error ? e.message : String(e));
  }
  return null;
}

export async function scrapePmmp(isQuick: boolean = false): Promise<any[]> {
  const tenders: any[] = [];
  const seenRefs = new Set<string>();

  // Authenticate: get session cookies from portal homepage
  const cookies = await getSessionCookies();

  try {
    console.log("🕵️ Starting PMMP scrape...");
    // Main search: paginate through all results
    let currentUrl: string | null = SEARCH_URL;
    let pagesProcessed = 0;
    const maxPages = isQuick ? 25 : 60;

    while (currentUrl && pagesProcessed < maxPages) {
      currentUrl = await scrapeUrl(currentUrl, tenders, seenRefs, cookies, isQuick);
      pagesProcessed++;
      if (currentUrl) await new Promise(r => setTimeout(r, 300));
    }
    console.log(`📄 Main search: ${pagesProcessed} pages, ${tenders.length} tenders so far`);

    // Sector searches: also paginate (up to 3 pages each) to catch sector-specific listings
    const sectorsToScrape = isQuick ? SECTORS.slice(0, 8) : SECTORS;
    const maxPagesPerSector = isQuick ? 2 : 4;
    for (const sector of sectorsToScrape) {
      let sectorUrl: string | null = `${SEARCH_URL}&domaineActivite=${sector}`;
      let sectorPages = 0;
      while (sectorUrl && sectorPages < maxPagesPerSector) {
        sectorUrl = await scrapeUrl(sectorUrl, tenders, seenRefs, cookies, isQuick);
        sectorPages++;
        if (sectorUrl) await new Promise(r => setTimeout(r, 200));
      }
      await new Promise(r => setTimeout(r, 150));
    }
    console.log(`📦 Total after sector scrape: ${tenders.length} unique tenders`);
  } catch (e) {
    console.warn("⚠️ Scrape loop error:", e);
  }

  if (tenders.length > 0) {
    console.log(`✨ Live tenders scraped: ${tenders.length}`);
    return tenders;
  }

  // Demo fallback when portal is unreachable
  console.warn("⚠️ Portal unreachable — using demo data");
  const demo: any[] = [];
  for (let i = 0; i < 8; i++) {
    const tpl = TENDER_TEMPLATES[Math.floor(Math.random() * TENDER_TEMPLATES.length)];
    const org = ORGANIZATIONS[Math.floor(Math.random() * ORGANIZATIONS.length)];
    const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
    const deadline = format(addDays(new Date(), Math.floor(Math.random() * 35) + 10), "dd/MM/yyyy");
    const budget = Math.floor(tpl[2] * (0.85 + Math.random() * 0.4));
    const uid = crypto.createHash('md5').update(`${tpl[0]}${org}${deadline}`).digest('hex').substring(0, 8).toUpperCase();
    demo.push({
      title: tpl[0], organization: org, category: tpl[1],
      region, deadline, budget,
      reference: `DEMO-${uid}`,
      url: "https://www.marchespublics.gov.ma/pmmp/",
      is_live: false
    });
  }
  return demo;
}

function parseDeadline(raw: string): Date {
  try {
    const parts = raw.split('/');
    if (parts.length === 3) {
      const year = parseInt(parts[2].substring(0, 4));
      const month = parseInt(parts[1]) - 1;
      const day = parseInt(parts[0]);
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d;
    }
  } catch {}
  return addDays(new Date(), 30);
}

export async function scrapeAndNotify(broadcast: (msg: any) => void, isQuick: boolean = false) {
  console.log(`🔍 Scraping PMMP... [${format(new Date(), 'HH:mm:ss')}] (quick=${isQuick})`);
  const raw = await scrapePmmp(isQuick);
  let newCount = 0;

  const tendersRef = adminDb.collection('tenders');
  console.log(`📦 Processing ${raw.length} tenders...`);

  // The portal lists tenders newest-first. raw[0] = most recently published.
  // Assign timestamps with a 1-second offset per position so sort order matches portal order.
  const scrapeBaseTime = Date.now();

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    const deadlineDate = parseDeadline(item.deadline);

    // Skip already-expired live tenders
    if (deadlineDate < new Date() && item.is_live) continue;

    const snapshot = await tendersRef.where('reference', '==', item.reference).limit(1).get();
    const existingDoc = snapshot.empty ? null : snapshot.docs[0];
    const existingData = existingDoc ? existingDoc.data() : null;

    // index 0 = most recently published on portal → gets highest timestamp
    const portalOrderTime = new Date(scrapeBaseTime - i * 1000).toISOString();

    const tenderData = {
      title: item.title,
      organization: item.organization,
      category: item.category || "Non spécifié",
      region: item.region || "National",
      deadline: deadlineDate.toISOString(),
      // Preserve an already-fetched budget when quick mode returns null
      budget: item.budget ?? existingData?.budget ?? null,
      url: item.url,
      is_live: item.is_live === true,
      reference: item.reference,
      // New tenders: use portal-order timestamp. Existing: keep original so relative order is stable.
      published_at: existingData?.published_at ?? portalOrderTime
    };

    if (existingDoc) {
      await tendersRef.doc(existingDoc.id).update(tenderData);
    } else {
      const newDoc = await tendersRef.add(tenderData);
      newCount++;

      // Fire-and-forget Telegram notification
      const msg = formatTenderMessage({ ...item, deadline: deadlineDate.toISOString() });
      sendTelegramMessage(msg).catch(err =>
        console.warn("⚠️ Telegram notification failed:", err instanceof Error ? err.message : err)
      );

      broadcast({ type: "new_tender", data: { id: newDoc.id, ...tenderData } });
    }
  }

  await adminDb.collection('stats').doc('last_scrape').set({
    scraped_at: new Date().toISOString(),
    new_tenders: newCount,
    total_found: raw.length
  });

  console.log(`✅ Scrape complete: ${newCount} new / ${raw.length} total`);
  await cleanupExpiredTenders();
}

async function cleanupExpiredTenders() {
  console.log("🧹 Cleaning up expired tenders...");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const nowISO = now.toISOString();

  try {
    const snapshot = await adminDb.collection('tenders').get();
    const batch = adminDb.batch();
    let count = 0;

    snapshot.docs.forEach((doc: any) => {
      if (doc.data().deadline < nowISO) {
        batch.delete(doc.ref);
        count++;
      }
    });

    if (count > 0) {
      await batch.commit();
      console.log(`🗑️ Deleted ${count} expired tenders`);
    } else {
      console.log("✨ No expired tenders");
    }
  } catch (e) {
    console.error("❌ Cleanup failed:", e);
  }
}
