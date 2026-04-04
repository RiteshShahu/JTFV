import { Component, OnInit, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { BillsService } from 'src/app/core/services/bills.service';
import { ToastService } from 'src/app/core/services/toast.service';

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

  copiesCount = 2;
  private isPrinting = false;
  private isSaving = false;          // prevent double-click saves

  constructor(
    private http: HttpClient,
    private billsService: BillsService,
    private titleService: Title,
    private toast: ToastService
  ) { }

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

  // ------- SAVE with duplicate Bill No protection -------
  saveBill(): void {
    // flush any focused input/textarea
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();

    if (!this.billNumber?.trim()) {
      this.toast.warn('Bill No is required');
      return;
    }

    if (this.isSaving) return;
    this.isSaving = true;

    // Check if bill no already exists before saving
    this.billsService.billExists(this.billNumber).subscribe({
      next: (exists: boolean) => {
        if (exists) {
          this.toast.warn(`Bill ${this.billNumber} is already saved.`);
          this.isSaving = false;
          return;
        }

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
          billType: 'lumpsum'
        };

        this.billsService.saveBill(billData).subscribe({
          next: () => {
            this.toast.success('Bill saved successfully!');
            this.isSaving = false;
          },
          error: () => {
            this.toast.error('Failed to save bill. Please try again.');
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

  // --- PRINT: supports multiple copies and unfrozen UI after print ---
  async printBill(): Promise<void> {
    await this.printDocument('invoice');
  }

  async printChallan(): Promise<void> {
    await this.printDocument('challan');
  }

  private async printDocument(mode: 'invoice' | 'challan'): Promise<void> {
    if (this.isPrinting) return;

    this.isPrinting = true;
    try {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();

      if (!this.clientName && !this.address && !this.description && !this.amount) {
        this.toast.warn(mode === 'challan' ? 'Nothing to print.' : 'Nothing to print. Please fill bill details.');
        return;
      }

      const copies = Math.max(1, Math.min(50, Math.floor(Number(this.copiesCount) || 1)));
      this.calculateFinalAmount();

      const html = this.buildPrintHtml({
        mode,
        clientName: this.clientName || '',
        address: this.address || '',
        billNumber: this.billNumber || '',
        billDate: this.billDate || '',
        description: this.description || '',
        amount: this.amount || 0,
        discount: this.discount || 0,
        finalAmount: this.finalAmount || 0
      });

      const dataUrl = this.htmlToDataUrl(html);
      const el = (window as any).electron;

      if (el?.printCanonA4) {
        const res = await el.printCanonA4(dataUrl, { landscape: false, copies });
        if (!res?.ok) {
          console.error('Print failed:', res?.error);
          this.toast.error('Print failed. Check printer and try again.');
        } else {
          this.toast.success(mode === 'challan' ? 'Challan printed.' : 'Sent to printer.');
        }
      } else {
        await this.printHtmlInHiddenIframe(html);
        this.toast.info('Opening system print dialog…');
      }
    } catch (err) {
      console.error('Print failed:', err);
      this.toast.error(mode === 'challan' ? 'Error printing challan.' : 'Unexpected print error.');
    } finally {
      this.isPrinting = false;

      setTimeout(() => {
        try { (document.activeElement as HTMLElement | null)?.blur?.(); } catch { }
        try { window.focus(); } catch { }
      }, 40);

      try { (window as any).electron?.refocusHard?.(); } catch { }
    }
  }

  private buildPrintHtml(meta: {
    mode: 'invoice' | 'challan';
    clientName: string;
    address: string;
    billNumber: string;
    billDate: string;
    description: string;
    amount: number;
    discount: number;
    finalAmount: number;
  }): string {
    const esc = (s: string) =>
      (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const fmt = (n: number) =>
      new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(isFinite(n as number) ? Number(n) : 0);

    const isChallan = meta.mode === 'challan';
    const dateStr = this.formatDateDDMMYYYY(meta.billDate);
    const totalAmount = Number(meta.amount) || 0;
    const discountPct = Number(meta.discount) || 0;
    const discountValue = (totalAmount * discountPct) / 100;
    const grandTotal =
      isFinite(meta.finalAmount) ? Number(meta.finalAmount) : totalAmount - discountValue;

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
        page-break-after: auto;
      }

      .top-section { text-align: center; margin-bottom: 12px; }
      .title { font-size: 28px; font-weight: bold; color: #333; margin-bottom: 6px; }
      .address-line, .license-line, .email-line {
        font-size: 13px;
        color: #546e7a;
        margin: 2px 0;
      }

      .invoice-title {
        text-align: center;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: .3px;
        margin: 14px 0 10px;
      }

      .info-grid {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        align-items: start;
        gap: 16px 24px;
        margin-bottom: 16px;
        font-size: 14px;
      }

      .left-info .line {
        display: flex;
        gap: 8px;
        align-items: flex-start;
        margin-bottom: 8px;
      }

      .gst-no {
        font-family: "Consolas", "Roboto Mono", "Liberation Mono", monospace;
        font-size: 16px;
        letter-spacing: 1px;
      }

      .left-info label {
        font-weight: 700;
        white-space: nowrap;
      }

      .right-meta .meta {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        margin-bottom: 6px;
      }

      .right-meta label {
        font-weight: 700;
        white-space: nowrap;
        min-width: 80px;
        text-align: right;
      }

      .description-container {
        text-align: center;
        margin: 16px 0 22px;
      }

      .description-print {
        display: inline-block;
        margin: 0 auto;
        padding: 8px 14px;
        border: 1px solid #d8d8d8;
        border-radius: 6px;
        background: #f5f5f5;
        font-size: 14px;
        font-weight: 600;
        line-height: 1.45;
        max-width: 85%;
        white-space: pre-line;
        word-break: break-word;
        text-align: center;
        color: #2c3e50;
      }

      .print-summary-footer {
        margin-top: 30px;
        border-top: 1px solid #e0e0e0;
        padding-top: 20px;
        font-size: 15px;
      }

      .summary {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 12px;
        margin-bottom: 10px;
      }

      .summary label {
        font-weight: 600;
        min-width: 150px;
        text-align: right;
      }

      .discount-line {
        display: inline-flex;
        gap: 10px;
        align-items: baseline;
      }

      .highlight-value {
        background: #f5f5f5;
        padding: 2px 6px;
        border-radius: 4px;
        font-weight: 600;
        color: #2c3e50;
      }

      .challan-mode .invoice-title,
      .challan-mode .gst-line,
      .challan-mode .billno-meta,
      .challan-mode .amount-meta,
      .challan-mode .summary {
        display: none !important;
      }

      .print-toggle input,
      .print-toggle textarea,
      .print-toggle select {
        display: none !important;
      }

      .print-toggle .print-view {
        display: inline !important;
      }
    </style>`;

    const onePage = `
    <div class="page ${isChallan ? 'challan-mode' : ''}">
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
          <div class="line gst-line"><label>GST No :</label><span class="gst-no">27AACCA8432H1ZQ</span></div>
        </div>

        <div class="right-meta">
          <div class="meta billno-meta"><label>BILL NO :</label><span>${esc(meta.billNumber)}</span></div>
          <div class="meta"><label>DATE :</label><span>${esc(dateStr)}</span></div>
          <div class="meta amount-meta"><label>AMOUNT :</label><span>${fmt(totalAmount)}</span></div>
        </div>
      </div>

      <div class="description-container">
        <div class="description-print">${esc(meta.description)}</div>
      </div>

      <div class="print-summary-footer">
        <div class="summary"><label>Total Amount :</label><div>${fmt(totalAmount)}</div></div>
        <div class="summary">
          <label>Discount :</label>
          <div class="discount-line">
            <span class="highlight-value">${fmt(discountPct)} %</span>
            <span>${fmt(discountValue)}</span>
          </div>
        </div>
        <div class="summary"><label>Grand Total :</label><div>${fmt(grandTotal)}</div></div>
        <div style="text-align:right; margin-top:50px; font-weight:600;">J.T. Fruits &amp; Vegetables</div>
      </div>
    </div>`;

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>${isChallan ? 'Challan' : 'Lumpsum Invoice'} ${esc(meta.billNumber)}</title>
  ${styles}
</head>
<body>
  ${onePage}
</body>
</html>`;
  }

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
      this.toast.error('Unable to create print frame.');
      return;
    }

    doc.open(); doc.write(html); doc.close();

    const waitForAssets = async () => {
      const promises: Promise<unknown>[] = [];
      // @ts-ignore
      if ((doc as any).fonts?.ready) promises.push((doc as any).fonts.ready);
      const imgs = Array.from(doc.images || []);
      imgs.forEach(img => {
        if (!img.complete) promises.push(new Promise(res => {
          img.addEventListener('load', res, { once: true });
          img.addEventListener('error', res, { once: true });
        }));
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
        this.toast.warn('Please enter a valid email address');
        return;
      }

      this.calculateFinalAmount();

      const pdfHtml = this.buildPrintHtml({
        mode: 'invoice',
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
        next: () => this.toast.success('Email sent!'),
        error: () => this.toast.error('Failed to send email. Please try again.')
      });
    }, 10);
  }

  autoResize = (event: Event): void => {
    const target = event.target as HTMLTextAreaElement | null;
    if (!target) return;
    target.style.height = 'auto';
    target.style.height = target.scrollHeight + 'px';
  };

  /** Static HTML builder for Reports → Download PDF (Lumpsum bills) */
  /** Static HTML builder for Reports → Download PDF (Lumpsum bills)
   *  Style and layout are IDENTICAL to buildPrintHtml()
   */
  static buildLumpsumHtml(payload: {
    billNumber: string;
    billDate: string;
    clientName?: string;
    address?: string;
    description?: string;
    amount?: number;
    discount?: number;    // percent
    finalAmount?: number; // optional; will be derived if missing
  }): string {
    const esc = (s: string) =>
      (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const fmt = (n: number) =>
      new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(isFinite(n as number) ? Number(n) : 0);

    const dateStr = (() => {
      const d = new Date(payload.billDate);
      return Number.isNaN(d.getTime()) ? (payload.billDate || '') : d.toLocaleDateString('en-GB');
    })();

    const totalAmount = Number(payload.amount || 0);
    const discountPct = Number(payload.discount || 0);
    const discountValue = (totalAmount * discountPct) / 100;
    const grandTotal =
      typeof payload.finalAmount === 'number' && isFinite(payload.finalAmount)
        ? Number(payload.finalAmount)
        : totalAmount - discountValue;

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
          page-break-after: auto; /* single page, same as buildPrintHtml */
        }
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
        .gst-no {
          font-family: "Consolas", "Roboto Mono", "Liberation Mono", monospace;
          font-size: 16px; letter-spacing: 1px;
        }
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
            <div class="line"><label>NAME :</label><span>${esc(payload.clientName || '')}</span></div>
            <div class="line"><label>ADDRESS :</label><span style="white-space: pre-line;">${esc(payload.address || '')}</span></div>
            <div class="line"><label>GST No :</label><span class="gst-no">27AACCA8432H1ZQ</span></div>
          </div>

          <div class="right-meta">
            <div class="meta"><label>BILL NO :</label><span>${esc(payload.billNumber)}</span></div>
            <div class="meta"><label>DATE :</label><span>${esc(dateStr)}</span></div>
            <div class="meta"><label>AMOUNT :</label><span>${fmt(totalAmount)}</span></div>
          </div>
        </div>

        <div class="description-container">
          <div class="description-print">${esc(payload.description || '')}</div>
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

    return `<!doctype html><html><head><meta charset="utf-8"/>
      <title>Lumpsum Invoice ${esc(payload.billNumber)}</title>${styles}
    </head><body>${onePage}</body></html>`;
  }

  private htmlToDataUrl(html: string): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }
}