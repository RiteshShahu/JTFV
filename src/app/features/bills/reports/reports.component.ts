import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { BillsService } from 'src/app/core/services/bills.service';
import { ToastService } from 'src/app/core/services/toast.service';

@Component({
  selector: 'app-reports',
  templateUrl: './reports.component.html',
  styleUrls: ['./reports.component.css']
})
export class ReportsComponent implements OnInit {
  searchBy: 'billNumber' | 'clientName' = 'billNumber';
  searchText = '';
  bills: any[] = [];
  filteredBills: any[] = [];
  selectedBill: any = null;

  // Filters / state
  paidFilter: 'all' | 'paid' | 'unpaid' = 'all';
  isToggling = new Set<string>(); // in-flight protection per bill

  // NEW: downloading guard per bill
  downloading = new Set<string>();

  constructor(
    private billsService: BillsService,
    private router: Router,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.billsService.getAllBills().subscribe({
      next: (data) => {
        this.bills = data.map((bill: any) => {
          // Normalize billItems into array
          let billItems: any[] = [];
          if (Array.isArray(bill.billItems)) {
            billItems = bill.billItems;
          } else {
            try {
              const parsed = JSON.parse(bill.billItems);
              billItems = Array.isArray(parsed) ? parsed : [];
            } catch {
              billItems = [];
            }
          }

          // Ensure new fields exist with safe defaults
          const isPaid =
            typeof bill.isPaid === 'boolean'
              ? bill.isPaid
              : !!Number(bill.isPaid); // handles 0/1 from SQLite
          const paidAt = bill.paidAt || null;

          const derivedBillType =
            typeof bill.billType === 'string' && bill.billType
              ? String(bill.billType).toLowerCase()
              : this.deriveBillType({ ...bill, billItems });

          return { ...bill, billItems, billType: derivedBillType, isPaid, paidAt };
        });

        this.applyFilters();
      },
      error: (err) => {
        console.error('Failed to load bills:', err);
        this.toast.error('Failed to load bills.');
      }
    });
  }

  /** BEST-EFFORT classifier for old records without billType. Tweak as needed. */
  private deriveBillType(bill: any): string | null {
    const name = (bill.clientName || '').toString().toLowerCase();

    // If Reliance bills always used this client name, this will catch them:
    if (name.includes('freshpik spectra powai')) return 'reliance';

    // Heuristic: if billItems look like product-line items (have productId/price),
    // and clientName is empty/unknown (as in the Reliance template), classify as reliance.
    const items = Array.isArray(bill.billItems) ? bill.billItems : [];
    const looksLikeProductLines = items.some(
      (it: any) => it && (it.productId || it.price || it.quantity)
    );
    if (!bill.clientName && looksLikeProductLines) return 'reliance';

    return null;
  }

  selectBill(bill: any): void {
    this.selectedBill = { ...bill, billItems: bill.billItems };
  }

  closeDetail(): void {
    this.selectedBill = null;
  }

  async deleteBill(billNumber: string): Promise<void> {
    if (!billNumber) {
      this.toast.warn('Missing bill number.');
      return;
    }

    const ok = await this.toast.confirm({
      message: `Delete Bill No: ${billNumber}?`,
      type: 'warn',
      okText: 'Delete',
      cancelText: 'Cancel',
    });
    if (!ok) return;

    this.billsService.deleteBill(billNumber).subscribe({
      next: () => {
        this.bills = this.bills.filter(b => b.billNumber !== billNumber);
        this.filteredBills = this.filteredBills.filter(b => b.billNumber !== billNumber);
        if (this.selectedBill?.billNumber === billNumber) this.selectedBill = null;
        this.toast.success('Bill deleted successfully.');
      },
      error: err => {
        console.error('Failed to delete bill:', err);
        this.toast.error('Error deleting bill.');
      }
    });
  }

  /** Old helper still used by goToEdit; returns the intended link parts. */
  getEditLink(bill: any): string[] {
    if (this.isRelianceBill(bill)) {
      return ['/edit-reliance-bills', bill.billNumber];
    }
    if (bill.description) {
      return ['/edit-lumpsum-bills', bill.billNumber];
    }
    return ['/edit-bills', bill.billNumber];
  }

