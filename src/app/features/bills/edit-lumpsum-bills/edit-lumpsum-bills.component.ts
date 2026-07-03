import { Component, OnInit, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BillsService } from 'src/app/core/services/bills.service';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { ToastService } from 'src/app/core/services/toast.service';

@Component({
  selector: 'app-edit-lumpsum-bills',
  templateUrl: './edit-lumpsum-bills.component.html',
  styleUrls: ['./edit-lumpsum-bills.component.css']
})
export class EditLumpsumBillsComponent implements OnInit, AfterViewInit {
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
  isPrinting = false;
  isSaving = false;
  isEmailing = false;
  private originalBillNumber = '';

  defaultEmails = [
    'Sunil17.Singh@ril.com',
    'Vijendra.Anthwal@ril.com',
    'niraj.shinde@ril.com',
  ];

  private readonly normalizeBillNumber = (s: string) => {
    const n = parseInt(String(s || '').trim(), 10);
    return Number.isNaN(n) ? String(s || '').trim() : String(n).padStart(3, '0');
  };

  /* ---- Static shared helpers ---- */

  private static fmt(n: number): string {
    return new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      .format(isFinite(n) ? Number(n) : 0);
  }

  private static esc(s: string): string {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private static formatDateDDMMYYYY(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso || '';
    return d.toLocaleDateString('en-GB');
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

  /** Shared print CSS */
  private static getPrintStyles(): string {
    return `
      <style>
        @page { size: A4; margin: 10mm; }
        html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; }
        .page {
          max-width: 950px; margin: 0 auto; padding: 40px;
          font-family: 'Poppins','Segoe UI',Tahoma,sans-serif;
          background: #ffffff; color: #2c3e50; page-break-after: auto;
        }
        .top-section { text-align: center; margin-bottom: 12px; }
        .title { font-size: 28px; font-weight: bold; color: #333; margin-bottom: 6px; }
        .address-line, .license-line, .email-line { font-size: 13px; color: #546e7a; margin: 2px 0; }
        .invoice-title { text-align: center; font-size: 18px; font-weight: 700; letter-spacing: .3px; margin: 14px 0 10px; }
        .info-grid {
          display: grid; grid-template-columns: 1.2fr 0.8fr;
          align-items: start; gap: 16px 24px; margin-bottom: 16px; font-size: 14px;
        }
        .left-info .line { display: flex; gap: 8px; align-items: flex-start; margin-bottom: 8px; }
        .gst-no { font-family: "Consolas","Roboto Mono","Liberation Mono",monospace; font-size: 16px; letter-spacing: 1px; }
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
        .grand-total { font-size: 18px; font-weight: 700; color: #1a1a1a; }
        .words-line { font-size: 13px; font-style: italic; color: #555; margin-top: 4px; }
        .print-toggle input, .print-toggle textarea, .print-toggle select { display: none !important; }
        .print-toggle .print-view { display: inline !important; }
      </style>`;
  }

  /** Shared page body builder */
  private static buildPageBody(meta: {
    clientName: string;
    address: string;
    billNumber: string;
    billDate: string;
    description: string;
    amount: number;
    discount: number;
    finalAmount: number;
    showAmountInWords?: boolean;
  }): string {
    const esc = EditLumpsumBillsComponent.esc;
    const fmt = EditLumpsumBillsComponent.fmt;
    const dateStr = EditLumpsumBillsComponent.formatDateDDMMYYYY(meta.billDate);

    const totalAmount = Number(meta.amount) || 0;
    const discountPct = Number(meta.discount) || 0;
    const discountValue = (totalAmount * discountPct) / 100;
    const grandTotal = isFinite(meta.finalAmount) ? Number(meta.finalAmount) : totalAmount - discountValue;

    const wordsHtml = meta.showAmountInWords !== false
      ? `<div class="summary words-line"><label>In Words :</label><div>${EditLumpsumBillsComponent.amountInWords(grandTotal)}</div></div>`
      : '';

    return `
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
            <div class="line"><label>GST No :</label><span class="gst-no">27AACCA8432H1ZQ</span></div>
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
            <div class="discount-line">
              <span class="highlight-value">${fmt(discountPct)} %</span>
              <span>${fmt(discountValue)}</span>
            </div>
          </div>
          <div class="summary"><label>Grand Total :</label><div class="grand-total">${fmt(grandTotal)}</div></div>
          ${wordsHtml}
          <div style="text-align:right; margin-top:50px; font-weight:600;">J.T. Fruits &amp; Vegetables</div>
        </div>
      </div>`;
  }

  /* ---- Instance wrapper for template ---- */
  amountInWords(num: number): string {
    return EditLumpsumBillsComponent.amountInWords(num);
  }

  /* ---- Constructor ---- */

  constructor(
    private route: ActivatedRoute,
    private billsService: BillsService,
    private http: HttpClient,
    private titleService: Title,
    private toast: ToastService
  ) {}

  /* ---- Lifecycle ---- */

  ngOnInit(): void {
    this.titleService.setTitle('Edit Lumpsum Bill');
    this.billNumber = this.route.snapshot.paramMap.get('billNumber') || '';
    this.originalBillNumber = this.normalizeBillNumber(this.billNumber);

    this.http.get<any[]>('http://localhost:3001/api/clients').subscribe(data => {
      this.clients = data;
    });

    this.billsService.getBillByNumber(this.billNumber).subscribe(bill => {
      this.clientName = bill.clientName;
      this.address = bill.address;
      this.description = bill.description;
      this.amount = bill.totalAmount;
      this.discount = bill.discount;
      this.billDate = bill.billDate;

      this.marginValue = (typeof bill.discountAmount === 'number')
        ? bill.discountAmount
        : ((bill.totalAmount || 0) * (bill.discount || 0)) / 100;

      this.finalAmount = (typeof bill.finalAmount === 'number')
        ? bill.finalAmount
        : (this.amount || 0) - (this.marginValue || 0);

      const matchingClient = this.clients.find(c => c.firstName === bill.clientName);
      if (matchingClient) this.selectedClient = matchingClient;

      setTimeout(() => this.autoResize(), 0);

      if (bill.discountAmount == null) this.calculateFinalAmount();
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => this.autoResize(), 0);
  }

  /* ---- Email chips ---- */

  isEmailAdded(email: string): boolean {
    return this.manualEmail
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .includes(email.toLowerCase());
  }

  addEmail(email: string): void {
    const current = this.manualEmail
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (current.some((e) => e.toLowerCase() === email.toLowerCase())) {
      const filtered = current.filter((e) => e.toLowerCase() !== email.toLowerCase());
      this.manualEmail = filtered.join(', ');
      return;
    }

    current.push(email);
    this.manualEmail = current.join(', ');
  }

  /* ---- Client change ---- */

  onClientChange(): void {
    if (this.selectedClient) {
      const c = this.selectedClient;
      this.clientName = c.firstName;
      this.address = [c.address1, c.address2, c.area, c.city].filter(Boolean).join(', ');
      setTimeout(() => this.autoResize(), 0);
    }
  }

  /* ---- Calculations ---- */

  calculateFinalAmount(): void {
    if (!this.amount && this.amount !== 0) return;
    if (!this.amount) { this.finalAmount = 0; this.marginValue = 0; return; }
    this.marginValue = (this.amount * this.discount) / 100;
    this.finalAmount = this.amount - this.marginValue;
  }

  /* ---- Auto-resize textarea ---- */

  autoResize(event?: Event): void {
    const textarea = event
      ? (event.target as HTMLTextAreaElement)
      : this.addressBox?.nativeElement;

    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }

  /* ---- UPDATE ---- */

  async updateBill(): Promise<void> {
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();

    if (this.isSaving) return;
    this.isSaving = true;

    try {
      const targetNo = this.normalizeBillNumber(this.billNumber);

      const doUpdate = () => {
        const updatedBill = {
          clientName: this.clientName,
          address: this.address,
          billNumber: targetNo,
          billDate: this.billDate,
          discount: this.discount,
          discountAmount: this.marginValue,
          totalAmount: this.amount,
          finalAmount: this.finalAmount,
          description: this.description,
          billItems: [],
          billType: 'lumpsum'
        };

        this.billsService.updateBill(this.originalBillNumber, updatedBill).subscribe({
          next: () => {
            this.toast.success('Bill updated successfully!');
            this.originalBillNumber = targetNo;
            this.isSaving = false;
          },
          error: () => {
            this.toast.error('Failed to update bill. Please try again.');
            this.isSaving = false;
          }
        });
      };

      if (targetNo !== this.originalBillNumber) {
        const exists = await this.billsService.billExists(targetNo).toPromise();
        if (exists) {
          const overwrite = await this.toast.confirm({
            message: `Bill ${targetNo} already exists. Overwrite?`,
            type: 'warn',
            okText: 'Overwrite',
            cancelText: 'Cancel',
          });
          if (!overwrite) return;
        }
      }

      doUpdate();
    } catch (e) {
      console.error('Update error:', e);
      this.toast.error('Could not verify Bill No. Please try again.');
    } finally {
      this.isSaving = false;
    }
  }

  /* ---- PRINT ---- */

  async printBill(): Promise<void> {
    if (this.isPrinting) return;

    this.isPrinting = true;

    try {
      const active = document.activeElement as HTMLElement | null;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();

      if (!this.clientName && !this.address && !this.description && !this.amount) {
        this.toast.warn('Nothing to print. Please fill bill details.');
        return;
      }

      const copies = Math.max(1, Math.min(50, Math.floor(Number(this.copiesCount) || 1)));
      this.calculateFinalAmount();

      const styles = EditLumpsumBillsComponent.getPrintStyles();
      const body = EditLumpsumBillsComponent.buildPageBody({
        clientName: this.clientName || '',
        address: this.address || '',
        billNumber: this.billNumber || '',
        billDate: this.billDate || '',
        description: this.description || '',
        amount: this.amount || 0,
        discount: this.discount || 0,
        finalAmount: this.finalAmount || 0,
      });

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Lumpsum Invoice ${EditLumpsumBillsComponent.esc(this.billNumber)}</title>
  ${styles}
</head>
<body>${body}</body>
</html>`;

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

      try { (window as any).electron?.refocusHard?.(); } catch { }
    }
  }

  /* ---- EMAIL ---- */

  emailBill(): void {
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) active.blur();

    if (!this.manualEmail || !this.manualEmail.includes('@')) {
      this.toast.warn('Please enter a valid email address');
      return;
    }

    if (this.isEmailing) return;
    this.isEmailing = true;

    this.calculateFinalAmount();

    const styles = EditLumpsumBillsComponent.getPrintStyles();
    const body = EditLumpsumBillsComponent.buildPageBody({
      clientName: this.clientName || '',
      address: this.address || '',
      billNumber: this.billNumber || '',
      billDate: this.billDate || '',
      description: this.description || '',
      amount: this.amount || 0,
      discount: this.discount || 0,
      finalAmount: this.finalAmount || 0,
    });

    const pdfHtml = `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Lumpsum Invoice ${EditLumpsumBillsComponent.esc(this.billNumber)}</title>
  ${styles}
</head>
<body>${body}</body>
</html>`;

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
      next: () => {
        this.toast.success('Email sent!');
        this.isEmailing = false;
      },
      error: () => {
        this.toast.error('Failed to send email. Please try again.');
        this.isEmailing = false;
      }
    });
  }

  /* ---- Print utility ---- */

  private async printHtmlInHiddenIframe(html: string): Promise<void> {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
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

  private htmlToDataUrl(html: string): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }

  /* ---- Static HTML builder for Reports → Download PDF ---- */

  static buildLumpsumHtml(payload: {
    billNumber: string;
    billDate: string;
    clientName?: string;
    address?: string;
    description?: string;
    amount?: number;
    discount?: number;
    finalAmount?: number;
  }): string {
    const styles = EditLumpsumBillsComponent.getPrintStyles();
    const body = EditLumpsumBillsComponent.buildPageBody({
      clientName: payload.clientName || '',
      address: payload.address || '',
      billNumber: payload.billNumber,
      billDate: payload.billDate,
      description: payload.description || '',
      amount: payload.amount || 0,
      discount: payload.discount || 0,
      finalAmount: typeof payload.finalAmount === 'number' && isFinite(payload.finalAmount)
        ? payload.finalAmount
        : (payload.amount || 0) - ((payload.amount || 0) * (payload.discount || 0)) / 100,
    });

    return `<!doctype html><html><head><meta charset="utf-8"/>
      <title>Lumpsum Invoice ${EditLumpsumBillsComponent.esc(payload.billNumber)}</title>${styles}
    </head><body>${body}</body></html>`;
  }
}