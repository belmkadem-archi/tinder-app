import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import cron from "node-cron";
import fs from "fs";
import { adminDbWrapper as adminDb } from "./src/lib/firebase-admin";
import { scrapeAndNotify, checkConnectivity } from "./src/services/scraper";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const wss = new WebSocketServer({ noServer: true });

  app.use(cors());
  app.use(express.json());

  // Health check for platform
  app.get("/health", (req, res) => {
    res.send("OK");
  });

  const broadcast = (data: any) => {
    const msg = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
  };

  // API Routes
  app.get("/api/connectivity", async (req, res) => {
    const result = await checkConnectivity();
    res.json(result);
  });

  app.get("/api/tenders", async (req, res) => {
    const { page = 1, size = 20, category, region, search } = req.query;
    
    try {
      let query: any = adminDb.collection('tenders');

      if (category) query = query.where('category', '==', category);
      if (region) query = query.where('region', '==', region);
      
      // Firestore doesn't support native LIKE search easily without extensions
      // For now, we'll fetch and filter if search is present, or just return all
      const snapshot = await query.orderBy('deadline', 'asc').get();
      let items = snapshot.docs.map((doc: any) => ({ id: doc.id, ...doc.data() }));

      if (search) {
        const searchLower = String(search).toLowerCase();
        items = items.filter((item: any) => 
          item.title.toLowerCase().includes(searchLower) || 
          item.organization.toLowerCase().includes(searchLower)
        );
      }

      const total = items.length;
      const offset = (Number(page) - 1) * Number(size);
      const paginatedItems = items.slice(offset, offset + Number(size));

      res.json({ total, page: Number(page), size: Number(size), items: paginatedItems });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  app.get("/api/stats", async (req, res) => {
    try {
      const tendersSnapshot = await adminDb.collection('tenders').get();
      const items = tendersSnapshot.docs.map((doc: any) => doc.data());
      
      const lastScrapeSnapshot = await adminDb.collection('stats').doc('last_scrape').get();
      const lastScrape = !lastScrapeSnapshot.empty ? lastScrapeSnapshot.docs[0].data() : null;

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
      res.status(500).json({ error: String(error) });
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

  app.post("/api/scrape/trigger", async (req, res) => {
    try {
      console.log("🚀 Manual scrape triggered via API");
      await scrapeAndNotify(broadcast, true); // Await and use quick mode for Vercel
      res.json({ message: "Scraping completed successfully" });
    } catch (error) {
      console.error("❌ Manual scrape failed:", error);
      res.status(500).json({ error: String(error) });
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

  app.post("/api/telegram/test", async (req, res) => {
    try {
      const { sendTelegramMessage } = await import("./src/services/telegram");
      await sendTelegramMessage("🔔 <b>Test de Notification</b>\n\nCeci est un message de test pour confirmer que votre bot Telegram est correctement configuré.");
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Scheduled Jobs
  cron.schedule("*/30 * * * *", () => {
    scrapeAndNotify(broadcast);
  });

  cron.schedule("0 * * * *", async () => {
    const now = new Date().toISOString();
    const snapshot = await adminDb.collection('tenders').where('deadline', '<', now).get();
    const batch = adminDb.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
    console.log(`🧹 Hourly cleanup: Removed ${snapshot.size} expired tenders`);
  });

  // Vite middleware for development
  const distPath = path.resolve(__dirname, 'dist');
  const isProduction = process.env.NODE_ENV === "production" || fs.existsSync(distPath);

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
    console.log(`📂 Serving static files from: ${distPath}`);
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      const indexPath = path.join(distPath, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send("Frontend build not found. Please run 'npm run build'.");
      }
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });
}

startServer();
