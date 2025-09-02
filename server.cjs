const express = require('express');
const sqlite3 = require('sqlite3');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

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
      billType TEXT
    )
  `);

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS uniq_bills_billNumber ON bills(billNumber)`);

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
  db.run(query, [barcode || '', name.trim(), type || null, priority || '', units || '', mrp || null, expiryDays || null], function (err) {
    if (err) return res.status(500).json({ message: 'Failed to add name', error: err.message });
    res.status(201).json({ message: 'Name added', id: this.lastID });
  });
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
  const b = req.body;
  b.billNumber = normalizeBillNumber(b.billNumber);
  const query = `
    INSERT INTO bills (
      clientName, address, billNumber, billDate,
      discount, discountAmount,            -- ← added here
      totalAmount, finalAmount, description, billItems, billType
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const values = [
    b.clientName,
    b.address,
    b.billNumber,
    b.billDate,
    b.discount,                 // percent
    b.discountAmount ?? null,   // numeric value
    b.totalAmount,
    b.finalAmount,
    b.description || '',
    JSON.stringify(b.billItems || []),
    b.billType || ''
  ];

  db.run(query, values, function (err) {
    if (err) return res.status(500).json({ message: 'Failed to save bill' });
    res.status(201).json({ message: 'Bill saved successfully', id: this.lastID });
  });
});

// Update bill
app.put('/api/bills/:billNumber', (req, res) => {
  const b = req.body;
  b.billNumber = normalizeBillNumber(b.billNumber);
  const target = normalizeBillNumber(req.params.billNumber);

  const query = `
    UPDATE bills SET
      clientName = ?,
      address = ?,
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
    b.clientName,
    b.address,
    b.billDate,
    b.discount,
    b.discountAmount ?? null,
    b.totalAmount,
    b.finalAmount,
    JSON.stringify(b.billItems || []),
    b.description || '',
    b.billType || '',
    target
  ];

  db.run(query, values, function (err) {
    if (err) return res.status(500).json({ message: 'Failed to update bill' });
    if (this.changes === 0) return res.status(404).json({ message: 'Bill not found' });
    res.json({ message: 'Bill updated successfully' });
  });
});

// Get latest bill number
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
    if (err) return res.status(500).json({ message: 'Failed to fetch bills' });
    res.json(rows);
  });
});

// Check if bill number exists (with variants)
app.get('/api/bills/exists', (req, res) => {
  const raw = (req.query.billNumber ?? '').toString().trim();
  if (!raw) return res.status(400).json(false);

  // Build variants: raw, integer, and zero-padded 3-digit
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
  db.get('SELECT * FROM bills WHERE billNumber = ?', [req.params.billNumber], (err, row) => {
    if (err) return res.status(500).json({ message: 'Failed to fetch bill' });
    if (!row) return res.status(404).json({ message: 'Bill not found' });
    row.billItems = JSON.parse(row.billItems || '[]');
    res.json(row);
  });
});

// Delete bill
app.delete('/api/bills/:billNumber', (req, res) => {
  db.run('DELETE FROM bills WHERE billNumber = ?', [req.params.billNumber], function (err) {
    if (err) return res.status(500).json({ message: 'Failed to delete bill' });
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

// ==================== EMAIL BILL ROUTE (PDF attachment) ====================
app.post('/api/send-bill', async (req, res) => {
  const bill = req.body || {};
  const {
    // required for sending
    email,
    pdfHtml,

    // optional cosmetics / metadata
    subject = `Invoice - ${bill.billNumber || 'JT'}`,
    filename = `Invoice-${bill.billNumber || 'JT'}.pdf`,

    // optional: used for the plain-text body
    billNumber,
    clientName,
    billDate,
    totalAmount,
    discount,
    finalAmount,
    cc,
    bcc,
  } = bill;

  if (!email) return res.status(400).json({ message: 'Missing recipient email' });
  if (!pdfHtml) return res.status(400).json({ message: 'Missing pdfHtml' });

  // Mail transport (use env vars; do NOT hard-code secrets)
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.MAIL_USER || 'jkumarshahu5@gmail.com',
      pass: process.env.MAIL_PASS || 'vobd eiax vdrd yvbh',
    },
  });

  let browser;
  try {
    // Render HTML → PDF
    browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'], // keep if your host needs it
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
    await page.setContent(pdfHtml, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
    });

    // Simple text body (kept lightweight)
    const textSummary =
`Dear ${clientName || 'Customer'},

Please find attached invoice${billNumber ? ` (${billNumber})` : ''}${billDate ? ` dated ${billDate}` : ''}.

${typeof totalAmount === 'number' ? `Total: ₹${Number(totalAmount).toLocaleString('en-IN')}\n` : ''}${typeof discount === 'number' ? `Margin: ${discount}%\n` : ''}${typeof finalAmount === 'number' ? `Final: ₹${Number(finalAmount).toLocaleString('en-IN')}\n` : ''}

Regards,
J.T. Fruits & Vegetables`;

    // Send email with PDF attachment
    await transporter.sendMail({
      from: process.env.MAIL_USER,
      to: email,
      cc,
      bcc,
      subject,
      text: textSummary,
      attachments: [
        {
          filename,
          content: pdfBuffer,
          contentType: 'application/pdf',
        },
      ],
    });

    return res.status(200).json({ message: 'Email sent successfully with PDF attachment' });
  } catch (error) {
    console.error('Email sending failed:', error);
    return res.status(500).json({ message: 'Failed to send email' });
  } finally {
    if (browser) {
      try { await browser.close(); } catch {}
    }
  }
});

// ---- mail transporter (reuse everywhere) ----
function createMailTransporter() {
  // Prefer explicit SMTP if you have it; keep Gmail fallback
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: !!process.env.SMTP_SECURE, // '1' to force true
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  // Gmail (needs App Password)
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.MAIL_USER || 'jkumarshahu5@gmail.com',
      pass: process.env.MAIL_PASS || 'vobd eiax vdrd yvbh',
    },
  });
}
const mailer = createMailTransporter();

// ==================== EMAIL: PRICE CHANGE (XLSX attachment) ====================
app.post('/email/price-change', async (req, res) => {
  try {
    const {
      to,              // string[] of recipients
      subject,         // string
      message,         // plain text body
      filename,        // e.g. 'New Product Price Change.xlsx'
      fileBase64       // base64 string (no data: prefix)
    } = req.body || {};

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
      text: message || 'Please see the attached price change sheet.',
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
    res.status(500).json({ message: 'Failed to send email' });
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

function normalizeBillNumber(bn) {
  const s = String(bn ?? '').trim();
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? s : String(n).padStart(3, '0');
}

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