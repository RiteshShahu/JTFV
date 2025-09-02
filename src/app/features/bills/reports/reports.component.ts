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

          // Derive a fallback billType for older rows with no billType
          const derivedBillType =
            typeof bill.billType === 'string' && bill.billType
              ? String(bill.billType).toLowerCase()
              : this.deriveBillType({ ...bill, billItems });

          return { ...bill, billItems, billType: derivedBillType };
        });

        this.filteredBills = [...this.bills];
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

    // If your Reliance bills always used this client name, this will catch them:
    if (name.includes('freshpik spectra powai')) return 'reliance';

    // Heuristic: if billItems look like product-line items (have productId/price),
    // and clientName is empty/unknown (as in your Reliance template), classify as reliance.
    const items = Array.isArray(bill.billItems) ? bill.billItems : [];
    const looksLikeProductLines = items.some((it: any) => it && (it.productId || it.price || it.quantity));
    if (!bill.clientName && looksLikeProductLines) return 'reliance';

    return null;
  }

  selectBill(bill: any): void {
    this.selectedBill = {
      ...bill,
      billItems: bill.billItems
    };
  }

  closeDetail(): void {
    this.selectedBill = null;
  }

  async deleteBill(billNumber: string): Promise<void> {
    if (!billNumber) { this.toast.warn('Missing bill number.'); return; }

    const ok = await this.toast.confirm({
      message: `Delete Bill No: ${billNumber}?`,
      type: 'warn',
      okText: 'Delete',
      cancelText: 'Cancel',
      // timeoutMs: 8000, // optional auto-cancel after 8s
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
    const looksLikeProductLines = items.some((it: any) => it && (it.productId || it.price || it.quantity));
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
    const query = this.searchText.trim().toLowerCase();
    if (!query) {
      this.filteredBills = [...this.bills];
      return;
    }

    this.filteredBills = this.bills.filter(bill => {
      if (this.searchBy === 'billNumber') {
        return (bill.billNumber || '').toString().toLowerCase().includes(query);
      } else if (this.searchBy === 'clientName') {
        return (bill.clientName || '').toString().toLowerCase().includes(query);
      }
      return false;
    });
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

    // Give the browser a moment to layout
    setTimeout(finish, 120);
  }
}