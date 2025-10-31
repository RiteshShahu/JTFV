JTFV Billing App

npm i pdf-to-printer
npm i xlsx file-saver
npm i --save-dev @types/file-saver


-- run once
ALTER TABLE bills ADD COLUMN isPaid INTEGER DEFAULT 0;         -- 0 = unpaid, 1 = paid
ALTER TABLE bills ADD COLUMN paidAt TEXT;                       -- ISO string or NULL


npm i xlsx-js-style
npm i jspdf html2canvas
