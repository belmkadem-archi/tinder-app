import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const dbPath = path.resolve(process.cwd(), 'pmmp.db');

function createDb() {
  try {
    return new Database(dbPath);
  } catch (e) {
    console.error('❌ Failed to open database, it might be corrupted. Deleting and recreating...', e);
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    return new Database(dbPath);
  }
}

const db = createDb();

// Initialize schema
export function initDb() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tenders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        organization TEXT,
        category TEXT,
        region TEXT,
        deadline DATETIME,
        budget REAL,
        reference TEXT UNIQUE,
        published_at DATETIME,
        url TEXT,
        is_live INTEGER DEFAULT 0
      );

    CREATE TABLE IF NOT EXISTS alert_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      email TEXT,
      phone TEXT,
      telegram_chat_id TEXT,
      keywords TEXT,
      category TEXT,
      region TEXT,
      min_budget REAL,
      max_budget REAL,
      channels TEXT DEFAULT 'email',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER REFERENCES alert_rules(id),
      tender_id INTEGER REFERENCES tenders(id),
      sent_at DATETIME,
      channel TEXT DEFAULT 'email'
    );

    CREATE TABLE IF NOT EXISTS scraping_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scraped_at DATETIME,
      new_tenders INTEGER,
      total_found INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tenders_category ON tenders(category);
    CREATE INDEX IF NOT EXISTS idx_tenders_region ON tenders(region);
    CREATE INDEX IF NOT EXISTS idx_tenders_deadline ON tenders(deadline);
    CREATE INDEX IF NOT EXISTS idx_tenders_published ON tenders(published_at);
  `);

  // Migration: Ensure columns exist
  try {
    const tableInfo = db.prepare("PRAGMA table_info(tenders)").all() as any[];
    const columns = tableInfo.map(col => col.name);
    
    if (!columns.includes('url')) {
      db.exec("ALTER TABLE tenders ADD COLUMN url TEXT");
      console.log('🚀 Migration: Added url column to tenders table');
    }
    
    if (!columns.includes('is_live')) {
      db.exec("ALTER TABLE tenders ADD COLUMN is_live INTEGER DEFAULT 0");
      console.log('🚀 Migration: Added is_live column to tenders table');
    }
  } catch (e) {
    console.error('❌ Migration failed:', e);
  }

  console.log('✅ Database initialized');
  } catch (e) {
    console.error('❌ Database initialization failed. Retrying with fresh DB...', e);
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    process.exit(1); // Exit and let the process manager restart us with a fresh start
  }
}

export default db;
