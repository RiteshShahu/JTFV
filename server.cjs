const express = require('express');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

const userDataPath = process.env.USER_DATA_PATH || path.join(__dirname, 'userdata');
const dbPath = path.join(userDataPath, 'database.db');
const defaultDbPath = process.env.DEFAULT_DB_PATH || (
  process.resourcesPath
    ? path.join(process.resourcesPath, 'app_data', 'database.db')
    : path.join(__dirname, 'database.db')
);

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

if (!fs.existsSync(dbPath)) {
  try {
    if (fs.existsSync(defaultDbPath)) {
      fs.copyFileSync(defaultDbPath, dbPath);
      console.log('✅ Copied default database to userData path');
    } else {
      console.warn('⚠️ Default database not found at:', defaultDbPath);
    }
  } catch (err) {
    console.error('❌ Error copying default database:', err);
  }
}

function normalizeBillNumber(v) {
  if (v === undefined || v === null) return '';
  const raw = String(v).trim();
  const n = parseInt(raw, 10);
  if (!Number.isNaN(n)) return String(n).padStart(3, '0'); // 001, 012, 120...
  return raw; // fall back
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) return console.error('Error opening database:', err);
  console.log('Connected to SQLite database:', dbPath);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    Username TEXT UNIQUE, 
    password TEXT)
    `);

  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    firstName TEXT, 
    middleName TEXT, 
    lastName TEXT, 
    phone TEXT, 
    mobile TEXT, 
    fax TEXT, 
    email TEXT, 
    clientType TEXT, 
    address1 TEXT, 
    address2 TEXT, 
    area TEXT, 
    subArea TEXT, 
    city TEXT, 
    landmark TEXT, 
    franchise TEXT, 
    dateOfEntry TEXT, 
    entryTime TEXT
    )
    `);

  db.run(`
  CREATE TABLE IF NOT EXISTS names (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT,
    name TEXT NOT NULL,
    type TEXT,
    priority TEXT,
    units TEXT,
    mrp REAL,
    expiryDays INTEGER,
    createdAt TEXT DEFAULT (datetime('now')),
    UNIQUE(barcode)
  )
`);

  db.serialize(() => {
    db.run(`DROP TABLE IF EXISTS products`);

    db.run(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        Barcode TEXT NOT NULL,
        topPriority TEXT,
        units TEXT,
        itemType TEXT,
        dateOfEntry TEXT,
        entryTime TEXT,
        FOREIGN KEY(Barcode) REFERENCES names(barcode)
      )
    `);
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      clientName TEXT,
      address TEXT,
      billNumber TEXT,
      billDate TEXT,
      discount REAL,
      discountAmount REAL,
      totalAmount REAL,
      finalAmount REAL,
      description TEXT,
      billItems TEXT,
      billType TEXT,
      isPaid INTEGER DEFAULT 0,   -- 0 = unpaid, 1 = paid
      paidAt TEXT                 -- ISO timestamp or NULL
    )
  `);

  // 2) Backfill columns for old DBs (safe no-op if already present)
  (function ensureBillColumns() {
    db.all(`PRAGMA table_info(bills)`, [], (err, cols) => {
      if (err) { console.error('PRAGMA table_info(bills) failed:', err); return; }
      const names = new Set(cols.map(c => c.name));
      const addCol = (sql) => db.run(sql, [], (e) => {
        if (e && !String(e.message || '').includes('duplicate column')) {
          console.warn('ALTER TABLE failed:', e.message);
        }
      });

      if (!names.has('isPaid')) addCol(`ALTER TABLE bills ADD COLUMN isPaid INTEGER DEFAULT 0`);
      if (!names.has('paidAt')) addCol(`ALTER TABLE bills ADD COLUMN paidAt TEXT`);
    });

    // Unique index on billNumber (you already had this)
    db.run(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_bills_billNumber ON bills(billNumber)`);
  })();

  // Enable FK so items delete with job
  db.run(`PRAGMA foreign_keys = ON`);

  // Print history: headers
  db.run(`
    CREATE TABLE IF NOT EXISTS print_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      createdAt TEXT NOT NULL,        -- ISO timestamp
      packedOnDate TEXT NOT NULL,     -- YYYY-MM-DD (your input)
      printStyle TEXT NOT NULL,       -- 'reliance' | 'dmart' | 'old-dmart'
      clientName TEXT,                -- optional (kept for future)
      totalLabels INTEGER NOT NULL
    )
  `);

  // Print history: items
  db.run(`
    CREATE TABLE IF NOT EXISTS print_job_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      jobId INTEGER NOT NULL,
      nameId INTEGER,                 -- link to names.id if known
      productName TEXT NOT NULL,      -- frozen label text
      units TEXT,
      category TEXT,
      mrp REAL NOT NULL,
      quantity INTEGER NOT NULL,      -- qty per product line
      expiryDays INTEGER NOT NULL,
      expiryDate TEXT NOT NULL,       -- YYYY-MM-DD
      packedOnDate TEXT NOT NULL,     -- duplicate for convenience
      barcode TEXT NOT NULL,
      FOREIGN KEY (jobId) REFERENCES print_jobs(id) ON DELETE CASCADE
    )
  `);

  db.run(`CREATE INDEX IF NOT EXISTS idx_print_jobs_createdAt ON print_jobs(createdAt)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_print_job_items_jobId ON print_job_items(jobId)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_print_job_items_barcode ON print_job_items(barcode)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_print_jobs_packedOnDate ON print_jobs(packedOnDate)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_print_job_items_packedOnDate ON print_job_items(packedOnDate)`);


});

// ==================== CLIENT ROUTES ====================
app.post('/api/clients', (req, res) => {
  const c = req.body;

  const query = `
    INSERT INTO clients (
      firstName, middleName, lastName, phone, mobile, fax, email,
      clientType, address1, address2, area, subArea, city, landmark,
      franchise, dateOfEntry, entryTime
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const values = [
    c.firstName, c.middleName, c.lastName, c.phone, c.mobile, c.fax, c.email,
    c.clientType, c.address1, c.address2, c.area, c.subArea, c.city, c.landmark,
    c.franchise, c.dateOfEntry, c.entryTime
  ];

  db.run(query, values, function (err) {
    if (err) {
      console.error('❌ Failed to insert client:', err.message);
      return res.status(500).json({ message: 'Failed to save client', error: err.message });
    }
    res.status(201).json({ message: 'Client saved successfully', id: this.lastID });
  });
});

app.get('/api/clients', (req, res) => {
  db.all('SELECT * FROM clients ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch clients', error: err.message });
    res.json(rows);
  });
});

