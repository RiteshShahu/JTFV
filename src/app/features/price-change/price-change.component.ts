import { Component, OnInit, ViewChildren, ElementRef, QueryList } from '@angular/core';
import { ProductService, Name } from 'src/app/core/services/products.service';
import { PriceChangeService } from 'src/app/core/services/price-change.service';
import { ToastService } from 'src/app/core/services/toast.service';

type Row = {
  productId: number | null;
  productName: string;
  barcode?: string;
  oldPrice?: number;
  newPrice?: number | null;
  units?: string;
  margin?: number;
};

@Component({
  selector: 'app-price-change',
  templateUrl: './price-change.component.html',
  styleUrls: ['./price-change.component.css'],
})
export class PriceChangeComponent implements OnInit {
  @ViewChildren('productSelect') productSelectInputs!: QueryList<ElementRef<HTMLSelectElement>>;
  @ViewChildren('newPriceInput') newPriceInputs!: QueryList<ElementRef<HTMLInputElement>>;

  products: (Name & { units?: string; mrp?: number })[] = [];
  namesMap: { [id: number]: Name & { units?: string; mrp?: number } } = {};

  rows: Row[] = Array.from({ length: 1 }).map(() => this.emptyRow());

  toList = '';
  subject = 'Product Price Change';
  message =
    'Below is the list of products requiring a price update. We would appreciate it if you could update them and notify us by email.';
  filename = 'New Product Price Change.xlsx';

  isBuilding = false;
  isEmailing = false;

  constructor(
    private productService: ProductService,
    private priceSvc: PriceChangeService,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.loadProducts();
  }

  private emptyRow(): Row {
    return {
      productId: null,
      productName: '',
      barcode: '',
      oldPrice: undefined,
      newPrice: null,
      units: '',
      margin: 15   // default 15%
    };
  }

  private loadProducts() {
    this.productService.getNames().subscribe({
      next: (list: Name[]) => {
        const vegOnly = (list || []).filter(p => (p.type || '').toLowerCase() === 'vegetable');
        vegOnly.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        this.products = vegOnly as (Name & { units?: string; mrp?: number })[];
        this.namesMap = this.products.reduce((acc, p) => {
          acc[p.id] = p;
          return acc;
        }, {} as Record<number, Name & { units?: string; mrp?: number }>);
      },
      error: (err) => {
        console.error('Failed to load products:', err);
        this.toast.error('Failed to load products.');
      }
    });
  }

  onProductChange(row: Row) {
    if (!row.productId) {
      Object.assign(row, this.emptyRow());
      return;
    }
    const p = this.namesMap[row.productId];
    const units = p?.units || '';
    row.units = units;
    row.barcode = (p as any)?.barcode || '';
    row.productName = (p?.name || '') + (units ? ' ' + units : '');
    row.oldPrice = typeof p?.mrp === 'number' ? p.mrp : undefined;
  }

  addRow() {
    this.rows.push(this.emptyRow());
    // Focus next Product select (new row)
    setTimeout(() => this.productSelectInputs?.last?.nativeElement?.focus(), 0);
  }

  removeRow(i: number) {
    this.rows.splice(i, 1);
    if (!this.rows.length) this.rows.push(this.emptyRow());
  }

  validRows(): Row[] {
    return this.rows.filter(r => r.productId && r.productName && (r.newPrice ?? 0) > 0);
  }

  // === Tab handler on New Price input (adds row at the end & focuses next Product) ===
  onNewPriceKeydown(event: KeyboardEvent, index: number): void {
    if (event.key !== 'Tab' || event.shiftKey) return; // forward Tab only
    event.preventDefault();

    const lastIndex = this.rows.length - 1;

    if (index === lastIndex) {
      // If we're on the last row, add a new one and focus its Product
      this.addRow();
      // (addRow already focuses .last productSelect)
    } else {
      // Move focus to next row's Product
      const selects = this.productSelectInputs.toArray();
      selects[index + 1]?.nativeElement.focus();
    }
  }

  // ------- XLSX (lazy) & Excel helpers -------

  /** Lazy-load xlsx so it doesn't live in the initial bundle */
  private async getXLSX(): Promise<typeof import('xlsx')> {
    return await import('xlsx');
  }

