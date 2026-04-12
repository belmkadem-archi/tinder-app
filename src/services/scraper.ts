import axios from 'axios';
import * as cheerio from 'cheerio';
import { format, addDays } from 'date-fns';
import crypto from 'crypto';
import { adminDbWrapper as adminDb } from '../lib/firebase-admin';
import { sendTelegramMessage, formatTenderMessage } from './telegram';

const PMMP_BASE = "https://www.marchespublics.gov.ma/";
const SEARCH_URL = "https://www.marchespublics.gov.ma/index.php?page=entreprise.EntrepriseAdvancedSearch&AllCons&EnCours&searchAnnounce";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache"
};

const TENDER_TEMPLATES = [
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

export async function checkConnectivity() {
  try {
    const res = await axios.get(PMMP_BASE, { headers: HEADERS, timeout: 8000, validateStatus: () => true });
    return { status: 'online', code: res.status };
  } catch (e) {
    return { status: 'offline', error: e instanceof Error ? e.message : String(e) };
  }
}

const SECTORS = [
  "1.12", "1.13", "1.15", "1.17", "2.11", "3.13", 
  "1.11", "1.14", "1.16", "2.12", "2.13", "3.11", "3.12",
  "1.18", "1.19", "2.14", "2.15", "3.14", "3.15"
];

export async function scrapePmmp(isQuick: boolean = false) {
  const tenders: any[] = [];
  const seenRefs = new Set<string>();
  
  try {
    await getCookies();
    console.log("🕵️ Starting PMMP scrape...");
    // Always scrape the main search page
    let currentUrl: string | null = SEARCH_URL;
    let pagesProcessed = 0;
    const maxPages = isQuick ? 8 : 20; // Even more pages

    while (currentUrl && pagesProcessed < maxPages) {
      const nextUrl: string | null = await scrapeUrl(currentUrl, tenders, seenRefs, isQuick);
      currentUrl = nextUrl;
      pagesProcessed++;
      if (currentUrl) await new Promise(resolve => setTimeout(resolve, 800));
    }
    
    // Scrape more sectors
    const sectorsToScrape = isQuick ? SECTORS.slice(0, 12) : SECTORS;
    
    for (const sector of sectorsToScrape) {
      const sectorUrl = `${SEARCH_URL}&domaineActivite=${sector}`;
      await scrapeUrl(sectorUrl, tenders, seenRefs, isQuick);
      // Small delay to be polite
      await new Promise(resolve => setTimeout(resolve, 400));
    }
  } catch (e) {
    console.warn("Error during scrape loop:", e);
  }

  if (tenders.length > 0) {
    console.log(`✨ Scraped ${tenders.length} live tenders`);
    return tenders;
  }

  console.warn("⚠️ Using synthetic data fallback");
  
  const newTenders = [];
  for (let i = 0; i < 8; i++) {
    const template = TENDER_TEMPLATES[Math.floor(Math.random() * TENDER_TEMPLATES.length)];
    const org = ORGANIZATIONS[Math.floor(Math.random() * ORGANIZATIONS.length)];
    const region = REGIONS[Math.floor(Math.random() * REGIONS.length)];
    const daysAhead = Math.floor(Math.random() * 35) + 10;
    const deadline = format(addDays(new Date(), daysAhead), "dd/MM/yyyy");
    const budget = Math.floor((template[2] as number) * (0.85 + Math.random() * 0.4));
    const uid = crypto.createHash('md5').update(`${template[0]}${org}${deadline}`).digest('hex').substring(0, 8).toUpperCase();
    
    newTenders.push({
      title: template[0],
      organization: org,
      category: template[1],
      region: region,
      deadline: deadline,
      budget: budget,
      reference: `DEMO-${uid}`,
      url: "https://www.marchespublics.gov.ma/pmmp/",
      is_live: false
    });
  }

  return newTenders;
}

async function scrapeTenderDetails(url: string) {
  try {
    const response = await axios.get(url, { 
      headers: { 
        ...HEADERS, 
        "Referer": SEARCH_URL,
        "Cookie": cookies.join('; ')
      }, 
      timeout: 12000 
    });
    
    if (response.status === 200) {
      const html = response.data;
      if (!html.toLowerCase().includes("estimation")) {
        console.warn(`⚠️ Detail page for ${url} does not contain 'Estimation' text.`);
        return null;
      }

      const $ = cheerio.load(html);
      let budget: number | null = null;
      
      // PMMP detail pages often use a table or a list of divs
      $('tr, div, p, td, th').each((i, el) => {
        const text = $(el).text().trim();
        if (text.toLowerCase().includes("estimation") && text.toLowerCase().includes("dhs")) {
          // Look for patterns like "5 674 424,40" or "19304512"
          const matches = text.match(/[\d\s\u00A0]+[.,]\d{2}/g) || text.match(/\d[\d\s\u00A0]+\d/g);
          if (matches) {
            for (const match of matches) {
              const cleaned = match.replace(/[\s\u00A0]/g, '').replace(',', '.');
              const num = parseFloat(cleaned);
              if (!isNaN(num) && num > 1000) {
                budget = num;
                return false;
              }
            }
          }

          // Check siblings
          let siblingText = $(el).next().text().trim();
          if (!siblingText || siblingText.length < 2) {
            siblingText = $(el).closest('tr').find('td').last().text().trim();
          }

          if (siblingText) {
            const cleaned = siblingText.replace(/[\s\u00A0]/g, '').replace(',', '.').replace(/[^\d.]/g, '');
            const num = parseFloat(cleaned);
            if (!isNaN(num) && num > 1000) {
              budget = num;
              return false;
            }
          }
        }
      });

      if (budget) {
        console.log(`✅ Extracted budget: ${budget} for ${url}`);
      } else {
        console.warn(`❓ Could not extract budget from detail page: ${url}`);
      }

      return budget;
    } else {
      console.warn(`⚠️ Detail page returned status ${response.status} for ${url}`);
    }
  } catch (e) {
    console.warn(`⚠️ Failed to fetch details for ${url}:`, e instanceof Error ? e.message : String(e));
  }
  return null;
}

let cookies: string[] = [];

async function getCookies() {
  try {
    const res = await axios.get(PMMP_BASE, { headers: HEADERS, timeout: 8000 });
    if (res.headers['set-cookie']) {
      cookies = res.headers['set-cookie'];
      console.log("🍪 Cookies obtained");
    }
  } catch (e) {
    console.warn("⚠️ Failed to get cookies:", e instanceof Error ? e.message : String(e));
  }
}

async function scrapeUrl(url: string, tenders: any[], seenRefs: Set<string>, isQuick: boolean): Promise<string | null> {
  try {
    console.log(`🌐 Scraping: ${url}`);
    const response = await axios.get(url, {
      headers: { 
        ...HEADERS, 
        "Cookie": cookies.join('; ')
      },
      timeout: 25000,
      validateStatus: () => true
    });

    if (response.status === 200) {
      const $ = cheerio.load(response.data);
      
      const rows = $('.table-results tr').get();
      
      for (const el of rows) {
        const cells = $(el).find('td');
        if (cells.length >= 5) {
          const reference = $(el).find('.ref').text().trim();
          if (!reference || seenRefs.has(reference)) continue;
          seenRefs.add(reference);

          // Extract Objet
          let title = "";
          $(el).find('.objet-line').each((j, obj) => {
            const text = $(obj).text().replace(/\s+/g, ' ').trim();
            if (text.toLowerCase().includes("objet :")) {
              title = text.split(/objet\s*:/i)[1]?.trim() || "";
            }
          });

          // Extract Organization
          let organization = "";
          $(el).find('.objet-line').each((j, obj) => {
            const text = $(obj).text().replace(/\s+/g, ' ').trim();
            if (text.toLowerCase().includes("acheteur public :")) {
              organization = text.split(/acheteur\s+public\s*:/i)[1]?.trim() || "";
            }
          });

          // Extract Deadline
          const deadlineRaw = $(el).find('.cloture-line').text().trim();
          const deadline = deadlineRaw.replace(/\s+/g, ' ').trim();

          // Extract Region
          const region = $(el).find('[id*="panelBlocLieuxExec"]').text().trim() || "National";

          // Extract URL and IDs
          const refCons = $(el).find('input[id*="_refCons"]').val() as string;
          const orgCons = $(el).find('input[id*="_orgCons"]').val() as string;
          
          let fullUrl = SEARCH_URL;
          if (refCons && orgCons) {
            fullUrl = `${PMMP_BASE}index.php?page=entreprise.EntrepriseDetailsConsultation&refConsultation=${refCons}&orgAcronyme=${orgCons}`;
          } else {
            const detailLink = $(el).find('a[href*="EntrepriseDetailConsultation"]').attr('href');
            if (detailLink) {
              const link = detailLink.startsWith('?') ? 'index.php' + detailLink : detailLink;
              fullUrl = `${PMMP_BASE}${link}`.replace('EntrepriseDetailConsultation', 'EntrepriseDetailsConsultation');
            }
          }

          // Extract Category
          const category = $(el).find('[id*="panelBlocCategorie"]').text().trim() || "Non spécifié";

          if (title && reference) {
            // Fetch budget from detail page
            console.log(`📄 Fetching details for: ${reference}`);
            const budget = await scrapeTenderDetails(fullUrl);
            // Small delay between detail requests to be safe
            await new Promise(resolve => setTimeout(resolve, 300));

            tenders.push({
              title,
              organization: organization || "Organisme Public",
              deadline: deadline.split(' ')[0], // Just the date part
              category,
              region: region.split('\n')[0].trim(),
              budget,
              reference,
              url: fullUrl,
              is_live: true
            });
          }
        }
      }

      // Find next page link
      const nextLink = $('.pagination a, a[title*="Suivant"], a:contains(">")').filter((i, el) => {
        const t = $(el).text().toLowerCase() + ($(el).attr('title') || '').toLowerCase();
        return t.includes('>') || t.includes('suivant');
      }).first().attr('href');
      
      if (nextLink && nextLink !== "#") {
        return nextLink.startsWith('http') ? nextLink : `${PMMP_BASE}${nextLink.startsWith('/') ? nextLink.substring(1) : nextLink}`;
      }
    }
  } catch (e) {
    console.warn(`❌ Scrape failed for ${url}:`, e instanceof Error ? e.message : String(e));
  }
  return null;
}

export async function scrapeAndNotify(broadcast: (msg: any) => void, isQuick: boolean = false) {
  console.log(`🔍 Scraping PMMP... [${format(new Date(), 'HH:mm:ss')}] (Quick: ${isQuick})`);
  const raw = await scrapePmmp(isQuick);
  let newCount = 0;

  const tendersRef = adminDb.collection('tenders');
  console.log(`📦 Processing ${raw.length} tenders...`);

  for (const item of raw) {
    // Check if exists in Firestore
    const snapshot = await tendersRef.where('reference', '==', item.reference).limit(1).get();
    const existingDoc = snapshot.empty ? null : snapshot.docs[0];
    const existingData = existingDoc ? existingDoc.data() : null;
    
    let deadlineDate: Date;
    try {
      const parts = item.deadline.split('/');
      const yearPart = parts[2].substring(0, 4);
      deadlineDate = new Date(parseInt(yearPart), parseInt(parts[1]) - 1, parseInt(parts[0]));
      
      if (isNaN(deadlineDate.getTime())) {
        throw new Error("Invalid date");
      }
    } catch (e) {
      deadlineDate = addDays(new Date(), 30);
    }

    if (deadlineDate < new Date() && item.is_live) continue;

    const tenderData = {
      title: item.title,
      organization: item.organization,
      category: item.category || "Non spécifié",
      region: item.region || "National",
      deadline: deadlineDate.toISOString(),
      budget: item.budget,
      url: item.url,
      is_live: item.is_live ? 1 : 0,
      reference: item.reference,
      published_at: existingData ? existingData.published_at : new Date().toISOString()
    };

    if (existingDoc) {
      await tendersRef.doc(existingDoc.id).update(tenderData);
    } else {
      const newDoc = await tendersRef.add(tenderData);
      newCount++;

      // Send Telegram notification
      const telegramMsg = formatTenderMessage({
        ...item,
        deadline: deadlineDate.toISOString()
      });
      sendTelegramMessage(telegramMsg);

      broadcast({
        type: "new_tender",
        data: {
          id: newDoc.id,
          ...tenderData
        }
      });
    }
  }

  await adminDb.collection('stats').doc('last_scrape').set({
    scraped_at: new Date().toISOString(),
    new_tenders: newCount,
    total_found: raw.length
  });
    
  console.log(`✅ Scrape done: ${newCount} new tenders out of ${raw.length} found`);
}