// ==================== NAME ROUTES ====================
app.get('/api/names', (req, res) => {
  db.all('SELECT * FROM names ORDER BY id DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch names', error: err.message });
    res.json(rows);
  });
});

// Get all names
app.post('/api/names', (req, res) => {
  const { name, type, priority, units, barcode, mrp, expiryDays } = req.body;
  if (!name) return res.status(400).json({ message: 'Name is required' });

  const query = `
    INSERT INTO names (barcode, name, type, priority, units, mrp, expiryDays) 
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  const bc = (barcode && String(barcode).trim()) ? String(barcode).trim() : null;

  db.run(
    query,
    [bc, name.trim(), type || null, priority || '', units || '', mrp || null, expiryDays || null],
    function (err) {
      if (err) {
        console.error('❌ Failed to add name:', err.message);
        return res.status(500).json({
          message: 'Failed to add name',
          details: err.message,
          code: err.code,
        });
      }
      res.status(201).json({ message: 'Name added', id: this.lastID });
    }
  );
});


// Get a single name by ID
app.get('/api/names/:id', (req, res) => {
  db.get('SELECT * FROM names WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch name' });
    if (!row) return res.status(404).json({ message: 'Name not found' });
    res.json(row);
  });
});

// Update a name
app.put('/api/names/:id', (req, res) => {
  const { name, type, priority, units, mrp, expiryDays, barcode } = req.body;
  const id = req.params.id;

  if (barcode && barcode.trim() !== '') {
    db.get('SELECT id FROM names WHERE barcode = ? AND id != ?', [barcode.trim(), id], (err, row) => {
      if (err) {
        console.error('❌ Barcode check failed:', err.message);
        return res.status(500).json({ message: 'Database error' });
      }

      if (row) {
        return res.status(400).json({ message: '❌ Barcode already exists for another product' });
      }

      return doUpdate();
    });
  } else {
    return doUpdate();
  }

  function doUpdate() {
    db.run(`
      UPDATE names 
      SET name = ?, type = ?, priority = ?, units = ?, mrp = ?, expiryDays = ?, barcode = ?
      WHERE id = ?
    `, [name, type, priority, units, mrp || null, expiryDays || null, barcode || '', id], function (err) {
      if (err) {
        console.error('❌ Update failed:', err.message);
        return res.status(500).json({ message: 'Failed to update name', error: err.message });
      }

      if (this.changes === 0) {
        return res.status(404).json({ message: 'Product not found' });
      }

      res.json({ message: '✅ Product updated successfully' });
    });
  }
});

// // DELETE /api/names/vegetables — deletes only vegetable rows
// app.delete('/api/names/vegetables', (req, res) => {
//   db.run(`DELETE FROM names WHERE type = 'vegetable'`, function (err) {
//     if (err) {
//       console.error('❌ Failed to delete vegetable entries:', err.message);
//       res.status(500).json({ message: 'Failed to delete vegetables' });
//     } else {
//       console.log('🥦 Deleted old vegetable entries');
//       res.status(200).json({ message: 'Vegetables deleted' });
//     }
//   });
// });

// ==================== PRODUCT ROUTES ====================
app.post('/api/products', (req, res) => {
  console.log('Incoming POST /api/products', req.body);
  const p = req.body;
  const values = [p.Barcode, p.topPriority, p.units, p.itemType, p.dateOfEntry, p.entryTime];

  db.run(`
    INSERT INTO products (Barcode, topPriority, units, itemType, dateOfEntry, entryTime)
    VALUES (?, ?, ?, ?, ?, ?)`, values, function (err) {
    if (err) {
      console.error('❌ SQL Error:', err); // 👈 Log it
      return res.status(500).json({ message: 'Failed to save product', error: err.message });
    }
    res.status(201).json({ message: 'Product saved successfully', id: this.lastID });
  });
});

app.get('/api/products', (req, res) => {
  db.all('SELECT * FROM products', [], (err, rows) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch products' });
    res.json(rows);
  });
});

app.get('/api/products/:id', (req, res) => {
  db.get('SELECT * FROM products WHERE id = ?', [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch product' });
    if (!row) return res.status(404).json({ message: 'Product not found' });
    res.json(row);
  });
});

app.put('/api/products/:id', (req, res) => {
  const p = req.body;
  const values = [p.Barcode, p.topPriority, p.units, p.itemType, p.dateOfEntry, p.entryTime, req.params.id];
  db.run(`
    UPDATE products SET Barcode=?, topPriority=?, units=?, itemType=?, dateOfEntry=?, entryTime=?
    WHERE id=?`, values, function (err) {
    if (err) return res.status(500).json({ message: 'Failed to update product' });
    res.json({ message: 'Product updated successfully' });
  });
});

app.delete('/api/products/:id', (req, res) => {
  db.run('DELETE FROM products WHERE id = ?', [req.params.id], function (err) {
    if (err) return res.status(500).json({ message: 'Failed to delete product' });
    if (this.changes === 0) return res.status(404).json({ message: 'Product not found' });
    res.json({ message: 'Product deleted successfully' });
  });
});

// ==================== BILL ROUTES ====================

// Create bill
app.post('/api/bills', (req, res) => {
  const b = req.body || {};
  b.billNumber = normalizeBillNumber(b.billNumber);

  // Normalize / defaults
  const billItemsJson = JSON.stringify(Array.isArray(b.billItems) ? b.billItems : (b.billItems ? b.billItems : []));
  const isPaid = b.isPaid ? 1 : 0;
  const paidAt = b.isPaid ? (b.paidAt || new Date().toISOString()) : null;

  const query = `
    INSERT INTO bills (
      clientName, address, billNumber, billDate,
      discount, discountAmount, totalAmount, finalAmount,
      description, billItems, billType,
      isPaid, paidAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    b.clientName || '',
    b.address || '',
    b.billNumber,
    b.billDate || new Date().toISOString().substring(0, 10), // YYYY-MM-DD
    b.discount ?? 0,
    b.discountAmount ?? null,
    b.totalAmount ?? 0,
    b.finalAmount ?? 0,
    b.description || '',
    billItemsJson,
    b.billType || '',
    isPaid,
    paidAt
  ];

  db.run(query, values, function (err) {
    if (err) {
      console.error('Create bill error:', err);
      return res.status(500).json({ message: 'Failed to save bill' });
    }
    res.status(201).json({ message: 'Bill saved successfully', id: this.lastID });
  });
});