  /** More robust Reliance detector. */
  private isRelianceBill(bill: any): boolean {
    // 1) Explicit tag
    if (bill.billType && String(bill.billType).toLowerCase() === 'reliance') return true;

    // 2) Fallback on client name
    const name = (bill.clientName || '').toString().toLowerCase();
    if (name.includes('freshpik spectra powai')) return true;

    // 3) Heuristic fallback for legacy rows
    const items = Array.isArray(bill.billItems) ? bill.billItems : [];
    const looksLikeProductLines = items.some(
      (it: any) => it && (it.productId || it.price || it.quantity)
    );
    if (!bill.clientName && looksLikeProductLines) return true;

    return false;
  }

  /** Do navigation in TS so we can debug and ensure params are correct. */
  goToEdit(bill: any): void {
    const link = this.getEditLink(bill);
    console.log('Navigating to:', link);
    this.router.navigate(link);
  }

  onRowClick(bill: any) {
    if (!bill?.billNumber) return;
    if (this.isRelianceBill(bill)) {
      this.router.navigate(['/edit-reliance-bills', bill.billNumber]);
    } else if (bill.description) {
      this.router.navigate(['/edit-lumpsum-bills', bill.billNumber]);
    } else {
      this.router.navigate(['/edit-bills', bill.billNumber]);
    }
  }

  onSearch(): void {
    this.applyFilters();
  }

  /** NEW: unified filters (text + paid) */
  applyFilters(): void {
    const query = this.searchText.trim().toLowerCase();

    let list = [...this.bills];

    // text filter
    if (query) {
      list = list.filter(bill => {
        if (this.searchBy === 'billNumber') {
          return (bill.billNumber || '').toString().toLowerCase().includes(query);
        } else if (this.searchBy === 'clientName') {
          return (bill.clientName || '').toString().toLowerCase().includes(query);
        }
        return false;
      });
    }

    // paid filter
    if (this.paidFilter === 'paid') {
      list = list.filter(b => !!b.isPaid);
    } else if (this.paidFilter === 'unpaid') {
      list = list.filter(b => !b.isPaid);
    }

    this.filteredBills = list;
  }

  /** Safer print via hidden iframe (keeps your app shell intact). */
  printSelectedBill(): void {
    const container = document.getElementById('print-section');
    if (!container) {
      this.toast.warn('Nothing to print.');
      return;
    }

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>Print Bill</title>
          <style>
            @page { size: A4; margin: 10mm; }
            html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            body { margin: 0; font-family: Arial, Helvetica, sans-serif; }
          </style>
        </head>
        <body>${container.innerHTML}</body>
      </html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      this.toast.error('Unable to open print frame.');
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const finish = () => {
      try { iframe.contentWindow?.focus(); } catch {}
      try { iframe.contentWindow?.print(); } catch {}
      setTimeout(() => document.body.removeChild(iframe), 800);
    };

    setTimeout(finish, 120);
  }

  /** NEW: toggle paid/unpaid */
  async togglePaid(bill: any): Promise<void> {
    if (!bill?.billNumber) return;
    if (this.isToggling.has(bill.billNumber)) return; // prevent double clicks
    this.isToggling.add(bill.billNumber);

    const targetState = !bill.isPaid;

    const ok = await this.toast.confirm({
      message: `${targetState ? 'Mark as PAID' : 'Mark as UNPAID'}? Bill No: ${bill.billNumber}`,
      type: targetState ? 'success' : 'warn',
      okText: targetState ? 'Mark Paid' : 'Mark Unpaid',
      cancelText: 'Cancel',
    });
    if (!ok) { this.isToggling.delete(bill.billNumber); return; }

    // optimistic update
    const prev = { isPaid: bill.isPaid, paidAt: bill.paidAt };
    bill.isPaid = targetState;
    bill.paidAt = targetState ? new Date().toISOString() : null;

    this.billsService.markBillPaid(bill.billNumber, targetState).subscribe({
      next: (res) => {
        bill.isPaid = res.isPaid;
        bill.paidAt = res.paidAt ?? null;
        this.toast.success(`Bill ${bill.billNumber} marked ${res.isPaid ? 'PAID' : 'UNPAID'}.`);
        this.applyFilters();
        this.isToggling.delete(bill.billNumber);
      },
      error: (err) => {
        console.error('Toggle paid failed:', err);
        // rollback
        bill.isPaid = prev.isPaid;
        bill.paidAt = prev.paidAt;
        this.toast.error('Could not update paid status.');
        this.isToggling.delete(bill.billNumber);
      }
    });
  }

