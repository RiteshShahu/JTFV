import { Component, OnInit, ViewChildren, QueryList, ElementRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
}

@Component({
  selector: 'app-bills',
  templateUrl: './bills.component.html',
  styleUrls: ['./bills.component.css']
})
export class BillsComponent implements OnInit {
  @ViewChildren('productSelect') productSelectInputs!: QueryList<ElementRef>;
  @ViewChildren('priceInput') priceInputs!: QueryList<ElementRef>;
  @ViewChildren('addressTextarea') addressTextareas!: QueryList<ElementRef>;

  products: Name[] = [];
  namesMap: { [id: number]: string } = {};
  billItems: BillItem[] = [];
  clients: any[] = [];
  selectedClient: any = null;
  clientName: string = '';
  address: string = '';
  billNumber: string = '';
  billDate: string = new Date().toISOString().substring(0, 10);
  discount: number = 0;
  totalAmount: number = 0;
  finalAmount: number = 0;
  manualEmail: string = '';

  copiesCount = 1;
  private isPrinting = false;
  private isSaving = false;
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
    private toast: ToastService   // ⬅️ toast
  ) {}

  ngOnInit(): void {
    this.titleService.setTitle('Invoice - J.T. Fruits & Vegetables');

    this.productService.getNames().subscribe((names: Name[]) => {
      this.products = names.sort((a, b) => a.name.localeCompare(b.name));
      this.namesMap = Object.fromEntries(this.products.map(n => [n.id, n.name]));

      this.route.paramMap.subscribe(params => {
        const billNumber = params.get('billNumber');
        if (billNumber) this.loadBillForEdit(billNumber);
      });
    });

    this.http.get<any[]>('http://localhost:3001/api/clients').subscribe(data => {
      this.clients = data;
    });

    // start with one empty row
    this.billItems.push({ productId: null, productName: '', quantity: 0, price: 0, total: 0 });

    this.billsService.getLatestBillNumber().subscribe({
      next: (res: { billNumber: string }) => (this.billNumber = res.billNumber),
      error: () => (this.billNumber = '001')
    });
  }

  loadBillForEdit(billNumber: string) {
    this.http.get<any>(`http://localhost:3001/api/bills/${billNumber}`).subscribe({
      next: bill => {
        this.clientName = bill.clientName;
        this.address = bill.address;
        this.billNumber = bill.billNumber;
        this.billDate = bill.billDate;
        this.discount = bill.discount;
        this.totalAmount = bill.totalAmount;
        this.finalAmount = bill.finalAmount;
        this.billItems = bill.billItems || [];

        setTimeout(() => {
          this.addressTextareas.forEach(textarea => {
            this.resizeTextarea(textarea.nativeElement);
          });
        });

        this.billItems.forEach(item => {
          item.productName = item.productId ? this.namesMap[item.productId] || '(Unknown)' : '';
        });

        const match = this.clients.find(c => c.firstName === bill.clientName);
        if (match) this.selectedClient = match;
      },
      error: err => console.error('Failed to load bill for edit:', err)
    });
  }

  onClientChange(): void {
    if (this.selectedClient) {
      const c = this.selectedClient;
      const parts = [c.address1, c.address2, c.subArea, c.area, c.city].filter(Boolean);
      this.clientName = c.firstName;
      this.address = parts.join(', ');

      setTimeout(() => {
        this.addressTextareas.forEach(textarea => {
          const el = textarea.nativeElement;
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
        this.billItems.push({ productId: null, productName: '', quantity: 0, price: 0, total: 0 });

        setTimeout(() => {
          const productSelectArray = this.productSelectInputs.toArray();
          const nextProductSelect = productSelectArray[index + 1];
          if (nextProductSelect) nextProductSelect.nativeElement.focus();
        }, 0);
      } else {
        const productSelectArray = this.productSelectInputs.toArray();
        const nextProductSelect = productSelectArray[index + 1];
        if (nextProductSelect) nextProductSelect.nativeElement.focus();
      }
    }
  }

  onProductChange(index: number): void {
    const selectedId = this.billItems[index].productId;
    const selectedProduct = this.products.find(p => p.id === selectedId);

    if (selectedProduct) {
      const nameWithUnits = selectedProduct.name + (selectedProduct.units ? ' ' + selectedProduct.units : '');
      this.billItems[index].productName = nameWithUnits;
    } else {
      this.billItems[index].productName = '(Unknown)';
    }

    this.calculateRowTotal(index);
  }

  calculateRowTotal(index: number): void {
    const item = this.billItems[index];
    item.total = (item.quantity || 0) * (item.price || 0);
    this.calculateTotalAmount();
  }

  calculateTotalAmount(): void {
    this.totalAmount = this.billItems.reduce((acc, item) => acc + item.total, 0);
    this.calculateFinalAmount();
  }

  calculateFinalAmount(): void {
    const discountAmount = this.totalAmount * (this.discount / 100);
    this.finalAmount = this.totalAmount - discountAmount;
  }

  private buildPrintHtml(
    items: Array<{ productId: number | null; productName: string; quantity: number; price: number; total?: number }>,
    meta: {
      clientName: string;
      address: string;
      billNumber: string;
      billDate: string;
      discount: number;
      totalAmount: number;
      finalAmount: number;
    }
  ): string {
    const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const fmtINR = (n: number) =>
      new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(n);
    const fmt2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '');
    const dateStr = this.formatDateDDMMYYYY(meta.billDate);

    const rows = items
      .map(
        (it, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${esc(it.productName)}</td>
            <td>${esc(String(it.quantity))}</td>
            <td>${fmt2(it.price)}</td>
            <td>${fmt2((it.quantity || 0) * (it.price || 0))}</td>
          </tr>`
      )
      .join('');

    return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>Invoice ${esc(meta.billNumber)}</title>
        <style>
          @page { size: A4; margin: 10mm; }
          body { font-family: 'Poppins','Segoe UI',Tahoma,sans-serif; -webkit-print-color-adjust: exact; }
          .container { max-width: 900px; margin: 0 auto; padding: 20px; font-size: 11px; }
          .header { text-align: center; }
          .header h1 { margin: 0; font-size: 22px; }
          .header p { margin: 2px 0; font-size: 10px; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #ccc; padding: 4px; font-size: 10px; text-align: center; }
          th { background: #eee; }
          .summary { text-align: right; font-weight: bold; margin-top: 8px; font-size: 11px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>J.T. Fruits &amp; Vegetables</h1>
            <p>Shop No. 31-32, Bldg No. 27, EMP Op Jogers Park, Thakur Village, Kandivali(E), Mumbai 400101</p>
            <p>PAN: AAJFJ0258J | License: 11517011000128 | Email: jkumarshahu5@gmail.com</p>
            <p>Date: ${esc(dateStr)} &nbsp;&nbsp; Bill No: ${esc(meta.billNumber)}</p>
          </div>
          <p><b>Name:</b> ${esc(meta.clientName)}<br/><b>Address:</b> ${esc(meta.address)}</p>
          <table>
            <thead>
              <tr><th>No</th><th>Product</th><th>Qty</th><th>Price</th><th>Total</th></tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="summary">Total Amount: ${fmtINR(meta.totalAmount)}</div>
          <div class="summary">Margin (%): ${esc(String(meta.discount))}</div>
          <div class="summary">Final Amount: ${fmtINR(meta.finalAmount)}</div>
        </div>
      </body>
    </html>`;
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

    await new Promise(res => setTimeout(res, 100));
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  }

  async printBill(): Promise<void> {
    if (this.isPrinting) return;

    this.isPrinting = true;

    try {
      const validItems = this.billItems
        .filter(i => i.productId !== null && i.quantity > 0 && i.price > 0)
        .map(i => ({
          ...i,
          productName:
            i.productName ||
            (() => {
              const prod = this.products.find(p => p.id === i.productId);
              return prod ? prod.name + (prod.units ? ' ' + prod.units : '') : '(Unknown)';
            })()
        }));

      if (validItems.length === 0) {
        this.toast.warn('No valid items to print.');
        return;
      }

      const totalAmount = validItems.reduce((acc, it) => acc + (it.quantity || 0) * (it.price || 0), 0);
      const discountAmount = totalAmount * (this.discount / 100);
      const finalAmount = totalAmount - discountAmount;

      const copies = Math.max(1, Math.min(50, Math.floor(Number(this.copiesCount) || 1)));

      const html = this.buildPrintHtmlMulti(validItems, {
        clientName: this.clientName,
        address: this.address,
        billNumber: this.billNumber,
        billDate: this.billDate,
        discount: this.discount,
        totalAmount,
        finalAmount
      }, copies);

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
    } catch (err: any) {
      console.error('Print failed:', err);
      this.toast.error('Unexpected print error.');
    } finally {
      this.isPrinting = false;

      setTimeout(() => {
        try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch {}
        try { window.focus(); } catch {}
      }, 40);

      try { (window as any).electron?.refocusHard?.(); } catch {}
    }
  }

  private buildPrintHtmlMulti(
    items: Array<{ productId: number | null; productName: string; quantity: number; price: number; total?: number }>,
    meta: {
      clientName: string;
      address: string;
      billNumber: string;
      billDate: string;
      discount: number;
      totalAmount: number;
      finalAmount: number;
    },
    copies: number
  ): string {
    // Build the single HTML that already includes the full CSS.
    const single = this.buildPrintHtml(items, meta);

    // Extract the original <head> and <body> content so we can repeat the body.
    const headMatch = single.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    const bodyMatch = single.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const head = headMatch ? headMatch[1] : '';
    const body = bodyMatch ? bodyMatch[1] : single; // fallback

    // Repeat the same styled body N times, adding only page-break helpers.
    const pages = Array.from({ length: Math.max(1, copies) },
      () => `<div class="page">${body}</div>`).join('\n');

    return `
      <!doctype html>
      <html>
        <head>
          ${head}
          <style>
            .page { page-break-after: always; }
            .page:last-child { page-break-after: auto; }
          </style>
        </head>
        <body>${pages}</body>
      </html>`;
  }
    
  private formatDateDDMMYYYY(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || '';
    return d.toLocaleDateString('en-GB');
  }

  highlightInvalidRows(): void {
    this.billItems.forEach((item, index) => {
      if (!item.productId || item.quantity <= 0 || item.price <= 0) {
        console.warn(`Row ${index + 1} is incomplete.`);
      }
    });
  }

  emailBill(): void {
    const validItems = this.billItems.filter(
      item => item.productId !== null && item.productName && item.quantity > 0 && item.price > 0
    );
    if (validItems.length === 0) {
      this.toast.warn('No valid items to email.');
      return;
    }
    if (!this.manualEmail || !this.manualEmail.includes('@')) {
      this.toast.warn('Please enter a valid email address');
      return;
    }

    const totalAmount = validItems.reduce((acc, it) => acc + (it.quantity || 0) * (it.price || 0), 0);
    const discountAmount = totalAmount * (this.discount / 100);
    const finalAmount = totalAmount - discountAmount;

    const pdfHtml = this.buildPrintHtml(validItems, {
      clientName: this.clientName,
      address: this.address,
      billNumber: this.billNumber,
      billDate: this.billDate,
      discount: this.discount,
      totalAmount,
      finalAmount
    });

    const billData = {
      clientName: this.clientName,
      address: this.address,
      billNumber: this.billNumber,
      billDate: this.billDate,
      discount: this.discount,
      totalAmount: this.totalAmount,
      finalAmount: this.finalAmount,
      billItems: validItems,
      email: this.manualEmail,
      pdfHtml
    };

    this.billsService.sendBillByEmail(billData).subscribe({
      next: () => this.toast.success('Email sent!'),
      error: (err) => {
        console.error('Email failed:', err);
        this.toast.error('Failed to send email. Please try again.');
      }
    });
  }

  saveBill(): void {
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();

    if (this.isSaving) return;
    this.isSaving = true;

    const targetNo = this.normalizeBillNumber(this.billNumber);

    const payload = {
      clientName: this.clientName,
      address: this.address,
      billNumber: targetNo,
      billDate: this.billDate,
      discount: this.discount,
      totalAmount: this.totalAmount,
      finalAmount: this.finalAmount,
      billItems: this.billItems
    };

    this.billsService.billExists(targetNo).subscribe({
      next: (exists) => {
        if (exists) {
          this.toast.warn(`Bill ${targetNo} is already saved.`);
          this.isSaving = false;
          return;
        }
        this.billsService.saveBill(payload).subscribe({
          next: () => {
            this.toast.success('Bill saved successfully!');
            this.isSaving = false;
          },
          error: (error) => {
            this.toast.error('Failed to save bill. Please try again.');
            console.error('Error saving bill:', error);
            this.isSaving = false;
          }
        });
      },
      error: () => {
        this.toast.error('Could not verify Bill No. Please try again.');
        this.isSaving = false;
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

  private htmlToDataUrl(html: string): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }
}