// Update bill (does NOT alter paid status here; use the /paid route below)
app.put('/api/bills/:billNumber', (req, res) => {
  const b = req.body || {};
  b.billNumber = normalizeBillNumber(b.billNumber);
  const target = normalizeBillNumber(req.params.billNumber);

  const billItemsJson = JSON.stringify(Array.isArray(b.billItems) ? b.billItems : (b.billItems ? b.billItems : []));

  const query = `
    UPDATE bills SET
      clientName = ?,
      address = ?,
      shipToName=?,
      shipToAddress=?,
      billDate = ?,
      discount = ?,
      discountAmount = ?,
      totalAmount = ?,
      finalAmount = ?,
      billItems = ?,
      description = ?,
      billType = ?
    WHERE billNumber = ?
  `;
  const values = [
    b.clientName || '',
    b.address || '',
    b.shipToName || '',
    b.shipToAddress || '',
    b.billDate || new Date().toISOString().substring(0, 10),
    b.discount ?? 0,
    b.discountAmount ?? null,
    b.totalAmount ?? 0,
    b.finalAmount ?? 0,
    billItemsJson,
    b.description || '',
    b.billType || '',
    target
  ];

  db.run(query, values, function (err) {
    if (err) {
      console.error('Update bill error:', err);
      return res.status(500).json({ message: 'Failed to update bill' });
    }
    if (this.changes === 0) return res.status(404).json({ message: 'Bill not found' });
    res.json({ message: 'Bill updated successfully' });
  });
});

// Toggle paid/unpaid
app.put('/api/bills/:billNumber/paid', (req, res) => {
  const billNumber = normalizeBillNumber(req.params.billNumber);
  const isPaid = !!req.body?.isPaid ? 1 : 0;
  const paidAt = isPaid ? new Date().toISOString() : null;

  db.run(
    `UPDATE bills SET isPaid = ?, paidAt = ? WHERE billNumber = ?`,
    [isPaid, paidAt, billNumber],
    function (err) {
      if (err) {
        console.error('Toggle paid error:', err);
        return res.status(500).json({ error: 'DB error', details: err.message });
      }
      if (this.changes === 0) return res.status(404).json({ error: 'Bill not found' });
      res.json({ ok: true, billNumber, isPaid: !!isPaid, paidAt });
    }
  );
});

