import { Component, OnInit, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { BillsService } from 'src/app/core/services/bills.service';

@Component({
  selector: 'app-add-lumpsum-bills',
  templateUrl: './add-lumpsum-bills.component.html',
  styleUrls: ['./add-lumpsum-bills.component.css']
})
export class AddLumpsumBillsComponent implements OnInit, AfterViewInit {
  @ViewChild('addressBox') addressBox!: ElementRef<HTMLTextAreaElement>;

  clients: any[] = [];
  selectedClient: any = null;
  clientName: string = '';
  address: string = '';
  description: string = '';
  amount: number = 0;
  discount: number = 0;
  finalAmount: number = 0;
  marginValue: number = 0;
  billNumber: string = '';
  billDate: string = new Date().toISOString().substring(0, 10);
  manualEmail: string = '';

  copiesCount = 1;              // NEW: default to 1
  private isPrinting = false;

  constructor(
    private http: HttpClient,
    private billsService: BillsService,
    private titleService: Title
  ) {}

  ngOnInit(): void {
    this.titleService.setTitle('Add Lumpsum Bill');

    this.http.get<any[]>('http://localhost:3001/api/clients').subscribe(data => {
      this.clients = data;
    });

    this.billsService.getLatestBillNumber().subscribe({
      next: (res: { billNumber: string }) => (this.billNumber = res.billNumber),
      error: () => (this.billNumber = '001')
    });

    this.calculateFinalAmount();
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      if (this.addressBox && this.addressBox.nativeElement) {
        const textArea = this.addressBox.nativeElement;
        textArea.style.height = 'auto';
        textArea.style.height = textArea.scrollHeight + 'px';
      }
    });
  }

  onClientChange(): void {
    if (this.selectedClient) {
      const c = this.selectedClient;
      this.clientName = c.firstName;
      this.address = [c.address1, c.address2, c.area, c.city].filter(Boolean).join(', ');

      // Trigger auto-resize even for short addresses like "MUMBAI"
      setTimeout(() => {
        const textArea = document.querySelector('.address-area') as HTMLTextAreaElement;
        if (textArea) {
          textArea.style.height = 'auto';
          textArea.style.height = textArea.scrollHeight + 'px';
        }
      });
    }
  }

  calculateFinalAmount() {
    if (!this.amount) {
      this.finalAmount = 0;
      this.marginValue = 0;
      return;
    }
    this.marginValue = (this.amount * this.discount) / 100;
    this.finalAmount = this.amount - this.marginValue;
  }

  saveBill(): void {
    const active = document.activeElement as HTMLElement;
    if (active && active.tagName === 'TEXTAREA') active.blur();

    const billData = {
      clientName: this.clientName,
      address: this.address,
      billNumber: this.billNumber,
      billDate: this.billDate,
      discount: this.discount,            // percent (e.g., 15)
      discountAmount: this.marginValue,   // numeric value (e.g., 185.10)
      totalAmount: this.amount,
      finalAmount: this.finalAmount,
      description: this.description,
      billItems: [],
      billType: 'lumpsum'
    };

    this.billsService.saveBill(billData).subscribe({
      next: () => {
        alert('Bill saved successfully!');
      },
      error: () => alert('Failed to save bill. Please try again.')
    });
  }

  // --- PRINT: supports multiple copies now ---
  async printBill(): Promise<void> {
    if (this.isPrinting) return;

    const confirmed = confirm("Are you sure you want to print this bill?");
    if (!confirmed) return;

    this.isPrinting = true;
    try {
      // ensure blur so ngModel flushes
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();

      // quick validation
      if (!this.clientName && !this.address && !this.description && !this.amount) {
        alert('Nothing to print. Please fill bill details.');
        return;
      }

      // clamp copies (1..50)
      const copies = Math.max(1, Math.min(50, Math.floor(Number(this.copiesCount) || 1)));

      this.calculateFinalAmount();

      // Build **multi-copy** HTML (one print job with N pages)
      const html = this.buildPrintHtml({
        clientName: this.clientName || '',
        address: this.address || '',
        billNumber: this.billNumber || '',
        billDate: this.billDate || '',
        description: this.description || '',
        amount: this.amount || 0,
        discount: this.discount || 0,
        finalAmount: this.finalAmount
      }, copies);

      const dataUrl = this.htmlToDataUrl(html);
      const el = (window as any).electron;

      // Prefer Electron IPC (if your main process supports a copies option, we pass it too)
      if (el?.printCanonA4) {
        const res = await el.printCanonA4(dataUrl, { landscape: false, copies });
        if (!res?.ok) {
          console.error('Print failed:', res?.error);
          alert('Print failed: ' + (res?.error || 'Unknown error'));
        }
      } else {
        // Browser fallback: the HTML already contains N pages
        await this.printHtmlInHiddenIframe(html);
      }
    } catch (err) {
      console.error('Print failed:', err);
      alert('Print failed. Please check the printer connection.');
    } finally {
      this.isPrinting = false;
    }
  }

  /**
   * Build printable HTML. When copies > 1, we repeat the invoice block with a page break
   * so the printer outputs N identical pages in a single job.
   */
  private buildPrintHtml(meta: {
    clientName: string;
    address: string;
    billNumber: string;
    billDate: string;
    description: string;
    amount: number;
    discount: number;
    finalAmount: number;
  }, copies: number = 1): string {
    const esc = (s: string) =>
      (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const fmt = (n: number) =>
      new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(isFinite(n as number) ? Number(n) : 0);

    const dateStr = this.formatDateDDMMYYYY(meta.billDate);
    const totalAmount = Number(meta.amount) || 0;
    const discountPct = Number(meta.discount) || 0;
    const discountValue = (totalAmount * discountPct) / 100;
    const grandTotal = (isFinite(meta.finalAmount) ? Number(meta.finalAmount) : totalAmount - discountValue);

    const styles = `
      <style>
        @page { size: A4; margin: 10mm; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; }
        .page {
          max-width: 950px;
          margin: 0 auto;
          padding: 40px;
          font-family: 'Poppins','Segoe UI',Tahoma,sans-serif;
          background: #ffffff;
          color: #2c3e50;
          page-break-after: always;
        }
        .page:last-child { page-break-after: auto; }

        .top-section { text-align: center; margin-bottom: 12px; }
        .title { font-size: 28px; font-weight: bold; color: #333; margin-bottom: 6px; }
        .address-line,.license-line,.email-line { font-size: 13px; color: #546e7a; margin: 2px 0; }
        .invoice-title { text-align: center; font-size: 18px; font-weight: 700; letter-spacing: .3px; margin: 14px 0 10px; }

        .info-grid {
          display: grid;
          grid-template-columns: 1.2fr 0.8fr;
          align-items: start;
          gap: 16px 24px;
          margin-bottom: 16px;
          font-size: 14px;
        }
        .left-info .line { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px; }
        .left-info label { font-weight: 700; white-space: nowrap; }

        .right-meta .meta { display: flex; justify-content: flex-end; align-items: center; gap: 8px; margin-bottom: 6px; }
        .right-meta label { font-weight: 700; white-space: nowrap; min-width: 80px; text-align: right; }

        .description-container { text-align: center; margin: 16px 0 22px; }
        .description-print {
          display: inline-block; margin: 0 auto; padding: 8px 14px; border: 1px solid #d8d8d8;
          border-radius: 6px; background: #f5f5f5; font-size: 14px; font-weight: 600; line-height: 1.45;
          max-width: 85%; white-space: pre-line; word-break: break-word; text-align: center; color: #2c3e50;
        }

        .print-summary-footer { margin-top: 30px; border-top: 1px solid #e0e0e0; padding-top: 20px; font-size: 15px; }
        .summary { display: flex; justify-content: flex-end; align-items: center; gap: 12px; margin-bottom: 10px; }
        .summary label { font-weight: 600; min-width: 150px; text-align: right; }
        .discount-line { display: inline-flex; gap: 10px; align-items: baseline; }
        .highlight-value { background: #f5f5f5; padding: 2px 6px; border-radius: 4px; font-weight: 600; color: #2c3e50; }

        /* Hide inputs in printed HTML (safety if this HTML is shown somewhere) */
        .print-toggle input, .print-toggle textarea, .print-toggle select { display: none !important; }
        .print-toggle .print-view { display: inline !important; }
      </style>`;

    const onePage = `
      <div class="page">
        <div class="top-section">
          <h2 class="title">J.T. Fruits &amp; Vegetables</h2>
          <div class="address-line">Shop No. 31-32, Bldg No. 27, EMP Op Jogers Park, Thakur Village, Kandivali(E), Mumbai 400101</div>
          <div class="license-line">PAN: AAJFJ0258J | FSS LICENSE ACT 2006 LICENSE NO: 11517011000128</div>
          <div class="email-line">Email: jkumarshahu5@gmail.com</div>
        </div>

        <h3 class="invoice-title">TAX FREE INVOICE</h3>

        <div class="info-grid">
          <div class="left-info">
            <div class="line"><label>NAME :</label><span>${esc(meta.clientName)}</span></div>
            <div class="line"><label>ADDRESS :</label><span style="white-space: pre-line;">${esc(meta.address)}</span></div>
            <div class="line"><label>GST No :</label><span>27AACCA8432H1ZQ</span></div>
          </div>

          <div class="right-meta">
            <div class="meta"><label>BILL NO :</label><span>${esc(meta.billNumber)}</span></div>
            <div class="meta"><label>DATE :</label><span>${esc(dateStr)}</span></div>
            <div class="meta"><label>AMOUNT :</label><span>${fmt(totalAmount)}</span></div>
          </div>
        </div>

        <div class="description-container">
          <div class="description-print">${esc(meta.description)}</div>
        </div>

        <div class="print-summary-footer">
          <div class="summary"><label>Total Amount :</label><div>${fmt(totalAmount)}</div></div>
          <div class="summary">
            <label>Discount :</label>
            <div class="discount-line"><span class="highlight-value">${fmt(discountPct)} %</span><span>${fmt(discountValue)}</span></div>
          </div>
          <div class="summary"><label>Grand Total :</label><div>${fmt(grandTotal)}</div></div>
          <div style="text-align:right; margin-top:50px; font-weight:600;">J.T. Fruits &amp; Vegetables</div>
        </div>
      </div>`;

    const pages = Array.from({ length: Math.max(1, copies) }, () => onePage).join('\n');

    return `
      <!doctype html>
      <html>
        <head><meta charset="utf-8"/><title>Lumpsum Invoice ${esc(meta.billNumber)}</title>${styles}</head>
        <body>${pages}</body>
      </html>`;
  }

  /** Fallback for non-Electron environments */
  private async printHtmlInHiddenIframe(html: string): Promise<void> {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.setAttribute('aria-hidden', 'true');
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      alert('Unable to create print frame.');
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    const waitForAssets = async () => {
      const promises: Promise<unknown>[] = [];
      // @ts-ignore fonts may not exist in some engines
      if ((doc as any).fonts?.ready) promises.push((doc as any).fonts.ready);
      const imgs = Array.from(doc.images || []);
      imgs.forEach(img => {
        if (img.complete) return;
        promises.push(
          new Promise(res => {
            img.addEventListener('load', res, { once: true });
            img.addEventListener('error', res, { once: true });
          })
        );
      });
      promises.push(new Promise(res => setTimeout(res, 50)));
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

  private formatDateDDMMYYYY(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || '';
    return d.toLocaleDateString('en-GB'); // dd/mm/yyyy
  }

  emailBill(): void {
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();

    setTimeout(() => {
      if (!this.manualEmail || !this.manualEmail.includes('@')) {
        alert('Please enter a valid email address');
        return;
      }

      this.calculateFinalAmount();

      const pdfHtml = this.buildPrintHtml({
        clientName: this.clientName || '',
        address: this.address || '',
        billNumber: this.billNumber || '',
        billDate: this.billDate || '',
        description: this.description || '',
        amount: this.amount || 0,
        discount: this.discount || 0,
        finalAmount: this.finalAmount || 0
      });

      const billData = {
        clientName: this.clientName,
        address: this.address,
        billNumber: this.billNumber,
        billDate: this.billDate,
        discount: this.discount,
        discountAmount: this.marginValue,
        totalAmount: this.amount,
        finalAmount: this.finalAmount,
        description: this.description,
        billItems: [],
        email: this.manualEmail,
        billType: 'lumpsum',
        pdfHtml
      };

      this.billsService.sendBillByEmail(billData).subscribe({
        next: () => alert('Email Sent!'),
        error: () => alert('Failed to send email. Please try again.')
      });
    }, 10);
  }

  autoResize(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    target.style.height = 'auto';
    target.style.height = target.scrollHeight + 'px';
  }

  /** Convert raw HTML to a data URL that Electron can load in a hidden window (UTF-8, no base64) */
  private htmlToDataUrl(html: string): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }
}
