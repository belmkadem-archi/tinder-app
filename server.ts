import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import fs from "fs";
import { adminDbWrapper as adminDb, adminDb as firestore } from "./src/lib/firebase-admin.js";
import { scrapeAndNotify, checkConnectivity } from "./src/services/scraper.js";
import { collection, query, where, orderBy, getDocs, limit } from "firebase/firestore";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

// Log environment variables (keys only for security)
console.log("🔑 Available Env Vars:", Object.keys(process.env).filter(k => 
  k.includes('FIREBASE') || k.includes('TELEGRAM') || k.includes('VITE')
).join(', '));

// Health check for platform
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API Routes
app.get("/api/config", (req, res) => {
  res.json({
    apiKey: process.env.FIREBASE_API_KEY || "",
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    appId: process.env.FIREBASE_APP_ID || "",
    firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || "(default)"
  });
});

app.get("/api/db-check", async (req, res) => {
    try {
      const testDoc = await adminDb.collection('stats').doc('last_scrape').get();
      res.json({ 
        status: "ok", 
        connected: true, 
        databaseId: adminDb.databaseId || "(default)",
        lastScrapeExists: testDoc.exists 
      });
    } catch (error) {
      console.error("❌ Database Check Failed:", error);
      res.status(500).json({ 
        status: "error", 
        connected: false, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  app.get("/api/connectivity", async (req, res) => {
    const result = await checkConnectivity();
    res.json(result);
  });

  app.get("/api/tenders", async (req, res) => {
    const { page = 1, size = 20, category, region, search } = req.query;
    
    try {
      const tendersRef = collection(firestore, 'tenders');
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      const nowISO = now.toISOString();

      let constraints = [
        where('deadline', '>=', nowISO),
        orderBy('deadline', 'asc'), // Primary sort for the range filter
        orderBy('published_at', 'desc') // Secondary sort for "newest first"
      ];

      // Note: Chaining multiple orderBys with range filters on different fields 
      // usually requires a composite index in Firestore.
      // If we want "newest first" as the primary sort, we'd need:
      // orderBy('published_at', 'desc')
      // but that works best if we don't have range filter on another field or have index.
      
      // Let's stick to getting them all and sorting/filtering in memory if index is not ready,
      // OR better, simplify the query.
      
      const snapshot = await getDocs(tendersRef);
      let items = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

      // Filter by deadline (expired)
      items = items.filter(item => {
        const deadline = new Date(item.deadline);
        return deadline >= now;
      });

      // Filter by category
      if (category && category !== 'All') {
        items = items.filter(item => item.category === category);
      }

      // Filter by region
      if (region && region !== 'All') {
        items = items.filter(item => item.region === region);
      }

      // Filter by search
      if (search) {
        const searchLower = String(search).toLowerCase();
        items = items.filter((item: any) => 
          item.title.toLowerCase().includes(searchLower) || 
          item.organization.toLowerCase().includes(searchLower) ||
          item.reference?.toLowerCase().includes(searchLower)
        );
      }

      // Sort by published_at DESC (Newest first)
      items.sort((a, b) => {
        const dateA = new Date(a.published_at || a.deadline).getTime();
        const dateB = new Date(b.published_at || b.deadline).getTime();
        return dateB - dateA;
      });

      const total = items.length;
      const offset = (Number(page) - 1) * Number(size);
      const paginatedItems = items.slice(offset, offset + Number(size));

      res.json({ total, page: Number(page), size: Number(size), items: paginatedItems });
    } catch (error) {
      console.error("❌ Firestore Error (tenders):", error);
      res.status(500).json({ 
        error: "Failed to fetch tenders from database", 
        details: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  app.get("/api/stats", async (req, res) => {
    try {
      const tendersSnapshot = await adminDb.collection('tenders').get();
      const items = tendersSnapshot.docs.map((doc: any) => doc.data());
      
      const lastScrapeDoc = await adminDb.collection('stats').doc('last_scrape').get();
      const lastScrape = lastScrapeDoc.exists ? lastScrapeDoc.data() : null;

      const categories: any = {};
      const regions: any = {};
      let totalBudget = 0;
      let budgetCount = 0;

      items.forEach((item: any) => {
        categories[item.category] = (categories[item.category] || 0) + 1;
        regions[item.region] = (regions[item.region] || 0) + 1;
        if (item.budget) {
          totalBudget += item.budget;
          budgetCount++;
        }
      });

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

  app.get("/api/filters", async (req, res) => {
    try {
      const tendersSnapshot = await adminDb.collection('tenders').get();
      const items = tendersSnapshot.docs.map((doc: any) => doc.data());
      
      const categories = Array.from(new Set(items.map((i: any) => i.category))).sort();
      const regions = Array.from(new Set(items.map((i: any) => i.region))).sort();
      
      res.json({ categories, regions });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.all("/api/scrape/trigger", async (req, res) => {
    try {
      console.log("🚀 Scrape triggered (Manual or Cron)");
      
      // On Vercel, we can't easily run long background tasks.
      // We'll run a very quick scrape and return.
      // For a full scrape, the user should use the "Auto-Sync" feature in the UI
      // which runs the scraper in their browser context (via API calls).
      
      const broadcast = (msg: any) => console.log("📢 Broadcast:", msg.type);
      
      // We'll try to run it, but we won't await it to avoid timeout if possible,
      // though Vercel will likely kill it.
      scrapeAndNotify(broadcast, true).catch(err => {
        console.error("❌ Background scrape failed:", err);
      });

      res.json({ message: "Scraping started" });
    } catch (error) {
      console.error("❌ Scrape trigger failed:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: String(error) });
      }
    }
  });

  app.post("/api/cleanup/trigger", async (req, res) => {
    try {
      const now = new Date().toISOString();
      const snapshot = await adminDb.collection('tenders').where('deadline', '<', now).get();
      const batch = adminDb.batch();
      snapshot.docs.forEach(doc => batch.delete(doc.ref));
      await batch.commit();
      res.json({ message: "Cleanup triggered", deleted: snapshot.size });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

// Vite middleware for development
const distPath = path.resolve(__dirname, 'dist');
const isProduction = fs.existsSync(distPath);

console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
console.log(`📁 Dist path: ${distPath} (Exists: ${isProduction})`);

if (!isProduction) {
  console.log("🛠️ Starting in Development mode (Vite)");
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  console.log("🚀 Starting in Production mode (Static)");
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    const indexPath = path.join(distPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      try {
        let html = fs.readFileSync(indexPath, 'utf8');
        const config = {
          apiKey: process.env.FIREBASE_API_KEY || "",
          authDomain: process.env.FIREBASE_AUTH_DOMAIN || "",
          projectId: process.env.FIREBASE_PROJECT_ID || "",
          appId: process.env.FIREBASE_APP_ID || "",
          firestoreDatabaseId: process.env.FIREBASE_DATABASE_ID || "(default)"
        };
        // Inject config into HTML
        html = html.replace('<head>', `<head><script>window.FIREBASE_CONFIG = ${JSON.stringify(config)};</script>`);
        res.send(html);
      } catch (e) {
        console.error("❌ Error injecting config:", e);
        res.sendFile(indexPath);
      }
    } else {
      res.status(404).send("Frontend build not found.");
    }
  });
}

if (!process.env.VERCEL) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
  });
}

export default app;
