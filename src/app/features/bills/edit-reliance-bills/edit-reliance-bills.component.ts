import { Component, OnInit, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { ProductService, Name } from 'src/app/core/services/products.service';
import { BillsService } from 'src/app/core/services/bills.service';

interface BillItem {
  productId: number | null;
  productName: string;
  quantity: number;
  price: number;   // DB price
  total: number;   // qty * price (or manual total when manualTotal is true)
  manualTotal?: boolean;
}

type NameWithPrice = Name & { mrp?: number; price?: number; units?: string; name: string; id: number };

@Component({
  selector: 'app-edit-reliance-bills',
  templateUrl: './edit-reliance-bills.component.html',
  styleUrls: ['./edit-reliance-bills.component.css']
})
export class EditRelianceBillsComponent implements OnInit {
  @ViewChildren('productSelect') productSelectInputs!: QueryList<ElementRef>;
  @ViewChildren('priceInput')   priceInputs!: QueryList<ElementRef>;
  @ViewChildren('addressTextarea') addressTextareas!: QueryList<ElementRef>;

  products: NameWithPrice[] = [];
  namesMap:  { [id: number]: string } = {};
  /** name + units map for consistent display */
  namesWithUnitsMap: { [id: number]: string } = {};
  priceMap:  { [id: number]: number } = {};

  billItems: BillItem[] = [];
  clients: any[] = [];
  selectedClient: any = null;

  clientName = '';
  address = '';

  // Ship-to fields (optional to persist)
  shipToName = 'FRESHPIK SPECTRA POWAI ( T5EP )';
  shipToAddress = 'Spectra, 1st, Central Ave, Hiranandani Gardens, Powai, Mumbai, Maharashtra 400076';

  // Reliance defaults
  private readonly RELIANCE_CLIENT = 'Reliance Retail Limited';
  private readonly RELIANCE_ADDR =
    'Reliance Corporate Park, Thane-Belapur Road, Ghansoli-400701, Navi Mumbai, Maharashtra';

  billNumber = '';
  billDate: string = new Date().toISOString().substring(0, 10);

  totalAmount = 0;     // sum of row totals
  manualEmail = '';
  totalQuantity = 0;
  totalItemPrice = 0;
  receivedAmount: number = 0;   // user-entered value
  balanceAmount: number = 0;    // computed balance

  copiesCount = 1; // number of copies to print
  private isPrinting = false;

  constructor(
    private titleService: Title,
    private productService: ProductService,
    private billsService: BillsService,
    private route: ActivatedRoute,
    private http: HttpClient,
  ) {}

  ngOnInit(): void {
    this.titleService.setTitle('Edit Invoice - J.T. Fruits & Vegetables');

    // 1) Load products, build maps
    this.productService.getNames().subscribe((names: NameWithPrice[]) => {
      this.products = names.sort((a, b) => a.name.localeCompare(b.name));

      this.namesMap = Object.fromEntries(this.products.map(n => [n.id, n.name]));
      this.namesWithUnitsMap = Object.fromEntries(
        this.products.map(n => [n.id, n.name + (n.units ? ' ' + n.units : '')])
      );
      this.priceMap = Object.fromEntries(this.products.map(n => [n.id, Number(n.mrp ?? n.price ?? 0)]));

      // 2) Load bill by route param
      const billNumber = this.route.snapshot.paramMap.get('billNumber');
      if (billNumber) {
        this.billNumber = billNumber;
        this.loadBillForEdit(billNumber);
      } else {
        // If needed, ensure one blank row exists for editing
        this.billItems.push({ productId: null, productName: '', quantity: 0, price: 0, total: 0, manualTotal: false });
      }
    });

    // (Optional) load clients for future Name/Address use
    this.http.get<any[]>('http://localhost:3001/api/clients').subscribe({
      next: (data) => (this.clients = data),
      error: () => {}
    });
  }

  /** Ensure client fields are always present for Reliance bills */
  private ensureRelianceDefaults(): void {
    if (!this.clientName?.trim()) this.clientName = this.RELIANCE_CLIENT;
    if (!this.address?.trim()) this.address = this.RELIANCE_ADDR;
  }

  loadBillForEdit(billNumber: string): void {
    this.http.get<any>(`http://localhost:3001/api/bills/${billNumber}`).subscribe({
      next: bill => {
        this.clientName  = bill.clientName || this.clientName;
        this.address     = bill.address    || this.address;
        this.billNumber  = bill.billNumber || billNumber;
        this.billDate    = bill.billDate   || this.billDate;
        this.totalAmount = Number(bill.totalAmount ?? 0);

        let items: any[] = [];
        if (Array.isArray(bill.billItems)) {
          items = bill.billItems;
        } else {
          try {
            const parsed = JSON.parse(bill.billItems);
            items = Array.isArray(parsed) ? parsed : [];
          } catch {
            items = [];
          }
        }

        this.billItems = items.map((it: any) => {
          const pid = Number(it.productId ?? it.id ?? null);
          const qty = Number(it.quantity ?? 0);
          const price = Number(it.price ?? this.priceMap[pid] ?? 0);
          const total = Number(it.total ?? qty * price);
          const name = pid ? (this.namesWithUnitsMap[pid] || it.productName || '(Unknown)') : '';

          return {
            productId: pid,
            productName: name,
            quantity: qty,
            price,
            total,
            manualTotal: !!it.manualTotal  // restore saved flag
          } as BillItem;
        });

        if (this.billItems.length < 10) {
          const pad = 10 - this.billItems.length;
          for (let i = 0; i < pad; i++) {
            this.billItems.push({ productId: null, productName: '', quantity: 0, price: 0, total: 0, manualTotal: false });
          }
        }

        this.calculateTotalAmount();

        setTimeout(() => {
          this.addressTextareas?.forEach(t => this.resizeTextarea(t.nativeElement));
        });
      },
      error: err => {
        console.error('Could not load the bill.', err);
        alert('Could not load the bill.');
      }
    });
  }

  onClientChange(): void {
    if (this.selectedClient) {
      const c = this.selectedClient;
      const parts = [c.address1, c.address2, c.subArea, c.area, c.city].filter(Boolean);
      this.clientName = c.firstName;
      this.address = parts.join(', ');
      setTimeout(() => {
        this.addressTextareas?.forEach(t => {
          const el = t.nativeElement;
          el.style.height = 'auto';
          el.style.height = el.scrollHeight + 'px';
        });
      });
    }
  }

  onPriceKeydown(event: KeyboardEvent, index: number): void {
    if (event.key === 'Tab' && !event.shiftKey) {
      event.preventDefault();
      if (index === this.billItems.length - 1) {
        this.billItems.push({ productId: null, productName: '', quantity: 0, price: 0, total: 0, manualTotal: false });
        setTimeout(() => {
          const productSelectArray = this.productSelectInputs.toArray();
          const next = productSelectArray[index + 1];
          next?.nativeElement?.focus();
        }, 0);
      } else {
        const productSelectArray = this.productSelectInputs.toArray();
        const next = productSelectArray[index + 1];
        next?.nativeElement?.focus();
      }
    }
  }

  onProductChange(index: number): void {
    const item = this.billItems[index];
    const selectedId = item.productId ?? undefined;
    const selectedProduct = this.products.find(p => p.id === selectedId);

    if (selectedProduct) {
      const nameWithUnits = selectedProduct.name + (selectedProduct.units ? ' ' + selectedProduct.units : '');
      item.productName = nameWithUnits;

      // always take the mapped price for the newly selected product
      const dbPrice =
        this.priceMap[selectedId as number] ??
        Number((selectedProduct as any).mrp ?? (selectedProduct as any).price ?? 0);

      item.price = Number(dbPrice || 0);
    } else {
      item.productName = '(Unknown)';
      item.price = 0;
    }

    this.calculateRowTotal(index);
  }

  calculateRowTotal(index: number): void {
    const it = this.billItems[index];
    const qty = Number(it.quantity || 0);
    const price = Number(it.price || 0);

    if (!it.manualTotal) {
      it.total = +((qty * price)).toFixed(2);
    } else {
      // Keep total fixed, adjust price to match
      if (qty > 0 && isFinite(qty)) {
        it.price = +((Number(it.total || 0) / qty)).toFixed(2);
      }
    }

    this.calculateTotalAmount();
  }

  onSalesAmountInput(index: number): void {
    const it = this.billItems[index];
    it.manualTotal = true;
    const qty = Number(it.quantity || 0);
    const manualTotal = Number(it.total || 0);

    if (qty > 0 && isFinite(qty)) {
      it.price = +((manualTotal / qty)).toFixed(2);
    }

    this.calculateTotalAmount();
  }

  calculateTotalAmount(): void {
    const items = this.billItems.filter(it => it.productId !== null);

    items.forEach(it => {
      const qty = Number(it.quantity || 0);
      const price = Number(it.price || 0);
      if (!it.manualTotal) {
        it.total = +((qty * price)).toFixed(2);
      } else if (qty > 0 && isFinite(qty)) {
        it.price = +((Number(it.total || 0) / qty)).toFixed(2);
      }
    });

    this.totalQuantity  = items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
    this.totalItemPrice = +items.reduce((acc, it) => acc + (it.price || 0), 0).toFixed(2);
    this.totalAmount    = +items.reduce((acc, it) => acc + (it.total || 0), 0).toFixed(2);

    this.balanceAmount  = +(this.totalAmount - (this.receivedAmount || 0)).toFixed(2);
  }

  private fmt(n: number): string {
    return (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /** Helper to ALWAYS show "name + units" for any bill item */
  private displayName(it: BillItem): string {
    const prod = this.products.find(p => p.id === it.productId);
    if (prod) {
      return prod.name + (prod.units ? ' ' + prod.units : '');
    }
    return it.productName || '';
  }

  /** Build A4 print HTML (no preview window) */
  private buildPrintHtml(validItems: BillItem[]): string {
    const totalUnitPrice = validItems.reduce((sum, it) => sum + (it.price ?? 0), 0);

    const rows = validItems.map((it, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${this.displayName(it)}</td>
        <td>${it.quantity ?? 0}</td>
        <td>₹ ${this.fmt(it.price ?? 0)}</td>
        <td>₹ ${this.fmt(it.total ?? 0)}</td>
      </tr>
    `).join('');

    const styles = `
      <style>
        @page { size: A4; margin: 10mm; }
        @media print {
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
        body { font-family: 'Poppins','Segoe UI',Tahoma,sans-serif; color:#2c3e50; padding:40px; background:#fff; }
        h1 { margin:0; font-size:25px; font-weight:bold; color:#333; }
        p { margin:5px 0; font-size:13px; color:#546e7a; }

        .invoice-title { text-align:center; font-size:22px; font-weight:bold; margin:12px 0; color:#2c3e50; }
        .tax-parties {
          display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px;
          padding:10px 0 0; border-top:3px solid #c9c9c9; border-bottom:1px solid #c9c9c9; margin-bottom:12px; font-size:11px;
        }
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
      </style>
    `;

    const totalRow = `
      <tr class="total-row no-repeat">
        <td colspan="2" class="left"><strong>Total</strong></td>
        <td><strong>${this.totalQuantity}</strong></td>
        <td><strong>₹ ${this.fmt(totalUnitPrice)}</strong></td>
        <td><strong>₹ ${this.fmt(this.totalAmount)}</strong></td>
      </tr>
    `;

    const boxes = `
      <div class="boxes">
        <div class="left-column">
          <div class="box">
            <div class="box-title">Invoice Amount In Words</div>
            <div class="box-body">${this.amountInWords(this.totalAmount)}</div>
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
            <div>Sub Total</div><div class="v">₹ ${this.fmt(this.totalAmount)}</div>
            <div><strong>Total</strong></div><div class="v"><strong>₹ ${this.fmt(this.totalAmount)}</strong></div>
            <div>Received</div><div class="v">₹ ${this.fmt(this.receivedAmount || 0)}</div>
            <div>Balance</div><div class="v">₹ ${this.fmt(this.balanceAmount)}</div>
          </div>
        </div>
      </div>
    `;

    return `<!doctype html><html><head><meta charset="utf-8">${styles}</head><body>
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
          <div class="party-name">${this.clientName || this.RELIANCE_CLIENT}</div>
          <div class="party-address">${this.address || this.RELIANCE_ADDR}</div>
        </div>
        <div class="party">
          <div class="party-title">Ship To</div>
          <div class="party-name">${this.shipToName}</div>
          <div class="party-address">${this.shipToAddress}</div>
        </div>
        <div class="invoice-details">
          <div class="party-title">Invoice Details</div>
          <div class="inv-row"><span>Invoice No.:</span><span class="value">${this.billNumber}</span></div>
          <div class="inv-row"><span>Date:</span><span class="value">${new Date(this.billDate).toLocaleDateString('en-GB')}</span></div>
        </div>
      </div>

      <table>
        <thead>
          <tr><th>#</th><th>Item</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr>
        </thead>
        <tbody>
          ${rows}
          ${totalRow}
        </tbody>
      </table>

      ${boxes}
    </body></html>`;
  }

  /** Build multi-copy HTML by repeating the single-page body with page breaks */
  private buildPrintHtmlMulti(validItems: BillItem[], copies: number): string {
    const single = this.buildPrintHtml(validItems); // your existing single-page HTML
    const bodyMatch = single.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyContent = bodyMatch ? bodyMatch[1] : single;

    const styles = `
      <style>
        @page { size: A4; margin: 10mm; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; }
        .page { page-break-after: always; }
        .page:last-child { page-break-after: auto; }
      </style>
    `;

    const pages = Array.from({ length: Math.max(1, copies) }, () => `<div class="page">${bodyContent}</div>`).join('\n');

    return `
      <!doctype html>
      <html>
        <head><meta charset="utf-8"/><title>Invoice ${this.billNumber}</title>${styles}</head>
        <body>${pages}</body>
      </html>`;
  }

  /** PRINT — supports multiple copies. Electron first; hidden-iframe fallback. */
  async printBill(): Promise<void> {
    if (this.isPrinting) return;

    // Flush focused control so ngModel has latest values (prevents stale amounts)
    try {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();
    } catch {}

    this.isPrinting = true;

    try {
      this.ensureRelianceDefaults();

      // Normalize rows
      const validItems = this.billItems
        .filter(it => it.productId !== null)
        .map(it => {
          const prod = this.products.find(p => p.id === it.productId);
          if (prod) it.productName = prod.name + (prod.units ? ' ' + prod.units : '');
          const qty = Number(it.quantity || 0);
          if (it.manualTotal) {
            if (qty > 0 && isFinite(qty)) it.price = +((Number(it.total || 0) / qty)).toFixed(2);
          } else {
            it.total = +((qty * Number(it.price || 0))).toFixed(2);
          }
          return it;
        });

      if (!validItems.length) {
        console.warn('No valid items to print.');
        return;
      }

      // Totals for footer
      this.totalQuantity = validItems.reduce((a, it) => a + (it.quantity || 0), 0);
      this.totalAmount   = +validItems.reduce((a, it) => a + (it.total || 0), 0).toFixed(2);
      this.balanceAmount = +(this.totalAmount - (this.receivedAmount || 0)).toFixed(2);

      // Clamp copies (1..50)
      const copies = Math.max(1, Math.min(50, Math.floor(Number(this.copiesCount) || 1)));

      // Build multi-copy HTML (N pages in one job)
      const html = this.buildPrintHtmlMulti(validItems, copies);

      const dataUrl = this.htmlToDataUrl(html);
      const el = (window as any).electron;

      if (el?.printCanonA4) {
        // Electron route (preferred)
        const res = await el.printCanonA4(dataUrl, { landscape: false, copies });
        if (!res?.ok) {
          console.error('Print failed:', res?.error);
          // (Optional) show a non-blocking toast/snackbar in your UI here
        }
      } else {
        // Browser fallback: HTML already contains N pages
        await this.printHtmlInHiddenIframe(html);
      }
    } catch (err) {
      console.error('Print failed:', err);
      // (Optional) show a non-blocking toast/snackbar in your UI here
    } finally {
      this.isPrinting = false;

      // Gentle refocus to avoid input/keyboard freeze after driver dialog
      setTimeout(() => {
        try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch {}
        try { window.focus(); } catch {}
      }, 40);

      // Ask main process for a single soft nudge (no minimize/restore loops)
      try { await (window as any).electron?.refocusHard?.(); } catch {}
    }
  }
    
  emailBill(): void {
    this.ensureRelianceDefaults();

    // Validate rows
    const validItems = this.billItems.filter(
      it => it.productId !== null && (it.productName || this.namesWithUnitsMap[it.productId!]) && it.quantity > 0
    );
    if (!validItems.length) {
      alert('No valid items to email. Please add at least one valid item.');
      return;
    }
    if (!this.manualEmail || !this.manualEmail.includes('@')) {
      alert('Please enter a valid email address');
      return;
    }

    // Normalize items like print does (derive totals/prices consistently)
    const normalized = validItems.map(it => {
      const qty = Number(it.quantity || 0);
      if (it.manualTotal) {
        if (qty > 0 && isFinite(qty)) {
          it.price = +((Number(it.total || 0) / qty)).toFixed(2);
        }
      } else {
        it.total = +((qty * Number(it.price || 0))).toFixed(2);
      }
      const prod = this.products.find(p => p.id === it.productId);
      it.productName = prod ? prod.name + (prod.units ? ' ' + prod.units : '') : (it.productName || '');
      return it;
    });

    // Recompute page totals for the PDF
    this.totalQuantity = normalized.reduce((a, it) => a + (it.quantity || 0), 0);
    this.totalAmount   = +normalized.reduce((a, it) => a + (it.total || 0), 0).toFixed(2);

    // Build the same print HTML
    const pdfHtml = this.buildPrintHtml(normalized);

    const billData = {
      clientName: this.clientName,
      address: this.address,
      billNumber: this.billNumber,
      billDate: this.billDate,
      totalAmount: this.totalAmount,
      billItems: normalized,
      email: this.manualEmail,
      billType: 'reliance',
      pdfHtml
    };

    this.billsService.sendBillByEmail(billData).subscribe({
      next: () => alert('Email Sent!'),
      error: (err) => {
        console.error('Email failed:', err);
        alert('Failed to send email. Please try again.');
      }
    });
  }

  saveBill(): void {
    this.ensureRelianceDefaults();

    const sanitizedItems = this.billItems
      .filter(it => it.productId !== null)
      .map(it => ({
        productId: it.productId,
        productName: it.productName, // includes units if applicable
        quantity: Number(it.quantity || 0),
        price: Number(it.price || 0),
        total: Number(it.total || 0),
        manualTotal: !!it.manualTotal // keep manual total flag
      }));

    const payload: any = {
      clientName: this.clientName,
      address: this.address,
      billNumber: this.billNumber,
      billDate: this.billDate,
      totalAmount: Number(this.totalAmount) || 0,
      billItems: sanitizedItems,
      billType: 'reliance' // always tag as Reliance
    };

    const obs = (this.billsService as any).updateBill
      ? (this.billsService as any).updateBill(this.billNumber, payload)
      : this.billsService.saveBill(payload);

    obs.subscribe({
      next: () => {
        alert('Bill updated successfully!');
      },
      error: (error: HttpErrorResponse) => {
        console.error('Error updating bill:', error);
        alert(`Failed to update bill: ${error.status} ${error.statusText}${error.error?.message ? ' — ' + error.error.message : ''}`);
      }
    });
  }

  autoResize(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  private resizeTextarea(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    el.style.width = 'auto';
    const containerWidth = el.parentElement?.clientWidth || 800;
    const scrollWidth = el.scrollWidth + 2;
    if (scrollWidth < containerWidth) {
      el.style.width = scrollWidth + 'px';
      el.style.height = '60px';
    } else {
      el.style.width = '100%';
      el.style.height = el.scrollHeight + 'px';
    }
  }

  amountInWords(num: number): string {
    const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten',
              'Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen',
              'Eighteen','Nineteen'];
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
  }

  /** Hidden-iframe fallback (only used when not in Electron) */
  private async printHtmlInHiddenIframe(html: string): Promise<void> {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      console.warn('Unable to create print frame.');
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const waitForAssets = async () => {
      const promises: Promise<unknown>[] = [];
      if ((doc as any).fonts?.ready) promises.push((doc as any).fonts.ready);
      Array.from(doc.images || []).forEach(img => {
        if (!img.complete) {
          promises.push(new Promise(res => {
            img.addEventListener('load', res, { once: true });
            img.addEventListener('error', res, { once: true });
          }));
        }
      });
      promises.push(new Promise(res => setTimeout(res, 80)));
      await Promise.all(promises);
    };

    try {
      await waitForAssets();
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } finally {
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }
  }

  /** Convert HTML to a data URL for Electron (UTF‑8, no base64) */
  private htmlToDataUrl(html: string): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }
}