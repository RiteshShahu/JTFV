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
  ) { }

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
      margin: 15,
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
    setTimeout(() => this.productSelectInputs?.last?.nativeElement?.focus(), 0);
  }

  removeRow(i: number) {
    this.rows.splice(i, 1);
    if (!this.rows.length) this.rows.push(this.emptyRow());
  }

  validRows(): Row[] {
    return this.rows.filter(r => r.productId && r.productName && (r.newPrice ?? 0) > 0);
  }

  onNewPriceKeydown(event: KeyboardEvent, index: number): void {
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();

    const lastIndex = this.rows.length - 1;

    if (index === lastIndex) {
      this.addRow();
    } else {
      const selects = this.productSelectInputs.toArray();
      selects[index + 1]?.nativeElement.focus();
    }
  }

  // ------- XLSX (lazy) & Excel helpers -------

  private async getXLSX(): Promise<any> {
    try {
      return await import('xlsx-js-style');
    } catch {
      return await import('xlsx');
    }
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
          'Selling Price': r.newPrice ?? '',
          'Cost Price': cp,
          'Margin %': `${marginNum}%`,
        };
      });

      const ws = XLSX.utils.json_to_sheet(
        rows.length
          ? rows
          : [{ No: '', Barcode: '', Product: '', 'Selling Price': '', 'Cost Price': '', 'Margin %': '' }]
      );

      ws['!cols'] = [
        { wch: 6 },
        { wch: 14 },
        { wch: 34 },
        { wch: 14 },
        { wch: 14 },
        { wch: 10 },
      ];

      const ref = ws['!ref'];
      if (ref) {
        const range = XLSX.utils.decode_range(ref);
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: 0, c: C });
          const cell: any = ws[addr] || {};
          cell.s = {
            font: { bold: true },
            fill: { patternType: 'solid', fgColor: { rgb: 'FFF7D6' } },
          };
          ws[addr] = cell;
        }
      }

      (ws as any)['!freeze'] = { xSplit: 0, ySplit: 1 };

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Price Changes');
      return { wb, XLSX };
    } finally {
      this.isBuilding = false;
    }
  }

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

  // ------- Email helpers -------

  /** Escape HTML so product names with &, <, > don't break email */
  private escapeHtml(s: string): string {
    return (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Build EMAIL content in TABLE form like your 2nd image:
   * PRODUCT | BARCODE | SELLING PRICE | COST PRICE | MARGIN
   */
  private buildTableEmail(rows: Row[]) {
    // Plain-text fallback
    const text =
      `${this.message || ''}\n\n` +
      (rows.length
        ? rows
          .map((r, i) => {
            const m = r.margin ?? 15;
            const sp = r.newPrice ?? '';
            const cp = r.newPrice ? (r.newPrice * (1 - m / 100)).toFixed(2) : '';
            return `${i + 1}. ${r.productName} | Barcode: ${r.barcode || ''} | Selling Price: ${sp} | Cost Price: ${cp} | Margin: ${m}%`;
          })
          .join('\n')
        : 'No items provided.');

    // HTML table (email-safe inline CSS)
    const html = `
      <div style="font-family:Arial,system-ui,sans-serif;font-size:13px;color:#222;line-height:1.4;">
        <p style="margin:0 0 10px 0;">
          ${(this.message || '').replace(/\n/g, '<br/>')}
        </p>

        <table cellpadding="4" cellspacing="0"
              style="
                width:760px;
                max-width:760px;
                border-collapse:collapse;
                background:#ffffff;
                border:1px solid #cfd3da;
                table-layout:fixed;
              ">
          <thead>
            <tr style="background:#6b7280;color:#ffffff;">
              <th align="left"
                  style="width:260px;border:1px solid #cfd3da;font-weight:700;">
                PRODUCT
              </th>

              <th align="center"
                  style="width:140px;border:1px solid #cfd3da;font-weight:700;">
                BARCODE
              </th>

              <th align="right"
                  style="width:120px;border:1px solid #cfd3da;font-weight:700;">
                SELLING PRICE
              </th>

              <th align="right"
                  style="width:120px;border:1px solid #cfd3da;font-weight:700;">
                COST PRICE
              </th>

              <th align="center"
                  style="width:80px;border:1px solid #cfd3da;font-weight:700;">
                MARGIN
              </th>
            </tr>
          </thead>

          <tbody>
            ${rows.length
        ? rows.map((r) => {
          const m = r.margin ?? 15;
          const sp = r.newPrice ?? '';
          const cp = r.newPrice ? (r.newPrice * (1 - m / 100)).toFixed(2) : '';
          return `
                      <tr>
                        <td style="
                          border:1px solid #d5d8de;
                          padding:4px 6px;
                          font-weight:600;
                          white-space:nowrap;
                          overflow:hidden;
                          text-overflow:ellipsis;
                        ">
                          ${this.escapeHtml(r.productName)}
                        </td>

                        <td align="center"
                            style="border:1px solid #d5d8de;padding:4px 6px;">
                          ${this.escapeHtml(r.barcode || '')}
                        </td>

                        <td align="right"
                            style="border:1px solid #d5d8de;padding:4px 6px;">
                          ${sp}
                        </td>

                        <td align="right"
                            style="border:1px solid #d5d8de;padding:4px 6px;">
                          ${cp}
                        </td>

                        <td align="center"
                            style="border:1px solid #d5d8de;padding:4px 6px;">
                          ${m}%
                        </td>
                      </tr>
                    `;
        }).join('')
        : `
                  <tr>
                    <td colspan="5"
                        style="border:1px solid #d5d8de;padding:10px;color:#666;">
                      <i>No items provided.</i>
                    </td>
                  </tr>
                `
      }
          </tbody>
        </table>
      </div>
    `.trim();

    return { text, html };
  }

  async sendEmail() {
    const to = this.toList.split(',').map(s => s.trim()).filter(Boolean);
    if (!to.length) {
      this.toast.warn('Please enter at least one recipient email.');
      return;
    }

    const rows = this.validRows();

    try {
      this.isEmailing = true;

      // 1) Build workbook & base64
      const { wb, XLSX } = await this.buildWorkbook();
      const fileBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });

      // 2) Email body (TABLE like your 2nd image)
      const { text, html } = this.buildTableEmail(rows);

      // 3) Send
      await this.priceSvc.sendEmail({
        to,
        subject: this.subject,

        // keep for backward compatibility (if backend still reads "message")
        message: text,

        // new fields (if backend supports)
        text,
        html,

        filename: this.filename,
        fileBase64,
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