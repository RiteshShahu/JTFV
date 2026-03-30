import { Component, OnInit, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { ProductService, Name } from 'src/app/core/services/products.service';
import { BillsService } from 'src/app/core/services/bills.service';
import { ToastService } from 'src/app/core/services/toast.service';

interface BillItem {
  productId: number | null;
  productName: string;
  quantity: number;
  price: number;
  total: number;
  manualTotal?: boolean;
  searchText?: string;
  filteredProducts?: NameWithPrice[];
}

type NameWithPrice = Name & { mrp?: number; price?: number; units?: string; name: string; id: number };

@Component({
  selector: 'app-edit-reliance-bills',
  templateUrl: './edit-reliance-bills.component.html',
  styleUrls: ['./edit-reliance-bills.component.css']
})
export class EditRelianceBillsComponent implements OnInit {
  @ViewChildren('productSearchInput') productSearchInputs!: QueryList<ElementRef>;
  @ViewChildren('priceInput') priceInputs!: QueryList<ElementRef>;
  @ViewChildren('addressTextarea') addressTextareas!: QueryList<ElementRef>;

  products: NameWithPrice[] = [];
  namesMap: { [id: number]: string } = {};
  namesWithUnitsMap: { [id: number]: string } = {};
  priceMap: { [id: number]: number } = {};

  billItems: BillItem[] = [];
  clients: any[] = [];
  selectedClient: any = null;

  clientName = '';
  address = '';

  shipToName = 'FRESHPIK SPECTRA POWAI ( T5EP )';
  shipToAddress = 'Spectra, 1st, Central Ave, Hiranandani Gardens, Powai, Mumbai, Maharashtra 400076';

  private readonly NET_FACTOR = 0.85;

  private readonly RELIANCE_CLIENT = 'Reliance Retail Limited';
  private readonly RELIANCE_ADDR =
    'Reliance Corporate Park, Thane-Belapur Road, Ghansoli-400701, Navi Mumbai, Maharashtra';

  billNumber = '';
  billDate: string = new Date().toISOString().substring(0, 10);

  totalAmount = 0;
  manualEmail = '';
  totalQuantity = 0;
  totalItemPrice = 0;
  receivedAmount: number = 0;
  balanceAmount: number = 0;

  copiesCount = 1;
  private isPrinting = false;
  private isSaving = false;
  private originalBillNumber = '';
  private normalizeBillNumber = (s: string) => {
    const n = parseInt(String(s || '').trim(), 10);
    return Number.isNaN(n) ? String(s || '').trim() : String(n).padStart(3, '0');
  };

  constructor(
    private titleService: Title,
    private productService: ProductService,
    private billsService: BillsService,
    private route: ActivatedRoute,
    private http: HttpClient,
    private toast: ToastService
  ) { }

  ngOnInit(): void {
    this.titleService.setTitle('Edit Invoice - J.T. Fruits & Vegetables');

    this.productService.getNames().subscribe((names: NameWithPrice[]) => {
      this.products = names.sort((a, b) =>
        `${a.name}${a.units ? ' ' + a.units : ''}`.localeCompare(`${b.name}${b.units ? ' ' + b.units : ''}`)
      );

      this.namesMap = Object.fromEntries(this.products.map(n => [n.id, n.name]));
      this.namesWithUnitsMap = Object.fromEntries(
        this.products.map(n => [n.id, n.name + (n.units ? ' ' + n.units : '')])
      );
      this.priceMap = Object.fromEntries(this.products.map(n => [n.id, Number(n.mrp ?? n.price ?? 0)]));

      const billNumber = this.route.snapshot.paramMap.get('billNumber');
      if (billNumber) {
        this.billNumber = billNumber;
        this.loadBillForEdit(billNumber);
      } else {
        this.billItems.push(this.createEmptyBillItem());
      }
    });

    this.http.get<any[]>('http://localhost:3001/api/clients').subscribe({
      next: (data) => (this.clients = data),
      error: () => { }
    });
  }

  private createEmptyBillItem(): BillItem {
    return {
      productId: null,
      productName: '',
      quantity: 0,
      price: 0,
      total: 0,
      manualTotal: false,
      searchText: '',
      filteredProducts: [...this.products]
    };
  }

  displayProductOption(product: NameWithPrice): string {
    return `${product.name}${product.units ? ' ' + product.units : ''}`.trim();
  }

  private normalizeText(value: string): string {
    return (value || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeCompact(value: string): string {
    return this.normalizeText(value).replace(/\s+/g, '');
  }

  filterProducts(index: number): void {
    const item = this.billItems[index];
    const rawSearch = item.searchText || '';
    const search = this.normalizeText(rawSearch);
    const compactSearch = this.normalizeCompact(rawSearch);

    if (!search) {
      item.filteredProducts = [...this.products];
      return;
    }

    const searchWords = search.split(' ').filter(Boolean);

    item.filteredProducts = this.products.filter((product) => {
      const fullText = this.normalizeText(`${product.name} ${product.units || ''}`);
      const compactText = this.normalizeCompact(`${product.name} ${product.units || ''}`);

      const allWordsMatch = searchWords.every(word =>
        fullText.includes(word) || compactText.includes(word)
      );

      return allWordsMatch || compactText.includes(compactSearch);
    });
  }

  onProductOptionSelected(index: number, selected: NameWithPrice, event: any): void {
    if (!event?.isUserInput || !selected) return;
    this.applySelectedProduct(index, selected);
  }

  tryAutoSelectClosest(index: number): void {
    const item = this.billItems[index];
    const rawSearch = item.searchText || '';
    const search = this.normalizeText(rawSearch);
    const compactSearch = this.normalizeCompact(rawSearch);

    if (!search) return;

    const exact = this.products.find(product =>
      this.normalizeText(`${product.name} ${product.units || ''}`) === search
    );

    if (exact) {
      this.applySelectedProduct(index, exact);
      return;
    }

    const tokens = search.split(' ').filter(Boolean);

    const closest = this.products.find(product => {
      const fullText = this.normalizeText(`${product.name} ${product.units || ''}`);
      const compactText = this.normalizeCompact(`${product.name} ${product.units || ''}`);

      return tokens.every(token =>
        fullText.includes(token) || compactText.includes(token)
      ) || compactText.includes(compactSearch);
    });

    if (closest) {
      this.applySelectedProduct(index, closest);
    }
  }

  private applySelectedProduct(index: number, selectedProduct: NameWithPrice): void {
    const item = this.billItems[index];
    item.productId = selectedProduct.id;
    item.productName = this.displayProductOption(selectedProduct);
    item.searchText = this.displayProductOption(selectedProduct);

    const dbPrice =
      this.priceMap[selectedProduct.id] ??
      Number(selectedProduct.mrp ?? selectedProduct.price ?? 0);

    item.price = Number(dbPrice || 0);
    item.filteredProducts = [...this.products];
    this.calculateRowTotal(index);
  }

  private ensureRelianceDefaults(): void {
    if (!this.clientName?.trim()) this.clientName = this.RELIANCE_CLIENT;
    if (!this.address?.trim()) this.address = this.RELIANCE_ADDR;
  }

  loadBillForEdit(billNumber: string): void {
    this.http.get<any>(`http://localhost:3001/api/bills/${billNumber}`).subscribe({
      next: bill => {
        this.clientName = bill.clientName || this.clientName;
        this.address = bill.address || this.address;
        this.billNumber = bill.billNumber || billNumber;
        this.originalBillNumber = this.normalizeBillNumber(this.billNumber);
        this.billDate = bill.billDate || this.billDate;
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
          const total = Number(it.total ?? qty * price * this.NET_FACTOR);
          const name = pid ? (this.namesWithUnitsMap[pid] || it.productName || '(Unknown)') : '';

          return {
            productId: pid,
            productName: name,
            quantity: qty,
            price,
            total,
            manualTotal: !!it.manualTotal,
            searchText: name,
            filteredProducts: [...this.products]
          } as BillItem;
        });

        if (this.billItems.length < 10) {
          const pad = 10 - this.billItems.length;
          for (let i = 0; i < pad; i++) {
            this.billItems.push(this.createEmptyBillItem());
          }
        }

        this.calculateTotalAmount();

        setTimeout(() => {
          this.addressTextareas?.forEach(t => this.resizeTextarea(t.nativeElement));
        });
      },
      error: err => {
        console.error('Could not load the bill.', err);
        this.toast.error('Could not load the bill.');
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
        this.billItems.push(this.createEmptyBillItem());
        setTimeout(() => {
          const productInputArray = this.productSearchInputs.toArray();
          productInputArray[index + 1]?.nativeElement?.focus();
        }, 0);
      } else {
        const productInputArray = this.productSearchInputs.toArray();
        productInputArray[index + 1]?.nativeElement?.focus();
      }
    }
  }

  onProductChange(index: number): void {
    const item = this.billItems[index];
    const selectedId = item.productId ?? undefined;
    const selectedProduct = this.products.find(p => p.id === selectedId);

    if (selectedProduct) {
      item.productName = this.displayProductOption(selectedProduct);
      item.searchText = this.displayProductOption(selectedProduct);

      const dbPrice =
        this.priceMap[selectedId as number] ??
        Number((selectedProduct as any).mrp ?? (selectedProduct as any).price ?? 0);

      item.price = Number(dbPrice || 0);
    } else {
      item.productName = '(Unknown)';
      item.searchText = '';
      item.price = 0;
    }

    this.calculateRowTotal(index);
  }

  calculateRowTotal(index: number): void {
    const it = this.billItems[index];
    const qty = Number(it.quantity || 0);
    const price = Number(it.price || 0);

    if (!it.manualTotal) {
      it.total = +((qty * price) * this.NET_FACTOR).toFixed(2);
    } else {
      if (qty > 0 && isFinite(qty)) {
        it.price = +((Number(it.total || 0) / (qty * this.NET_FACTOR))).toFixed(2);
      }
    }

    this.calculateTotalAmount();
  }

  onSalesAmountInput(index: number): void {
    const it = this.billItems[index];
    it.manualTotal = true;

    const qty = Number(it.quantity || 0);
    const netTotal = Number(it.total || 0);

    if (qty > 0 && isFinite(qty)) {
      it.price = +((netTotal / (qty * this.NET_FACTOR))).toFixed(2);
    }

    this.calculateTotalAmount();
  }

  calculateTotalAmount(): void {
    const items = this.billItems.filter(it => it.productId !== null);

    items.forEach(it => {
      const qty = Number(it.quantity || 0);
      const price = Number(it.price || 0);

      if (!it.manualTotal) {
        it.total = +((qty * price) * this.NET_FACTOR).toFixed(2);
      } else if (qty > 0 && isFinite(qty)) {
        it.price = +((Number(it.total || 0) / (qty * this.NET_FACTOR))).toFixed(2);
      }
    });

    this.totalQuantity = items.reduce((acc, it) => acc + (Number(it.quantity) || 0), 0);
    this.totalItemPrice = +items.reduce((acc, it) => acc + (it.price || 0), 0).toFixed(2);
    this.totalAmount = +items.reduce((acc, it) => acc + (it.total || 0), 0).toFixed(2);

    this.balanceAmount = +(this.totalAmount - (this.receivedAmount || 0)).toFixed(2);
  }

  private fmt(n: number): string {
    return (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private displayName(it: BillItem): string {
    const prod = this.products.find(p => p.id === it.productId);
    if (prod) {
      return prod.name + (prod.units ? ' ' + prod.units : '');
    }
    return it.productName || '';
  }

  private getInvoiceStyles(): string {
    return `
      <style>
        @page { size: A4; margin: 10mm; }
        @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
        body { font-family: 'Poppins','Segoe UI',Tahoma,sans-serif; color:#2c3e50; padding:40px; background:#fff; }
        h1 { margin:0; font-size:25px; font-weight:bold; color:#333; }
        p { margin:5px 0; font-size:12px; color:#546e7a; }

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

        .page { page-break-after: always; }
        .page:last-child { page-break-after: auto; }
      </style>
    `;
  }

  private buildInvoiceBody(validItems: BillItem[]): string {
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

    return `
      <div class="header" style="text-align:right;">
        <h1>J.T. Fruits &amp; Vegetables</h1>
        <p>Shop No. 31-32, Bldg No. 27, EMP Op Jogers Park, Thakur Village, Kandivali(E), Mumbai, Maharashtra 400101</p>
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
    `;
  }

  private buildPrintHtml(validItems: BillItem[]): string {
    const styles = this.getInvoiceStyles();
    const body = this.buildInvoiceBody(validItems);
    return `<!doctype html><html><head><meta charset="utf-8">${styles}</head><body>${body}</body></html>`;
  }

  private buildPrintHtmlMulti(validItems: BillItem[], copies: number): string {
    const styles = this.getInvoiceStyles();
    const body = this.buildInvoiceBody(validItems);
    const pages = Array.from({ length: Math.max(1, copies) }, () => `<div class="page">${body}</div>`).join('\n');

    return `
      <!doctype html>
      <html>
        <head><meta charset="utf-8">${styles}<title>Invoice ${this.billNumber}</title></head>
        <body>${pages}</body>
      </html>`;
  }

  async printBill(): Promise<void> {
    if (this.isPrinting) return;

    try {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();
    } catch { }

    this.isPrinting = true;

    try {
      this.ensureRelianceDefaults();

      const validItems = this.billItems
        .filter(it => it.productId !== null)
        .map(it => {
          const prod = this.products.find(p => p.id === it.productId);
          if (prod) it.productName = prod.name + (prod.units ? ' ' + prod.units : '');

          const qty = Number(it.quantity || 0);
          if (it.manualTotal) {
            if (qty > 0 && isFinite(qty)) {
              it.price = +((Number(it.total || 0) / (qty * this.NET_FACTOR))).toFixed(2);
            }
          } else {
            it.total = +((qty * Number(it.price || 0)) * this.NET_FACTOR).toFixed(2);
          }
          return it;
        });

      if (!validItems.length) {
        this.toast.warn('No valid items to print.');
        return;
      }

      this.totalQuantity = validItems.reduce((a, it) => a + (it.quantity || 0), 0);
      this.totalAmount = +validItems.reduce((a, it) => a + (it.total || 0), 0).toFixed(2);
      this.balanceAmount = +(this.totalAmount - (this.receivedAmount || 0)).toFixed(2);

      const copies = Math.max(1, Math.min(50, Math.floor(Number(this.copiesCount) || 1)));
      const html = typeof (this as any).buildPrintHtmlMulti === 'function'
        ? this.buildPrintHtmlMulti(validItems, copies)
        : this.buildPrintHtml(validItems);

      const dataUrl = this.htmlToDataUrl(html);
      const el = (window as any).electron;

      if (el?.printCanonA4) {
        const res = await el.printCanonA4(dataUrl, { landscape: false, copies });
        if (!res?.ok) {
          console.error('Print failed:', res?.error);
          this.toast.error('Print failed. Check printer and try again.');
        } else {
          this.toast.success('Sent to printer.');
        }
      } else {
        await this.printHtmlInHiddenIframe(html);
        this.toast.info('Opening system print dialog…');
      }
    } catch (err) {
      console.error('Print failed:', err);
      this.toast.error('Unexpected print error.');
    } finally {
      this.isPrinting = false;

      setTimeout(() => {
        try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
        try { window.focus(); } catch { }
      }, 40);

      try { await (window as any).electron?.refocusHard?.(); } catch { }
    }
  }

  private parseEmails(raw: string): string[] {
    if (!raw) return [];
    return raw
      .split(/[,\s]+/)
      .map(e => e.trim())
      .filter(Boolean);
  }

  private isValidEmail(e: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
  }

  emailBill(): void {
    this.ensureRelianceDefaults();

    const validItems = this.billItems.filter(
      it => it.productId !== null &&
        (it.productName || this.namesWithUnitsMap[it.productId!]) &&
        it.quantity > 0
    );
    if (!validItems.length) {
      this.toast.warn('No valid items to email. Please add at least one valid item.');
      return;
    }

    const recipients = this.parseEmails(this.manualEmail);
    if (!recipients.length) {
      this.toast.warn('Please enter at least one email address.');
      return;
    }

    const invalid = recipients.filter(e => !this.isValidEmail(e));
    if (invalid.length) {
      this.toast.warn(`Invalid email${invalid.length > 1 ? 's' : ''}: ${invalid.join(', ')}`);
      return;
    }
    const to = Array.from(new Set(recipients));

    const normalized = validItems.map(it => {
      const qty = Number(it.quantity || 0);
      if (it.manualTotal) {
        if (qty > 0 && isFinite(qty)) {
          it.price = +((Number(it.total || 0) / (qty * this.NET_FACTOR))).toFixed(2);
        }
      } else {
        it.total = +((qty * Number(it.price || 0)) * this.NET_FACTOR).toFixed(2);
      }
      const prod = this.products.find(p => p.id === it.productId);
      it.productName = prod ? prod.name + (prod.units ? ' ' + prod.units : '') : (it.productName || '');
      return it;
    });

    this.totalQuantity = normalized.reduce((a, it) => a + (it.quantity || 0), 0);
    this.totalAmount = +normalized.reduce((a, it) => a + (it.total || 0), 0).toFixed(2);

    const pdfHtml = this.buildPrintHtml(normalized);

    const billData = {
      clientName: this.clientName,
      address: this.address,
      billNumber: this.billNumber,
      billDate: this.billDate,
      totalAmount: this.totalAmount,
      billItems: normalized,
      to,
      billType: 'reliance',
      pdfHtml
    };

    this.billsService.sendBillByEmail(billData).subscribe({
      next: () => this.toast.success('Email sent successfully'),
      error: (err) => {
        console.error('Email failed:', err);

        let message =
          err?.error?.details ||
          err?.error?.message ||
          err?.message ||
          'Failed to send email';

        if (message.includes('Chrome') || message.includes('Edge')) {
          message = 'PDF engine not found. Please install Google Chrome or Microsoft Edge.';
        }
        this.toast.error(message);
      }
    });
  }

  saveBill(): void {
    this.ensureRelianceDefaults();

    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();

    if (this.isSaving) return;
    this.isSaving = true;

    const targetNo = this.normalizeBillNumber(this.billNumber);

    const sanitizedItems = this.billItems
      .filter(it => it.productId !== null)
      .map(it => ({
        productId: it.productId,
        productName: it.productName,
        quantity: Number(it.quantity || 0),
        price: Number(it.price || 0),
        total: Number(it.total || 0),
        manualTotal: !!it.manualTotal
      }));

    const payload: any = {
      clientName: this.clientName,
      address: this.address,
      billNumber: targetNo,
      billDate: this.billDate,
      totalAmount: Number(this.totalAmount) || 0,
      billItems: sanitizedItems,
      billType: 'reliance'
    };

    const doUpdate = () => {
      (this.billsService as any).updateBill?.(this.originalBillNumber, payload).subscribe({
        next: () => {
          this.toast.success('Bill updated successfully!');
          this.originalBillNumber = targetNo;
          this.isSaving = false;
        },
        error: (error: HttpErrorResponse) => {
          console.error('Error updating bill:', error);
          this.toast.error('Failed to update bill.');
          this.isSaving = false;
        }
      });
    };

    if (targetNo !== this.originalBillNumber) {
      this.billsService.billExists(targetNo).subscribe({
        next: exists => {
          if (exists) {
            this.toast.warn(`Bill ${targetNo} already exists.`);
            this.isSaving = false;
          } else {
            doUpdate();
          }
        },
        error: () => {
          this.toast.error('Could not verify Bill No. Please try again.');
          this.isSaving = false;
        }
      });
    } else {
      doUpdate();
    }
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
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
      'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
      'Eighteen', 'Nineteen'];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

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
      this.toast.error('Unable to create print frame.');
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

  private static readonly NET_FACTOR = 0.85;
  private static readonly RELIANCE_CLIENT = 'Reliance Retail Limited';
  private static readonly RELIANCE_ADDR =
    'Reliance Corporate Park, Thane-Belapur Road, Ghansoli-400701, Navi Mumbai, Maharashtra';

  private static inr(n: number): string {
    return (n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  private static amountInWords(num: number): string {
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
      'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
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

  private static styles(): string {
    return `<style>
      @page { size: A4; margin: 10mm; }
      @media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }
      body { font-family: 'Poppins','Segoe UI',Tahoma,sans-serif; color:#2c3e50; padding:40px; background:#fff; }
      h1 { margin:0; font-size:25px; font-weight:bold; color:#333; }
      p { margin:5px 0; font-size:13px; color:#546e7a; }
      .invoice-title { text-align:center; font-size:22px; font-weight:bold; margin:12px 0; color:#2c3e50; }
      .tax-parties { display:grid; grid-template-columns:1fr 1fr 1fr; gap:24px;
        padding:10px 0 0; border-top:3px solid #c9c9c9; border-bottom:1px solid #c9c9c9;
        margin-bottom:12px; font-size:11px; }
      .party-title { text-transform:uppercase; font-weight:700; margin-bottom:6px; }
      .party-name { font-weight:600; margin-bottom:4px; }
      .party-address { line-height:1.45; }
      table { width:100%; border-collapse:collapse; font-size:12px; margin:16px 0; background:#fff; }
      th, td { border:1px solid #bdbdbd; padding:8px 10px; text-align:center; }
      th { background:#757575 !important; color:#fff !important; font-weight:700; }
      .total-row { background:#f4f6f8 !important; font-weight:700; }
      .boxes { display:grid; grid-template-columns:2fr 1fr; gap:10px; margin-top:10px; }
      .box { border:1px solid #bdbdbd; }
      .box-title { background:#757575; color:#fff; font-weight:700; padding:6px 8px; font-size:12px; }
      .box-body { padding:6px 8px; font-size:12px; }
      .page { page-break-after: always; } .page:last-child { page-break-after: auto; }
    </style>`;
  }

  static buildRelianceHtml(payload: {
    billNumber: string; billDate: string;
    clientName?: string; address?: string;
    billItems: Array<{ productId: number | null; productName: string; quantity: number; price: number; total: number; manualTotal?: boolean }>;
    totalAmount?: number; copies?: number; shipToName?: string; shipToAddress?: string;
  }): string {
    const copies = Math.max(1, Math.min(50, Math.floor(payload.copies ?? 1)));
    const shipToName = payload.shipToName ?? 'FRESHPIK SPECTRA POWAI ( T5EP )';
    const shipToAddress = payload.shipToAddress ?? 'Spectra, 1st, Central Ave, Hiranandani Gardens, Powai, Mumbai, Maharashtra 400076';

    const items = (payload.billItems || []).map(it => {
      const qty = Number(it.quantity || 0);
      if (!it.manualTotal) {
        it.total = +((qty * Number(it.price || 0)) * EditRelianceBillsComponent.NET_FACTOR).toFixed(2);
      } else if (qty > 0 && isFinite(qty)) {
        it.price = +((Number(it.total || 0) / (qty * EditRelianceBillsComponent.NET_FACTOR))).toFixed(2);
      }
      return it;
    });

    const totalQty = items.reduce((a, it) => a + (Number(it.quantity) || 0), 0);
    const totalPrice = +items.reduce((a, it) => a + (it.price || 0), 0).toFixed(2);
    const totalAmount = +(payload.totalAmount ?? +items.reduce((a, it) => a + (it.total || 0), 0).toFixed(2));

    const rows = items.map((it, i) => `
      <tr><td>${i + 1}</td><td>${it.productName}</td><td>${it.quantity}</td>
      <td>₹ ${this.inr(it.price)}</td><td>₹ ${this.inr(it.total)}</td></tr>`).join('');

    const body = `
      <div class="header" style="text-align:right;">
        <h1>J.T. Fruits &amp; Vegetables</h1>
        <p>Shop No. 31-32, Bldg No. 27, EMP Op Jogers Park, Thakur Village, Kandivali(E), Mumbai 400101</p>
        <p>PAN: AAJFJ0258J | FSS LICENSE ACT 2006 LICENSE NO: 11517011000128</p>
        <p>Email: jkumarshahu5@gmail.com</p>
      </div>
      <div class="invoice-title">Tax Invoice</div>
      <div class="tax-parties">
        <div><div class="party-title">Bill To</div>
          <div class="party-name">${payload.clientName || this.RELIANCE_CLIENT}</div>
          <div class="party-address">${payload.address || this.RELIANCE_ADDR}</div>
        </div>
        <div><div class="party-title">Ship To</div>
          <div class="party-name">${shipToName}</div>
          <div class="party-address">${shipToAddress}</div>
        </div>
        <div><div class="party-title">Invoice Details</div>
          <div>Invoice No.: ${payload.billNumber}</div>
          <div>Date: ${new Date(payload.billDate).toLocaleDateString('en-GB')}</div>
        </div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>
        <tbody>${rows}
          <tr class="total-row"><td colspan="2">Total</td><td>${totalQty}</td>
            <td>₹ ${this.inr(totalPrice)}</td><td>₹ ${this.inr(totalAmount)}</td></tr>
        </tbody>
      </table>
      <div class="boxes">
        <div class="box">
          <div class="box-title">Invoice Amount In Words</div>
          <div class="box-body">${this.amountInWords(totalAmount)}</div>
        </div>
      </div>`;
    const pages = Array.from({ length: copies }).map(() => `<div class="page">${body}</div>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8">${this.styles()}<title>${payload.billNumber}</title></head><body>${pages}</body></html>`;
  }

  private htmlToDataUrl(html: string): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }
}