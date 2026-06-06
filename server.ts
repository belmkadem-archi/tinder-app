import 'dotenv/config';
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import fs from "fs";
import cron from "node-cron";
import { adminDbWrapper as adminDb } from "./src/lib/firebase-admin.js";
import { scrapeAndNotify, checkConnectivity, fillMissingBudgets } from "./src/services/scraper.js";
import { scrapeAndNotifyBdc } from "./src/services/bdc-scraper.js";
import { sendTelegramMessage } from "./src/services/telegram.js";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;

app.use(cors());
app.use(express.json());

console.log("🔑 Env keys:", Object.keys(process.env).filter(k =>
  k.includes('FIREBASE') || k.includes('TELEGRAM')
).join(', '));

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/config", (_req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    appId: process.env.FIREBASE_APP_ID || "",
    firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || "(default)"
  });
});

app.get("/api/db-check", async (_req, res) => {
  try {
    const testDoc = await adminDb.collection('stats').doc('last_scrape').get();
    res.json({
      status: "ok",
      connected: true,
      databaseId: adminDb.databaseId || "(default)",
      lastScrapeExists: testDoc.exists
    });
  } catch (error) {
    console.error("❌ DB Check Failed:", error);
    res.status(500).json({
      status: "error",
      connected: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/connectivity", async (_req, res) => {
  const result = await checkConnectivity();
  res.json(result);
});

app.get("/api/tenders", async (req, res) => {
  const { page = 1, size = 20, category, region, search } = req.query;

  try {
    const snapshot = await adminDb.collection('tenders').get();
    const now = new Date();
    now.setHours(0, 0, 0, 0);

    let items: any[] = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

    // Remove expired tenders
    items = items.filter(item => new Date(item.deadline) >= now);

    if (category && category !== 'All') {
      items = items.filter(item => item.category === category);
    }

    if (region && region !== 'All') {
      items = items.filter(item => item.region === region);
    }

    if (search) {
      const q = String(search).toLowerCase();
      items = items.filter(item =>
        item.title?.toLowerCase().includes(q) ||
        item.organization?.toLowerCase().includes(q) ||
        item.reference?.toLowerCase().includes(q)
      );
    }

    // Newest first
    items.sort((a, b) =>
      new Date(b.published_at || b.deadline).getTime() - new Date(a.published_at || a.deadline).getTime()
    );

    const total = items.length;
    const offset = (Number(page) - 1) * Number(size);
    const paginatedItems = items.slice(offset, offset + Number(size));

    res.json({ total, page: Number(page), size: Number(size), items: paginatedItems });
  } catch (error) {
    console.error("❌ Firestore Error (tenders):", error);
    res.status(500).json({
      error: "Failed to fetch tenders",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/stats", async (_req, res) => {
  try {
    const tendersSnapshot = await adminDb.collection('tenders').get();
    const items: any[] = tendersSnapshot.docs.map((doc: any) => doc.data());

    const lastScrapeDoc = await adminDb.collection('stats').doc('last_scrape').get();
    const lastScrape = lastScrapeDoc.exists ? lastScrapeDoc.data() : null;

    const categories: Record<string, number> = {};
    const regions: Record<string, number> = {};
    let totalBudget = 0;
    let budgetCount = 0;

    for (const item of items) {
      if (item.category) categories[item.category] = (categories[item.category] || 0) + 1;
      if (item.region) regions[item.region] = (regions[item.region] || 0) + 1;
      if (item.budget) { totalBudget += item.budget; budgetCount++; }
    }

    res.json({
      total_tenders: items.length,
      by_category: Object.entries(categories).map(([category, count]) => ({ category, count })),
      by_region: Object.entries(regions).map(([region, count]) => ({ region, count })),
      avg_budget: budgetCount > 0 ? Math.round(totalBudget / budgetCount) : 0,
      last_scrape: lastScrape
    });
  } catch (error) {
    console.error("❌ Firestore Error (stats):", error);
    res.status(500).json({
      error: "Failed to fetch statistics",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/filters", async (_req, res) => {
  try {
    const tendersSnapshot = await adminDb.collection('tenders').get();
    const items: any[] = tendersSnapshot.docs.map((doc: any) => doc.data());

    const categories = [...new Set(items.map(i => i.category).filter(Boolean))].sort();
    const regions = [...new Set(items.map(i => i.region).filter(Boolean))].sort();

    res.json({ categories, regions });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.all("/api/scrape/trigger", (_req, res) => {
  const broadcast = (msg: any) => console.log("📢 Broadcast:", msg.type);
  scrapeAndNotify(broadcast, true).catch(err => console.error("❌ Scrape failed:", err));
  res.json({ message: "Scraping started" });
});

// ── Bons de Commande endpoints ───────────────────────────────────────────────

app.get("/api/bdc", async (req, res) => {
  const { page = 1, size = 20, category, region, search } = req.query;
  try {
    const snapshot = await adminDb.collection('bons_commande').get();
    let items: any[] = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    if (category && category !== 'All')
      items = items.filter(i => i.category === category);
    if (region && region !== 'All')
      items = items.filter(i => i.region === region);
    if (search) {
      const q = String(search).toLowerCase();
      items = items.filter(i =>
        i.title?.toLowerCase().includes(q) ||
        i.organization?.toLowerCase().includes(q) ||
        i.reference?.toLowerCase().includes(q)
      );
    }

    items.sort((a, b) =>
      new Date(b.published_at || b.date).getTime() - new Date(a.published_at || a.date).getTime()
    );

    const total = items.length;
    const offset = (Number(page) - 1) * Number(size);
    res.json({ total, page: Number(page), size: Number(size), items: items.slice(offset, offset + Number(size)) });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch bons de commande", details: String(error) });
  }
});

app.get("/api/bdc/stats", async (_req, res) => {
  try {
    const snapshot = await adminDb.collection('bons_commande').get();
    const items: any[] = snapshot.docs.map((d: any) => d.data());
    const lastScrapeDoc = await adminDb.collection('stats').doc('last_bdc_scrape').get();
    const lastScrape = lastScrapeDoc.exists ? lastScrapeDoc.data() : null;

    const categories: Record<string, number> = {};
    const regions: Record<string, number> = {};
    let totalAmount = 0, amountCount = 0;

    for (const item of items) {
      if (item.category) categories[item.category] = (categories[item.category] || 0) + 1;
      if (item.region) regions[item.region] = (regions[item.region] || 0) + 1;
      if (item.amount) { totalAmount += item.amount; amountCount++; }
    }

    res.json({
      total_bdc: items.length,
      by_category: Object.entries(categories).map(([category, count]) => ({ category, count })),
      by_region: Object.entries(regions).map(([region, count]) => ({ region, count })),
      avg_amount: amountCount > 0 ? Math.round(totalAmount / amountCount) : 0,
      total_amount: totalAmount,
      last_scrape: lastScrape
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.get("/api/bdc/filters", async (_req, res) => {
  try {
    const snapshot = await adminDb.collection('bons_commande').get();
    const items: any[] = snapshot.docs.map((d: any) => d.data());
    const categories = [...new Set(items.map(i => i.category).filter(Boolean))].sort();
    const regions = [...new Set(items.map(i => i.region).filter(Boolean))].sort();
    res.json({ categories, regions });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.all("/api/bdc/scrape", (_req, res) => {
  const broadcast = (msg: any) => console.log("📢 BDC:", msg.type);
  scrapeAndNotifyBdc(broadcast).catch(err => console.error("❌ BDC scrape failed:", err));
  res.json({ message: "BDC scraping started" });
});

// Fetch budget from detail pages for tenders that are missing it.
// Runs in its own serverless invocation (separate 10s budget from the main scrape).
app.post("/api/budgets/fill", async (_req, res) => {
  try {
    const result = await fillMissingBudgets(50);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/cleanup/trigger", async (_req, res) => {
  try {
    const now = new Date().toISOString();
    const snapshot = await adminDb.collection('tenders').where('deadline', '<', now).get();
    const batch = adminDb.batch();
    snapshot.docs.forEach((doc: any) => batch.delete(doc.ref));
    await batch.commit();
    res.json({ message: "Cleanup done", deleted: snapshot.size });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
});

app.post("/api/telegram/test", async (_req, res) => {
  try {
    await sendTelegramMessage(
      `✅ <b>PMMP Tracker — Test OK</b>\n\nLes notifications Telegram sont correctement configurées.\n\n📅 ${new Date().toLocaleString('fr-FR')}`
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

// Local-only setup (Vercel handles static files via CDN and has no persistent process)
// Wrapped in an async IIFE so there are zero top-level awaits — required for @vercel/node
if (!process.env.VERCEL) {
  (async () => {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const distPath = path.resolve(__dirname, 'dist');
    const isProduction = fs.existsSync(distPath);

    console.log(`🌍 Mode: ${isProduction ? 'Production' : 'Development'}`);

    if (!isProduction) {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
      app.use(vite.middlewares);
    } else {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        const indexPath = path.join(distPath, 'index.html');
        if (!fs.existsSync(indexPath)) {
          res.status(404).send("Frontend build not found.");
          return;
        }
        try {
          const config = {
            apiKey: process.env.FIREBASE_API_KEY || "",
            authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
            projectId: process.env.FIREBASE_PROJECT_ID || "",
            appId: process.env.FIREBASE_APP_ID || "",
            firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || "(default)"
          };
          let html = fs.readFileSync(indexPath, 'utf8');
          html = html.replace('<head>', `<head><script>window.FIREBASE_CONFIG=${JSON.stringify(config)};</script>`);
          res.send(html);
        } catch {
          res.sendFile(indexPath);
        }
      });
    }

    cron.schedule('*/30 * * * *', () => {
      console.log("⏰ Cron: scheduled scrape starting...");
      const broadcast = (msg: any) => console.log("📢 Cron:", msg.type);
      scrapeAndNotify(broadcast, false).catch(err => console.error("❌ Cron scrape failed:", err));
    });
    console.log("⏰ Cron scheduler active — scrape every 30 minutes");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server → http://localhost:${PORT}`);
      console.log("🔍 Running startup scrape...");
      const broadcast = (msg: any) => console.log("📢 Startup:", msg.type);
      scrapeAndNotify(broadcast, true).catch(err => console.error("❌ Startup scrape failed:", err));
    });
  })();
}

export default app;