// Get latest bill number (numeric sequences)
app.get('/api/bills/latest', (req, res) => {
  db.get(
    `SELECT MAX(CAST(billNumber AS INTEGER)) AS n FROM bills`,
    [],
    (err, row) => {
      if (err) return res.status(500).json({ message: 'Failed to fetch latest bill number' });
      const nextNum = (row?.n ? parseInt(row.n, 10) : 0) + 1;
      const next = String(nextNum).padStart(3, '0');
      res.json({ billNumber: next });
    }
  );
});

// Get all bills
app.get('/api/bills', (req, res) => {
  db.all('SELECT * FROM bills ORDER BY id DESC', [], (err, rows) => {
    if (err) {
      console.error('Fetch bills error:', err);
      return res.status(500).json({ message: 'Failed to fetch bills' });
    }
    res.json(rows);
  });
});

// Check if bill number exists (with variants)
app.get('/api/bills/exists', (req, res) => {
  const raw = (req.query.billNumber ?? '').toString().trim();
  if (!raw) return res.status(400).json(false);

  const n = parseInt(raw, 10);
  const variants = new Set([raw]);
  if (!Number.isNaN(n)) {
    variants.add(String(n));
    variants.add(String(n).padStart(3, '0'));
  }
  const args = Array.from(variants);
  const placeholders = args.map(() => '?').join(',');

  db.get(
    `SELECT 1 FROM bills WHERE billNumber IN (${placeholders}) LIMIT 1`,
    args,
    (err, row) => {
      if (err) {
        console.error('billExists error:', err);
        return res.status(500).json(false);
      }
      res.json(!!row);
    }
  );
});

// Get bill by number
app.get('/api/bills/:billNumber', (req, res) => {
  const billNumber = normalizeBillNumber(req.params.billNumber);
  db.get('SELECT * FROM bills WHERE billNumber = ?', [billNumber], (err, row) => {
    if (err) {
      console.error('Fetch bill error:', err);
      return res.status(500).json({ message: 'Failed to fetch bill' });
    }
    if (!row) return res.status(404).json({ message: 'Bill not found' });
    try {
      row.billItems = JSON.parse(row.billItems || '[]');
    } catch {
      row.billItems = [];
    }
    res.json(row);
  });
});

// Delete bill
app.delete('/api/bills/:billNumber', (req, res) => {
  const billNumber = normalizeBillNumber(req.params.billNumber);
  db.run('DELETE FROM bills WHERE billNumber = ?', [billNumber], function (err) {
    if (err) {
      console.error('Delete bill error:', err);
      return res.status(500).json({ message: 'Failed to delete bill' });
    }
    if (this.changes === 0) return res.status(404).json({ message: 'Bill not found' });
    res.json({ message: 'Bill deleted successfully' });
  });
});

// ==================== BARCODE ROUTES ====================
// Save one print job + its items
// enable FKs once
db.run(`PRAGMA foreign_keys = ON`);

