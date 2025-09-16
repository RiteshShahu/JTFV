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
      margin: 15, // default 15%
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
      },
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

  /**
   * Lazy-load XLSX: prefer xlsx-js-style (supports styles) and
   * fall back to xlsx (no styles) if not installed.
   */
  private async getXLSX(): Promise<any> {
    try {
      return await import('xlsx-js-style'); // header highlight works
    } catch {
      return await import('xlsx'); // no cell styles, but still exports fine
    }
  }

  private async buildWorkbook() {
    this.isBuilding = true;
    try {
      const XLSX = await this.getXLSX();

      // Build rows for Excel WITHOUT "Old Price"
      const rows = this.validRows().map((r, idx) => {
        const marginNum = r.margin ?? 15;
        const cp = r.newPrice ? +(r.newPrice * (1 - marginNum / 100)).toFixed(2) : '';
        return {
          No: idx + 1,
          Barcode: r.barcode || '',
          Product: r.productName,
          'Selling Price': r.newPrice ?? '',
          'Cost Price': cp,
          'Margin %': `${marginNum}%`, // show "15%"
        };
      });

      const ws = XLSX.utils.json_to_sheet(
        rows.length
          ? rows
          : [{ No: '', Barcode: '', Product: '', 'Selling Price': '', 'Cost Price': '', 'Margin %': '' }]
      );

      // Column widths (Product wider)
      ws['!cols'] = [
        { wch: 6 },   // No
        { wch: 14 },  // Barcode
        { wch: 34 },  // Product
        { wch: 14 },  // Selling Price
        { wch: 14 },  // Cost Price
        { wch: 10 },  // Margin %
      ];

      // Try to style header row (bold + soft highlight)
      const ref = ws['!ref'];
      if (ref) {
        const range = XLSX.utils.decode_range(ref);
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: 0, c: C });
          const cell: any = ws[addr] || {};
          cell.s = {
            font: { bold: true },
            fill: { patternType: 'solid', fgColor: { rgb: 'FFF7D6' } }, // pale yellow highlight
          };
          ws[addr] = cell;
        }
      }

      // Freeze header row (nice UX in Excel)
      (ws as any)['!freeze'] = { xSplit: 0, ySplit: 1 };

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

      // 1) Build workbook & base64
      const { wb, XLSX } = await this.buildWorkbook();
      const base64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

      // 2) Email summary (HTML + Text) — Old Price remains visible in email
      const rows = this.validRows();
      const htmlTable = rows.length
        ? `
          <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;">
            <thead>
              <tr>
                <th align="left"><strong>No</strong></th>
                <th align="left"><strong>Barcode</strong></th>
                <th align="left"><strong>Product</strong></th>
                <th align="right"><strong>SP</strong></th>
                <th align="right"><strong>CP</strong></th>
                <th align="right"><strong>Margin</strong></th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((r, i) => {
                const marginNum = r.margin ?? 15;
                const cp = r.newPrice ? (r.newPrice * (1 - marginNum / 100)).toFixed(2) : '';
                const sp = r.newPrice ?? '';
                return `
                  <tr>
                    <td>${i + 1}</td>
                    <td>${r.barcode || ''}</td>
                    <td>${r.productName}</td>
                    <td align="right">${sp}</td>
                    <td align="right">${cp}</td>
                    <td align="right">${marginNum}%</td>
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
            return `${i + 1}. ${r.productName} | Barcode: ${r.barcode || ''} | Selling Price: ${sp} | Cost Price: ${cp} | Margin: ${marginNum}%`;
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
        message: messageText, // plaintext fallback
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