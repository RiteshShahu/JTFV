import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { BillsService } from 'src/app/core/services/bills.service';
import { ToastService } from 'src/app/core/services/toast.service';
import { EditRelianceBillsComponent } from '../edit-reliance-bills/edit-reliance-bills.component';
import { AddLumpsumBillsComponent } from '../add-lumpsum-bills/add-lumpsum-bills.component';

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

  // NEW: multi-bill email selection
  selectedBillsForEmail = new Set<string>();
  isSendingEmail = false;

  /* ------------------------------------------------------------------
     Reliance BILL TO is a FIXED constant and must NEVER change.
     The stored bill.clientName / bill.address always hold the actual
     customer (FRESHPIK SPECTRA POWAI, FRESHPIK BKC, etc.) => SHIP TO.
     ------------------------------------------------------------------ */
  private readonly RELIANCE_BILL_TO_NAME = 'Reliance Retail Limited';
  private readonly RELIANCE_BILL_TO_ADDR =
    'Reliance Corporate Park, Thane-Belapur Road, Ghansoli-400701, Navi Mumbai, Maharashtra';

  // Fallbacks only used when a legacy bill has no stored customer/address.
  private readonly DEFAULT_SHIP_TO_NAME = 'FRESHPIK SPECTRA POWAI';
  private readonly DEFAULT_SHIP_TO_ADDR =
    'Spectra, 1st, Central Ave, Hiranandani Gardens, Powai, Mumbai, Maharashtra 400076';

  constructor(
    private billsService: BillsService,
    private router: Router,
    private toast: ToastService
  ) { }

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

          const finalAmount = Number(
            bill.finalAmount ??
            bill.totalAmount ??
            0
          );

          return {
            ...bill,
            billItems,
            billType: derivedBillType,
            isPaid,
            paidAt,
            finalAmount
          };
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
  isRelianceBill(bill: any): boolean {
    // 1) Explicit tag
    if (bill.billType && String(bill.billType).toLowerCase() === 'reliance') return true;

    // 2) Fallback on client name
    const name = (bill.clientName || '').toString().toLowerCase();
    if (name.includes('freshpik spectra powai')) return true;
    if (name.includes('freshpik bkc')) return true;

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
      try { iframe.contentWindow?.focus(); } catch { }
      try { iframe.contentWindow?.print(); } catch { }
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

      let html = '';

      // === Reliance Bills ===
      if (this.isRelianceBill(bill)) {
        // BILL TO  -> always the fixed Reliance entity (never the customer)
        // SHIP TO  -> the actual customer stored on the bill (Powai / BKC / etc.)
        const payload = {
          billNumber: bill.billNumber,
          billDate: bill.billDate,
          clientName: this.RELIANCE_BILL_TO_NAME,     // BILL TO (fixed)
          address: this.RELIANCE_BILL_TO_ADDR,        // BILL TO (fixed)
          shipToName: bill.clientName || this.DEFAULT_SHIP_TO_NAME,   // SHIP TO (customer)
          shipToAddress: bill.address || this.DEFAULT_SHIP_TO_ADDR,   // SHIP TO (customer address)
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
        html = EditRelianceBillsComponent.buildRelianceHtml(payload);
      }

      // === Lumpsum Bills ===
      else if (bill.description) {
        const payload = {
          billNumber: bill.billNumber,
          billDate: bill.billDate,
          clientName: bill.clientName,
          address: bill.address,
          description: bill.description || '',
          amount: Number(bill.totalAmount ?? 0),
          discount: Number(bill.discount ?? 0),
          finalAmount: Number(bill.finalAmount ?? bill.totalAmount ?? 0),
        };
        html = AddLumpsumBillsComponent.buildLumpsumHtml(payload);
      }

      // === Normal / Default Bills ===
      else {
        this.toast.warn('Standard bill PDF layout not yet implemented.');
        this.downloading.delete(billNo);
        return;
      }

      // === Convert to data: URL ===
      const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;

      const el = (window as any).electron;
      if (el?.savePdfA4) {
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

      // Browser fallback
      this.downloadAsHtml(html, `Invoice_${billNo}.html`);
      this.toast.info('Downloaded HTML. Open & print to PDF.');
    } catch (err) {
      console.error('Download PDF failed:', err);
      this.toast.error('Could not prepare the PDF.');
    } finally {
      this.downloading.delete(billNo);
    }
  }

  private downloadAsHtml(html: string, filename: string) {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }

  /* ============================================================
     NEW: Multi-bill email selection & sending
     ============================================================ */

  /** Toggle bill selection for email */
  toggleBillForEmail(billNumber: string, event?: any): void {
    if (event) event.stopPropagation();
    if (this.selectedBillsForEmail.has(billNumber)) {
      this.selectedBillsForEmail.delete(billNumber);
    } else {
      this.selectedBillsForEmail.add(billNumber);
    }
  }

  /** Check if a bill is selected for email */
  isBillSelectedForEmail(billNumber: string): boolean {
    return this.selectedBillsForEmail.has(billNumber);
  }

  /** Handle select all checkbox change */
  onSelectAllChange(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    if (checkbox.checked) {
      // Select all Reliance bills
      this.filteredBills.filter(b => this.isRelianceBill(b)).forEach(b =>
        this.selectedBillsForEmail.add(b.billNumber)
      );
    } else {
      // Deselect all
      this.selectedBillsForEmail.clear();
    }
  }

  /** Send all selected Reliance bills via email */
  async sendSelectedBillsEmail(): Promise<void> {
    if (this.selectedBillsForEmail.size === 0) {
      this.toast.warn('Please select at least one bill to send.');
      return;
    }

    if (this.isSendingEmail) return;

    // Show toast to prompt for email(s)
    const emailInput = await this.promptForEmails();
    if (!emailInput) return;

    const recipients = this.parseEmails(emailInput);
    if (!recipients.length) {
      this.toast.warn('Please enter at least one valid email address.');
      return;
    }

    const invalidEmails = recipients.filter(e => !this.isValidEmail(e));
    if (invalidEmails.length) {
      this.toast.warn(`Invalid email${invalidEmails.length > 1 ? 's' : ''}: ${invalidEmails.join(', ')}`);
      return;
    }

    this.isSendingEmail = true;

    try {
      // Collect all selected bills
      const selectedBillNumbers = Array.from(this.selectedBillsForEmail);
      const billsToSend: any[] = [];

      // Fetch full data for each selected bill
      for (const billNo of selectedBillNumbers) {
        const bill = await this.billsService.getBillByNumber(billNo).toPromise();
        if (bill) billsToSend.push(bill);
      }

      if (!billsToSend.length) {
        this.toast.warn('Could not load selected bills.');
        this.isSendingEmail = false;
        return;
      }

      // Filter for Reliance bills only
      const relianceBills = billsToSend.filter(b => this.isRelianceBill(b));
      if (!relianceBills.length) {
        this.toast.warn('Only Reliance bills can be sent via email.');
        this.isSendingEmail = false;
        return;
      }

      // Build HTML for each bill and collect client (ship-to) names
      const billHtmls: string[] = [];
      const billNumbers = relianceBills.map(b => b.billNumber);
      const uniqueClientNames = new Set<string>();

      for (const bill of relianceBills) {
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

        // The actual customer is stored on the bill -> this is the SHIP TO party.
        const shipToName = bill.clientName || this.DEFAULT_SHIP_TO_NAME;
        const shipToAddress = bill.address || this.DEFAULT_SHIP_TO_ADDR;

        // Collect unique customer names for the email body.
        uniqueClientNames.add(shipToName);

        const payload = {
          billNumber: bill.billNumber,
          billDate: bill.billDate,
          clientName: this.RELIANCE_BILL_TO_NAME,   // BILL TO (fixed Reliance)
          address: this.RELIANCE_BILL_TO_ADDR,      // BILL TO (fixed Reliance)
          shipToName: shipToName,                   // SHIP TO (actual customer)
          shipToAddress: shipToAddress,             // SHIP TO (customer address)
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

        const html = EditRelianceBillsComponent.buildRelianceHtml(payload);
        billHtmls.push(html);
      }

      // Build email body with all unique customer names
      const billNumbersText = billNumbers.join(' & ');
      const clientNamesArray = Array.from(uniqueClientNames);
      const clientNamesText = clientNamesArray.join(' and ');
      const todayDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

      const emailBody = `Dear Reliance,\n\nPlease find attached invoice (${billNumbersText}) dated ${todayDate} for ${clientNamesText}.\n\nRegards,\nJ.T. Fruits & Vegetables`;

      // Send email with separate PDFs for each bill (not combined)
      const billData = {
        to: recipients,
        subject: `Invoices ${billNumbersText} - J.T. Fruits & Vegetables`,
        body: emailBody,
        pdfHtml: billHtmls[0], // First bill's HTML (required by service interface)
        billHtmls: billHtmls, // Array of separate HTMLs - backend will create separate PDFs
        billNumbers: billNumbers, // List of bill numbers for PDF naming
        billType: 'reliance-multi', // Signal to backend to handle as multi-bill with separate PDFs
      };

      this.billsService.sendBillByEmail(billData).subscribe({
        next: () => {
          this.toast.success(`Email sent successfully to ${recipients.length} recipient(s).`);
          this.selectedBillsForEmail.clear();
          this.isSendingEmail = false;
        },
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
          this.isSendingEmail = false;
        }
      });
    } catch (err) {
      console.error('Error preparing email:', err);
      this.toast.error('Could not prepare email. Please try again.');
      this.isSendingEmail = false;
    }
  }

  /** Prompt user for email addresses via toast input */
  private promptForEmails(): Promise<string | null> {
    return new Promise((resolve) => {
      const container = document.body;

      // Create a simple modal-like input overlay
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 99998;
      `;

      const modal = document.createElement('div');
      modal.style.cssText = `
        background: white;
        padding: 24px;
        border-radius: 8px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        width: 90%;
        max-width: 400px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      `;

      const title = document.createElement('div');
      title.style.cssText = 'font-size: 18px; font-weight: 600; margin-bottom: 12px; color: #2c3e50;';
      title.textContent = 'Enter Recipient Email(s)';

      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'email@example.com, another@example.com';
      input.style.cssText = `
        width: 100%;
        padding: 10px 12px;
        border: 1px solid #bdbdbd;
        border-radius: 4px;
        font-size: 14px;
        box-sizing: border-box;
        margin-bottom: 16px;
      `;

      const hint = document.createElement('div');
      hint.style.cssText = 'font-size: 12px; color: #757575; margin-bottom: 16px;';
      hint.textContent = 'Separate multiple emails with commas';

      const buttonGroup = document.createElement('div');
      buttonGroup.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';

      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = `
        padding: 8px 16px;
        border: 1px solid #bdbdbd;
        border-radius: 4px;
        background: #f5f5f5;
        color: #2c3e50;
        cursor: pointer;
        font-weight: 600;
      `;
      cancelBtn.onclick = () => {
        overlay.remove();
        resolve(null);
      };

      const sendBtn = document.createElement('button');
      sendBtn.textContent = 'Send';
      sendBtn.style.cssText = `
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        background: #3f51b5;
        color: white;
        cursor: pointer;
        font-weight: 600;
      `;
      sendBtn.onclick = () => {
        overlay.remove();
        resolve(input.value.trim());
      };

      // Enter key sends
      input.onkeydown = (e) => {
        if (e.key === 'Enter') {
          overlay.remove();
          resolve(input.value.trim());
        }
        if (e.key === 'Escape') {
          overlay.remove();
          resolve(null);
        }
      };

      buttonGroup.appendChild(cancelBtn);
      buttonGroup.appendChild(sendBtn);

      modal.appendChild(title);
      modal.appendChild(input);
      modal.appendChild(hint);
      modal.appendChild(buttonGroup);

      overlay.appendChild(modal);
      container.appendChild(overlay);

      // Auto-focus input
      setTimeout(() => input.focus(), 50);
    });
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
}