  /* ============================================================
     NEW: Download PDF (Reliance layout) directly from Reports
     - Electron: saves real PDF via ipc 'save-pdf-a4'
     - Browser: downloads HTML (open & Ctrl+P → Save as PDF)
     ============================================================ */

  async downloadPdf(billRow: any): Promise<void> {
    const billNo = billRow?.billNumber;
    if (!billNo) return;
    if (this.downloading.has(billNo)) return;
    this.downloading.add(billNo);

    try {
      // Fetch full bill from backend
      const bill = await this.billsService.getBillByNumber(billNo).toPromise();

      // Normalize billItems
      let items: any[] = [];
      if (Array.isArray(bill.billItems)) items = bill.billItems;
      else {
        try {
          const parsed = JSON.parse(bill.billItems);
          items = Array.isArray(parsed) ? parsed : [];
        } catch {
          items = [];
        }
      }

      // Prepare data common to all builders
      const payloadBase = {
        billNumber: bill.billNumber,
        billDate: bill.billDate,
        clientName: bill.clientName,
        address: bill.address,
      };

      let html = '';

      // === Reliance Bills ===
      if (this.isRelianceBill(bill)) {
        const payload = {
          ...payloadBase,
          billItems: items.map((it: any) => ({
            productId: Number(it.productId ?? it.id ?? null),
            productName: String(it.productName ?? ''),
            quantity: Number(it.quantity ?? 0),
            price: Number(it.price ?? 0),
            total: Number(it.total ?? 0),
            manualTotal: !!it.manualTotal,
          })),
          totalAmount: Number(bill.totalAmount ?? 0),
          copies: 1,
        };
        html = (window as any).EditRelianceBillsComponent
          ? (window as any).EditRelianceBillsComponent.buildRelianceHtml(payload)
          : require('src/app/features/bills/edit-reliance-bills/edit-reliance-bills.component')
              .EditRelianceBillsComponent.buildRelianceHtml(payload);
      }

      // === Lumpsum Bills ===
      else if (bill.description) {
        const payload = {
          ...payloadBase,
          description: bill.description || '',
          amount: Number(bill.totalAmount ?? 0),
          discount: Number(bill.discount ?? 0),
          finalAmount: Number(bill.finalAmount ?? bill.totalAmount ?? 0),
        };
        html = (window as any).AddLumpsumBillsComponent
          ? (window as any).AddLumpsumBillsComponent.buildLumpsumHtml(payload)
          : require('src/app/features/bills/add-lumpsum-bills/add-lumpsum-bills.component')
              .AddLumpsumBillsComponent.buildLumpsumHtml(payload);
      }

      // === Normal / Default Bills ===
      else {
        // if you later have EditBillsComponent.buildStandardHtml()
        this.toast.warn('Standard bill PDF layout not yet implemented.');
        this.downloading.delete(billNo);
        return;
      }

      // === Convert to data: URL ===
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

      const el = (window as any).electron;
      if (el?.savePdfA4) {
        // Electron → real PDF
        const res = await el.savePdfA4(dataUrl, {
          filename: `Invoice_${billNo}.pdf`,
          landscape: false,
          margins: { top: 10, right: 10, bottom: 10, left: 10 },
        });
        if (res?.ok) {
          this.toast.success(`Saved: ${res.path || 'PDF created successfully.'}`);
        } else {
          console.error('savePdfA4 failed:', res?.error);
          this.downloadAsHtml(html, `Invoice_${billNo}.html`);
          this.toast.warn('PDF save failed, downloaded HTML instead.');
        }
        return;
      }

      // Browser fallback (no Electron)
      this.downloadAsHtml(html, `Invoice_${billNo}.html`);
      this.toast.info('Downloaded HTML. Open & print to PDF.');
    } catch (err) {
      console.error('Download PDF failed:', err);
      this.toast.error('Could not prepare the PDF.');
    } finally {
      this.downloading.delete(billNo);
    }
  }