app.post('/api/label-prints', (req, res) => {
  const { packedOnDate, printStyle, clientName, items } = req.body || {};
  if (!packedOnDate || !printStyle || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: 'Invalid payload' });
  }

  const createdAt = new Date().toISOString();
  const totalLabels = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);

  db.run(
    `INSERT INTO print_jobs (createdAt, packedOnDate, printStyle, clientName, totalLabels)
     VALUES (?, ?, ?, ?, ?)`,
    [createdAt, packedOnDate, printStyle, clientName || null, totalLabels],
    function (err) {
      if (err) return res.status(500).json({ message: 'Failed to create job' });

      const jobId = this.lastID;
      const stmt = db.prepare(
        `INSERT INTO print_job_items
         (jobId, nameId, productName, units, category, mrp, quantity, expiryDays, expiryDate, packedOnDate, barcode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      try {
        items.forEach(it => {
          stmt.run([
            jobId,
            it.nameId ?? null,
            it.productName,
            it.units ?? null,
            it.category ?? null,
            Number(it.mrp),
            Number(it.quantity),
            Number(it.expiryDays),
            it.expiryDate,
            packedOnDate,
            it.barcode,
          ]);
        });
      } catch (e) {
        console.error('❌ Insert items failed:', e);
        return res.status(500).json({ message: 'Failed to insert items' });
      } finally {
        stmt.finalize();
      }

      res.status(201).json({ jobId, createdAt, totalLabels });
    }
  );
});

app.get('/api/label-prints', (req, res) => {
  const days = Math.max(1, Number(req.query.days) || 15);
  db.all(
    `SELECT * FROM print_jobs
     WHERE datetime(createdAt) >= datetime('now', ?)
     ORDER BY datetime(createdAt) DESC`,
    [`-${days} days`],
    (err, rows) => err ? res.status(500).json({ message: 'Query failed' }) : res.json(rows)
  );
});

app.get('/api/label-prints/:jobId/items', (req, res) => {
  db.all(
    `SELECT * FROM print_job_items WHERE jobId = ? ORDER BY id ASC`,
    [req.params.jobId],
    (err, rows) => err ? res.status(500).json({ message: 'Query failed' }) : res.json(rows)
  );
});

app.get('/api/label-prints/by-date', (req, res) => {
  const date = (req.query.date || '').toString();
  const field = req.query.field === 'packedOnDate' ? 'packedOnDate' : 'createdAt';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ message: 'date must be YYYY-MM-DD' });
  }

  const where =
    field === 'createdAt'
      ? `date(createdAt) = date(?)`     // createdAt is ISO; wrap with date()
      : `packedOnDate = ?`;             // packedOnDate already YYYY-MM-DD

  db.all(
    `SELECT * FROM print_jobs
     WHERE ${where}
     ORDER BY datetime(createdAt) DESC`,
    [date],
    (err, rows) => {
      if (err) return res.status(500).json({ message: 'Query failed' });
      res.json(rows);
    }
  );
});

// ✅ Add this route near other /api/label-prints routes
app.get('/api/label-prints/all', (req, res) => {
  db.all(
    `SELECT * FROM print_jobs ORDER BY datetime(createdAt) DESC`,
    [],
    (err, rows) => err
      ? res.status(500).json({ message: 'Query failed' })
      : res.json(rows)
  );
});

// === Add near other /api/label-prints routes ===
app.get('/api/label-prints/day-totals', (req, res) => {
  const field = req.query.field === 'packedOnDate' ? 'packedOnDate' : 'createdAt';
  const from = (req.query.from || '').toString();
  const to = (req.query.to || '').toString();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ message: 'from/to must be YYYY-MM-DD' });
  }

  // Two fast paths: createdAt (jobs) vs packedOnDate (items)
  const sql =
    field === 'createdAt'
      ? `
        SELECT date(j.createdAt) AS date,
               SUM(j.totalLabels)              AS totalLabels,
               SUM(i.mrp * i.quantity)         AS totalMrp
        FROM print_jobs j
        LEFT JOIN print_job_items i ON i.jobId = j.id
        WHERE date(j.createdAt) BETWEEN date(?) AND date(?)
        GROUP BY date(j.createdAt)
        ORDER BY date DESC
      `
      : `
        SELECT i.packedOnDate                 AS date,
               SUM(i.quantity)                AS totalLabels,
               SUM(i.mrp * i.quantity)        AS totalMrp
        FROM print_job_items i
        WHERE i.packedOnDate BETWEEN ? AND ?
        GROUP BY i.packedOnDate
        ORDER BY date DESC
      `;

  db.all(sql, [from, to], (err, rows) => {
    if (err) {
      console.error('day-totals query failed:', err);
      return res.status(500).json({ message: 'Query failed' });
    }
    // normalize numbers
    const out = (rows || []).map(r => ({
      date: r.date,
      totalLabels: Number(r.totalLabels) || 0,
      totalMrp: Number(r.totalMrp) || 0,
    }));
    res.json(out);
  });
});

// NEW: Summary per day between from..to (server-side aggregation)
app.get('/api/label-prints/summary', (req, res) => {
  const field = req.query.field === 'packedOnDate' ? 'packedOnDate' : 'createdAt';
  const from = (req.query.from || '').toString();
  const to = (req.query.to || '').toString();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ message: 'from/to must be YYYY-MM-DD' });
  }

  const sql =
    field === 'createdAt'
      ? `
        WITH base AS (
          SELECT
            date(datetime(j.createdAt,'localtime')) AS day,
            j.id, j.totalLabels
          FROM print_jobs j
          WHERE date(datetime(j.createdAt,'localtime')) BETWEEN date(?) AND date(?)
        ),
        per_job AS (
          SELECT i.jobId, SUM(i.mrp * i.quantity) AS totalMrp
          FROM print_job_items i
          GROUP BY i.jobId
        )
        SELECT
          b.day                                        AS date,
          COUNT(b.id)                                  AS jobCount,
          COALESCE(SUM(b.totalLabels), 0)              AS totalLabels,
          COALESCE(SUM(pj.totalMrp), 0.0)              AS totalMrp,
          ROUND(COALESCE(SUM(pj.totalMrp),0) * 0.85, 2) AS finalAmount
        FROM base b
        LEFT JOIN per_job pj ON pj.jobId = b.id
        GROUP BY b.day
        ORDER BY b.day DESC
      `
      : `
        WITH base AS (
          SELECT
            i.packedOnDate             AS day,
            i.jobId,
            SUM(i.quantity)            AS labels,
            SUM(i.mrp * i.quantity)    AS totalMrp
          FROM print_job_items i
          WHERE i.packedOnDate BETWEEN ? AND ?
          GROUP BY i.packedOnDate, i.jobId
        )
        SELECT
          day                          AS date,
          COUNT(jobId)                 AS jobCount,
          COALESCE(SUM(labels), 0)     AS totalLabels,
          COALESCE(SUM(totalMrp), 0.0) AS totalMrp,
          ROUND(COALESCE(SUM(totalMrp),0) * 0.85, 2) AS finalAmount
        FROM base
        GROUP BY day
        ORDER BY day DESC
      `;

  db.all(sql, [from, to], (err, rows) => {
    if (err) {
      console.error('summary query failed:', err);
      return res.status(500).json({ message: 'Query failed' });
    }
    const out = (rows || []).map(r => ({
      date: r.date,
      jobCount: Number(r.jobCount) || 0,
      totalLabels: Number(r.totalLabels) || 0,
      totalMrp: Number(r.totalMrp) || 0,
      finalAmount: Number(r.finalAmount) || 0,
    }));
    res.json(out);
  });
});

// NEW: Jobs-by-day with totals (used when expanding a date)
app.get('/api/label-prints/jobs-by-day', (req, res) => {
  const date = (req.query.date || '').toString();
  const field = req.query.field === 'packedOnDate' ? 'packedOnDate' : 'createdAt';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ message: 'date must be YYYY-MM-DD' });
  }

  const where =
    field === 'createdAt'
      ? `date(datetime(lp.createdAt,'localtime')) = date(?)`
      : `lp.packedOnDate = ?`;

  const sql = `
    WITH per_job AS (
      SELECT
        i.jobId,
        SUM(i.quantity)             AS totalLabels,
        SUM(i.mrp * i.quantity)     AS totalMrp
      FROM print_job_items i
      GROUP BY i.jobId
    )
    SELECT
      lp.id,
      lp.createdAt,
      lp.packedOnDate,
      lp.printStyle,
      COALESCE(pj.totalLabels, 0)              AS totalLabels,
      COALESCE(pj.totalMrp, 0.0)               AS totalMrp,
      ROUND(COALESCE(pj.totalMrp,0) * 0.85, 2) AS finalAmount
    FROM print_jobs lp
    LEFT JOIN per_job pj ON pj.jobId = lp.id
    WHERE ${where}
    ORDER BY datetime(lp.createdAt) DESC
  `;

  db.all(sql, [date], (err, rows) => {
    if (err) {
      console.error('jobs-by-day query failed:', err);
      return res.status(500).json({ message: 'Query failed' });
    }
    res.json(rows || []);
  });
});

// NEW: Product totals between from..to with filters
function normalizeStyle(s) {
  const v = String(s || '').trim().toLowerCase().replace(/\s+/g, '');
  if (!v) return '';
  // Map common variants to canonical keys
  if (v.startsWith('rel')) return 'reliance';
  // dmart variants: "dmart", "d-mart", "old-dmart", "old dmart"
  if (v.includes('mart')) return 'dmart';
  return '';
}

app.get('/api/label-prints/product-totals', (req, res) => {
  const from = (req.query.from || '').toString();
  const to = (req.query.to || '').toString();
  const field = req.query.field === 'createdAt' ? 'createdAt' : 'packedOnDate';
  const nameId = req.query.nameId ? Number(req.query.nameId) : null;
  const productName = (req.query.productName || '').toString();
  const printStyle = normalizeStyle(req.query.printStyle); // robust normalize

  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return res.status(400).json({ error: 'from/to must be YYYY-MM-DD' });
  }
  if (nameId == null && !productName) {
    return res.status(400).json({ error: 'Provide nameId or productName' });
  }

  let where = '';
  const params = [];

  if (field === 'createdAt') {
    where += `DATE(datetime(j.createdAt,'localtime')) BETWEEN date(?) AND date(?)`;
    params.push(from, to);
  } else {
    where += `i.packedOnDate BETWEEN ? AND ?`;
    params.push(from, to);
  }

  if (nameId != null) {
    where += ` AND i.nameId = ?`;
    params.push(nameId);
  } else {
    where += ` AND LOWER(i.productName) = LOWER(?)`;
    params.push(productName);
  }

  // 🔎 Debug: see what style the server received
  console.log('[product-totals] style=', printStyle);

  // ✅ Style filter (covers many stored variants)
  if (printStyle === 'reliance') {
    where += ` AND LOWER(REPLACE(j.printStyle,' ','')) LIKE 'reliance%'`;
  } else if (printStyle === 'dmart') {
    // Match: 'dmart', 'old-dmart', 'old dmart', 'd-mart'
    where += `
      AND (
        LOWER(REPLACE(j.printStyle,'-','')) = 'dmart'
        OR LOWER(REPLACE(j.printStyle,'-','')) = 'olddmart'
        OR LOWER(REPLACE(REPLACE(j.printStyle,'-',''),' ','')) = 'dmart'
        OR LOWER(REPLACE(REPLACE(j.printStyle,'-',''),' ','')) = 'olddmart'
        OR LOWER(REPLACE(j.printStyle,'-','')) = 'dmartstyle' -- if ever saved like this
      )`;
  }

  const sql = `
    SELECT
      SUM(i.quantity)             AS totalLabels,
      SUM(i.mrp * i.quantity)     AS totalMrp
    FROM print_job_items i
    JOIN print_jobs j ON j.id = i.jobId
    WHERE ${where}
  `;

  db.get(sql, params, (err, row) => {
    if (err) {
      console.error('product-totals query failed:', err);
      return res.status(500).json({ error: 'Query failed' });
    }

    const totalLabels = Number(row?.totalLabels || 0);
    const totalMrp = Number(row?.totalMrp || 0);

    res.json({
      from, to, field,
      nameId: nameId ?? null,
      productName: nameId != null ? null : (productName || null),
      totalLabels,
      totalMrp,
      finalAmount: Math.round(totalMrp * 0.85 * 100) / 100,
    });
  });
});

// ==================== AUTH ROUTES ====================
app.post('/api/register', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ message: 'Email and password required' });

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
    if (row) return res.status(400).json({ message: 'Email already exists' });
    const hashed = await bcrypt.hash(password, 10);
    db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashed], err => {
      if (err) return res.status(500).json({ message: 'Failed to register user' });
      res.status(201).json({ message: 'User registered' });
    });
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, row) => {
    if (!row || !(await bcrypt.compare(password, row.password))) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }
    res.json({ message: 'Login successful' });
  });
});

// ==================== EMAIL SENDING WITH PDF ATTACHMENT ====================
function createMailTransporter() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === '1' || process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Gmail fallback (App Password)
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.MAIL_USER || 'jkumarshahu5@gmail.com',
      pass: process.env.MAIL_PASS || 'ezve brfd xjpt bgtp',
    },
  });
}

// ✅ create once, reuse everywhere
const mailer = createMailTransporter();

// ---- helper: normalize recipients / cc / bcc ----
function normalizeList(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    return val
      .split(/[,\s]+/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  return [];
}

function isValidEmail(addr) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
}

function resolveWindowsBrowserPath() {
  const candidates = [
    // Edge
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    // Chrome
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ==================== EMAIL BILL ROUTE (PDF attachment) ====================
app.post('/api/send-bill', async (req, res) => {
  const bill = req.body || {};
  const {
    to,
    email,
    cc,
    bcc,
    pdfHtml,
    billHtmls,
    billNumbers,
    billType,
    body,
    subject = `Invoice - ${bill.billNumber || 'JT'}`,
    filename = `Invoice-${bill.billNumber || 'JT'}.pdf`,
    billNumber,
    clientName,
    billDate,
    totalAmount,
    discount,
    finalAmount,
  } = bill;

  const recipients = [
    ...normalizeList(to),
    ...normalizeList(email),
  ];

  const seen = new Set();
  const validRecipients = recipients.filter(addr => {
    const ok = isValidEmail(addr);
    if (!ok) return false;
    const key = addr.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!validRecipients.length) {
    return res.status(400).json({ message: 'Missing or invalid recipient email(s)' });
  }

  const ccList = normalizeList(cc).filter(isValidEmail);
  const bccList = normalizeList(bcc).filter(isValidEmail);

  const transporter = mailer;

  let browser;
  try {
    const executablePath =
      process.env.PUPPETEER_EXECUTABLE_PATH || resolveWindowsBrowserPath();

    if (!executablePath) {
      return res.status(500).json({
        message: 'No Chrome/Edge found for PDF generation. Please install Microsoft Edge or Google Chrome.',
      });
    }

    // =====================================================
    // MULTI-BILL HANDLING
    // =====================================================
    if (billType === 'reliance-multi') {
      console.log('🔵 Processing multi-bill email (reliance-multi)');

      // Validate multi-bill data
      if (!Array.isArray(billHtmls) || billHtmls.length === 0) {
        return res.status(400).json({
          message: 'Invalid multi-bill email: billHtmls must be a non-empty array'
        });
      }

      if (!Array.isArray(billNumbers) || billNumbers.length === 0) {
        return res.status(400).json({
          message: 'Invalid multi-bill email: billNumbers must be a non-empty array'
        });
      }

      if (billHtmls.length !== billNumbers.length) {
        return res.status(400).json({
          message: 'Invalid multi-bill email: billHtmls and billNumbers must have same length'
        });
      }

      if (!body || typeof body !== 'string' || body.trim() === '') {
        return res.status(400).json({
          message: 'Invalid multi-bill email: body text is required'
        });
      }

      try {
        // Step 1: Generate separate PDFs from billHtmls array
        console.log(`📄 Generating ${billHtmls.length} separate PDFs...`);
        const attachments = [];

        browser = await puppeteer.launch({
          executablePath,
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        for (let i = 0; i < billHtmls.length; i++) {
          const html = billHtmls[i];
          const bNum = billNumbers[i];

          console.log(`  ➜ Generating PDF for bill ${bNum}...`);

          const page = await browser.newPage();
          await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
          await page.setContent(html, { waitUntil: 'networkidle0' });

          const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
          });

          await page.close();

          attachments.push({
            filename: `Invoice_${bNum}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
          });

          console.log(`  ✅ Generated Invoice_${bNum}.pdf`);
        }

        // Step 2: Send email with all attachments
        console.log(`📧 Sending multi-bill email to ${validRecipients.join(', ')}`);

        await transporter.sendMail({
          from: process.env.MAIL_FROM || process.env.SMTP_USER || process.env.MAIL_USER,
          to: validRecipients.join(','),
          cc: ccList.length ? ccList.join(',') : undefined,
          bcc: bccList.length ? bccList.join(',') : undefined,
          subject: subject,
          text: body, // Use the provided email body (with client names)
          attachments: attachments,
        });

        console.log(`✅ Multi-bill email sent successfully with ${attachments.length} PDF(s)`);

        return res.status(200).json({
          message: `Multi-bill email sent successfully with ${attachments.length} PDF(s)`,
          billsCount: billHtmls.length,
          attachmentsCount: attachments.length
        });
      } catch (error) {
        console.error('❌ Multi-bill email processing error:', error);
        return res.status(500).json({
          message: 'Failed to process multi-bill email',
          details: (error && error.message) ? error.message : String(error),
        });
      }
    }

    // =====================================================
    // SINGLE-BILL HANDLING (Backward compatible)
    // =====================================================
    else {
      console.log('🟢 Processing single-bill email');

      if (!pdfHtml) {
        return res.status(400).json({ message: 'Missing pdfHtml' });
      }

      try {
        browser = await puppeteer.launch({
          executablePath,
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
        await page.setContent(pdfHtml, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
        });

        // Generate default email body if not provided
        const textSummary = body ||
          `Dear ${clientName || 'Customer'},

Please find attached invoice${billNumber ? ` (${billNumber})` : ''}${billDate ? ` dated ${billDate}` : ''}.

${typeof totalAmount === 'number' ? `Total: ₹${Number(totalAmount).toLocaleString('en-IN')}\n` : ''}` +
          `${typeof discount === 'number' ? `Margin: ${discount}%\n` : ''}` +
          `${typeof finalAmount === 'number' ? `Final: ₹${Number(finalAmount).toLocaleString('en-IN')}\n` : ''}

Regards,
J.T. Fruits & Vegetables`;

        await transporter.sendMail({
          from: process.env.MAIL_FROM || process.env.SMTP_USER || process.env.MAIL_USER,
          to: validRecipients.join(','),
          cc: ccList.length ? ccList.join(',') : undefined,
          bcc: bccList.length ? bccList.join(',') : undefined,
          subject: subject,
          text: textSummary,
          attachments: [
            { filename, content: pdfBuffer, contentType: 'application/pdf' }
          ],
        });

        console.log('✅ Single-bill email sent successfully');

        return res.status(200).json({ message: 'Email sent successfully with PDF attachment' });
      } catch (error) {
        console.error('❌ Single-bill email sending failed:', error);
        return res.status(500).json({
          message: 'Failed to send email',
          details: (error && error.message) ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    console.error('❌ Unexpected error in send-bill endpoint:', error);
    return res.status(500).json({
      message: 'Failed to send email',
      details: (error && error.message) ? error.message : String(error),
    });
  } finally {
    if (browser) { try { await browser.close(); } catch { } }
  }
});


// ==================== EMAIL: PRICE CHANGE (XLSX attachment) ====================
app.post('/email/price-change', async (req, res) => {
  try {
    const { to, subject, text, html, filename, fileBase64 } = req.body || {};

    if (!Array.isArray(to) || to.length === 0) {
      return res.status(400).json({ message: 'Missing recipients array "to"' });
    }
    if (!fileBase64 || !filename) {
      return res.status(400).json({ message: 'Missing fileBase64 or filename' });
    }

    await mailer.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER || process.env.MAIL_USER,
      to: to.join(','),
      subject: subject || 'Product Price Change',
      text: text || 'Please see the attached price change sheet.',
      html: html || undefined,
      attachments: [
        {
          filename,
          content: Buffer.from(fileBase64, 'base64'),
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
      ],
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Email /email/price-change failed:', err);
    return res.status(500).json({
      message: 'Failed to send email',
      details: err?.message || String(err),
    });
  }
});

// ==================== SERVE ANGULAR APP ====================
const isElectron = !!process.versions.electron;

const angularDistPath = isElectron
  ? path.join(process.resourcesPath, 'app_data', 'dist', 'my-login-app')
  : path.join(__dirname, 'dist', 'my-login-app');

app.use(express.static(angularDistPath));

app.get('*', (req, res) => {
  const indexPath = path.join(angularDistPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    console.error('❌ index.html not found at', indexPath);
    res.status(500).send('Frontend not found. Make sure Angular build was included.');
  }
});

// ==================== START SERVER ====================
const server = app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

function shutdown() {
  console.log('\n🛑 Gracefully shutting down server...');
  server.close(() => {
    console.log('✅ Server closed. Exiting process.');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ❗ Keep server alive on unexpected errors
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception (server kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection (server kept alive):', reason);
});

process.on('exit', (code) => {
  console.log(`Process exiting with code: ${code}`);
});