  private async buildWorkbook() {
    this.isBuilding = true;
    try {
      const XLSX = await this.getXLSX();

      const rows = this.validRows().map((r, idx) => {
        const marginNum = r.margin ?? 15;
        const cp = r.newPrice ? +(r.newPrice * (1 - marginNum / 100)).toFixed(2) : '';
        return {
          No: idx + 1,
          Barcode: r.barcode || '',
          Product: r.productName,
          'Old Price': r.oldPrice ?? '',
          'Selling Price': r.newPrice ?? '',
          'Cost Price': cp,
          'Margin %': `${marginNum}%`,   // <-- show as "15%"
        };
      });

      const ws = XLSX.utils.json_to_sheet(
        rows.length
          ? rows
          : [{ No: '', Barcode: '', Product: '', 'Old Price': '', 'Selling Price': '', 'Cost Price': '', 'Margin %': '' }]
      );

      // Set column widths
      ws['!cols'] = [
        { wch: 6 },
        { wch: 14 },
        { wch: 30 },  // Product column wider
        { wch: 12 },
        { wch: 12 },
        { wch: 12 },
        { wch: 10 },
      ];

      // Header bold (note: community build may ignore styles; safe to keep)
      const ref = ws['!ref'];
      if (ref) {
        const range = XLSX.utils.decode_range(ref);
        for (let C = range.s.c; C <= range.e.c; C++) {
          const cell = ws[XLSX.utils.encode_cell({ r: 0, c: C })];
          if (cell) (cell as any).s = { font: { bold: true } };
        }
      }

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Price Changes');
      return { wb, XLSX };
    } finally {
      this.isBuilding = false;
    }
  }

  /** Native, dependency-free download */
  private triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async downloadExcel() {
    try {
      const { wb, XLSX } = await this.buildWorkbook();
      const wbout: ArrayBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as any;
      const blob = new Blob([wbout], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      this.triggerDownload(blob, this.filename);
      this.toast.success('Excel exported.');
    } catch (e) {
      console.error(e);
      this.toast.error('Failed to build Excel.');
    }
  }

  async sendEmail() {
    const to = this.toList.split(',').map(s => s.trim()).filter(Boolean);
    if (!to.length) {
      this.toast.warn('Please enter at least one recipient email.');
      return;
    }

    try {
      this.isEmailing = true;

      // 1) Build workbook & base64 (unchanged)
      const { wb, XLSX } = await this.buildWorkbook();
      const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

      // 2) Build an email-friendly summary of rows (HTML + Text)
      const rows = this.validRows();
      const htmlTable = rows.length
        ? `
          <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
            <thead>
              <tr>
                <th align="left">No</th>
                <th align="left">Barcode</th>
                <th align="left">Product</th>
                <th align="right">Old Price</th>
                <th align="right">Selling Price</th>
                <th align="right">Cost Price</th>
                <th align="right">Margin</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r, i) => {
                const marginNum = r.margin ?? 15;
                const cp = r.newPrice ? (r.newPrice * (1 - marginNum / 100)).toFixed(2) : '';
                const sp = r.newPrice ?? '';
                const old = r.oldPrice ?? '';
                return `
                  <tr>
                    <td>${i + 1}</td>
                    <td>${r.barcode || ''}</td>
                    <td>${r.productName}</td>
                    <td align="right">${old}</td>
                    <td align="right">${sp}</td>
                    <td align="right">${cp}</td>
                    <td align="right">${marginNum}%</td>  <!-- shows like 15% -->
                  </tr>`;
              }).join('')}
            </tbody>
          </table>`
        : `<p><i>No items provided.</i></p>`;

      const textList = rows.length
        ? rows.map((r, i) => {
            const marginNum = r.margin ?? 15;
            const cp = r.newPrice ? (r.newPrice * (1 - marginNum / 100)).toFixed(2) : '';
            const sp = r.newPrice ?? '';
            const old = r.oldPrice ?? '';
            return `${i + 1}. ${r.productName} | Barcode: ${r.barcode || ''} | Old Price: ${old} | Selling Price: ${sp} | Cost Price: ${cp} | Margin: ${marginNum}%`;
          }).join('\n')
        : 'No items provided.';

      const messageHtml =
        `<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.4;">
          <p>${(this.message || '').replace(/\n/g, '<br/>')}</p>
          ${htmlTable}
        </div>`;

      const messageText = `${this.message || ''}\n\n${textList}`;

      // 3) Send
      await this.priceSvc.sendEmail({
        to,
        subject: this.subject,
        message: messageText,     // plaintext fallback (always shows “15%”)
        filename: this.filename,
        fileBase64: base64,
      }).toPromise();

      this.toast.success('Email sent!');
    } catch (e: any) {
      console.error(e);
      this.toast.error('Failed to send email. Check server logs.');
    } finally {
      this.isEmailing = false;
    }
  }
}