  /** ---------- Reliance HTML builder (self-contained) ---------- */
  private buildRelianceHtml(payload: {
    billNumber: string;
    billDate: string;
    clientName?: string;
    address?: string;
    billItems: Array<{ productId: number | null; productName: string; quantity: number; price: number; total: number; manualTotal?: boolean }>;
    totalAmount?: number;
    copies?: number;
    shipToName?: string;
    shipToAddress?: string;
  }): string {
    const NET_FACTOR = 0.85;
    const RELIANCE_CLIENT = 'Reliance Retail Limited';
    const RELIANCE_ADDR =
      'Reliance Corporate Park, Thane-Belapur Road, Ghansoli-400701, Navi Mumbai, Maharashtra';

    const copies = Math.max(1, Math.min(50, Math.floor(payload.copies ?? 1)));
    const shipToName = payload.shipToName ?? 'FRESHPIK SPECTRA POWAI ( T5EP )';
    const shipToAddress = payload.shipToAddress ?? 'Spectra, 1st, Central Ave, Hiranandani Gardens, Powai, Mumbai, Maharashtra 400076';

    const items = (payload.billItems || []).map(it => {
      const qty = Number(it.quantity || 0);
      if (!it.manualTotal) {
        it.total = +((qty * Number(it.price || 0)) * NET_FACTOR).toFixed(2);
      } else if (qty > 0 && isFinite(qty)) {
        it.price = +((Number(it.total || 0) / (qty * NET_FACTOR))).toFixed(2);
      }
      return it;
    });

    const totalQty = items.reduce((a, it) => a + (Number(it.quantity) || 0), 0);
    const totalItemPrice = +items.reduce((a, it) => a + (it.price || 0), 0).toFixed(2);
    const totalAmount = +(payload.totalAmount ?? +items.reduce((a, it) => a + (it.total || 0), 0).toFixed(2));

    const inr = (n: number) =>
      (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    const amountInWords = (num: number): string => {
      const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
        'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
      const b = ['', '', 'Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
      const numToWords = (n: number): string => {
        if (n < 20) return a[n];
        if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
        if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' and ' + numToWords(n % 100) : '');
        if (n < 100000) return numToWords(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + numToWords(n % 1000) : '');
        if (n < 10000000) return numToWords(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + numToWords(n % 100000) : '');
        return '';
      };
      const rupees = Math.floor(num);
      const paise = Math.round((num - rupees) * 100);
      let words = `${numToWords(rupees)} Rupees`;
      if (paise > 0) words += ` and ${numToWords(paise)} Paisa`;
      return words + ' only';
    };

    const styles = `
      <style>
        @page { size: A4; margin: 10mm; }
        @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
        body { font-family: 'Poppins','Segoe UI',Tahoma,sans-serif; color:#2c3e50; padding:40px; background:#fff; }
        h1 { margin:0; font-size:25px; font-weight:bold; color:#333; }
        p { margin:5px 0; font-size:13px; color:#546e7a; }
        .invoice-title { text-align:center; font-size:22px; font-weight:bold; margin:12px 0; color:#2c3e50; }
        .tax-parties { display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px; padding:10px 0 0; border-top:3px solid #c9c9c9; border-bottom:1px solid #c9c9c9; margin-bottom:12px; font-size:11px; }
        .party-title { text-transform:uppercase; font-weight:700; letter-spacing:.4px; margin-bottom:6px; }
        .party-name { font-weight:600; margin-bottom:4px; }
        .party-address { line-height:1.45; }
        .invoice-details .inv-row { display:flex; justify-content:space-between; margin-bottom:6px; white-space:nowrap; }
        .invoice-details .value { font-weight:600; }
        table { width:100%; border-collapse:collapse; font-size:12px; margin:16px 0; background:#fff; }
        th, td { border:1px solid #bdbdbd; padding:8px 10px; text-align:center; }
        th { background:#757575 !important; color:#fff !important; font-weight:700; }
        .total-row { background:#f4f6f8 !important; font-weight:700; }
        .left { text-align:left; }
        thead { display: table-header-group; }
        .no-repeat { page-break-inside: avoid; }
        .boxes { display:grid; grid-template-columns:2fr 1fr; gap:10px; margin-top:10px; }
        .left-column { display:flex; flex-direction:column; gap:8px; }
        .box { border:1px solid #bdbdbd; }
        .box-title { background:#757575 !important; color:#fff !important; font-weight:700; padding:6px 8px; font-size:12px; }
        .box-body { padding:6px 8px; font-size:12px; }
        .amount-grid { display:grid; grid-template-columns:1fr auto; row-gap:4px; padding:6px 8px; font-size:12px; }
        .amount-grid .v { text-align:right; }
        .page { page-break-after: always; }
        .page:last-child { page-break-after: auto; }
      </style>
    `;

    const rows = items.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${it.productName || ''}</td>
        <td>${it.quantity ?? 0}</td>
        <td>₹ ${inr(it.price ?? 0)}</td>
        <td>₹ ${inr(it.total ?? 0)}</td>
      </tr>
    `).join('');

    const body = `
      <div class="header" style="text-align:right;">
        <h1>J.T. Fruits &amp; Vegetables</h1>
        <p>Shop No. 31-32, Bldg No. 27, EMP Op Jogers Park, Thakur Village, Kandivali(E), Mumbai 400101</p>
        <p>PAN: AAJFJ0258J | FSS LICENSE ACT 2006 LICENSE NO: 11517011000128</p>
        <p>Email: jkumarshahu5@gmail.com</p>
      </div>

      <div class="invoice-title">Tax Invoice</div>

      <div class="tax-parties">
        <div class="party">
          <div class="party-title">Bill To</div>
          <div class="party-name">${payload.clientName || RELIANCE_CLIENT}</div>
          <div class="party-address">${payload.address || RELIANCE_ADDR}</div>
        </div>
        <div class="party">
          <div class="party-title">Ship To</div>
          <div class="party-name">${shipToName}</div>
          <div class="party-address">${shipToAddress}</div>
        </div>
        <div class="invoice-details">
          <div class="party-title">Invoice Details</div>
          <div class="inv-row"><span>Invoice No.:</span><span class="value">${payload.billNumber}</span></div>
          <div class="inv-row"><span>Date:</span><span class="value">${new Date(payload.billDate).toLocaleDateString('en-GB')}</span></div>
        </div>
      </div>

      <table>
        <thead>
          <tr><th>#</th><th>Item</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr>
        </thead>
        <tbody>
          ${rows}
          <tr class="total-row no-repeat">
            <td colspan="2" class="left"><strong>Total</strong></td>
            <td><strong>${totalQty}</strong></td>
            <td><strong>₹ ${inr(totalItemPrice)}</strong></td>
            <td><strong>₹ ${inr(totalAmount)}</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="boxes">
        <div class="left-column">
          <div class="box">
            <div class="box-title">Invoice Amount In Words</div>
            <div class="box-body">${amountInWords(totalAmount)}</div>
          </div>
          <div class="box">
            <div class="box-title">Terms and conditions</div>
            <div class="box-body">
              Thank You for your order!<br>
              This is a computer generated bill. No Signature Required.
            </div>
          </div>
        </div>
        <div class="box">
          <div class="box-title">Amounts</div>
          <div class="amount-grid">
            <div>Sub Total</div><div class="v">₹ ${inr(totalAmount)}</div>
            <div><strong>Total</strong></div><div class="v"><strong>₹ ${inr(totalAmount)}</strong></div>
          </div>
        </div>
      </div>
    `;

    const page = `<div class="page">${body}</div>`;
    const pages = Array.from({ length: copies }).map(() => page).join('');

    return `<!doctype html><html><head><meta charset="utf-8">${styles}<title>Invoice ${payload.billNumber}</title></head><body>${pages}</body></html>`;
  }

  private htmlToDataUrl(html: string): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }

  private downloadAsHtml(html: string, filename: string) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
}