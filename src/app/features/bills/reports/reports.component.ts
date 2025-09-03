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

  // NEW
  paidFilter: 'all' | 'paid' | 'unpaid' = 'all';
  isToggling = new Set<string>(); // in-flight protection per bill

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
}