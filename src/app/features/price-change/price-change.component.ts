import {
  Component,
  OnInit,
  ViewChildren,
  ElementRef,
  QueryList,
  OnDestroy,
  HostListener,
} from '@angular/core';
import { ProductService, Name } from 'src/app/core/services/products.service';
import { PriceChangeService } from 'src/app/core/services/price-change.service';
import { ToastService } from 'src/app/core/services/toast.service';
import { firstValueFrom } from 'rxjs';

type ProductOption = Name & {
  units?: string;
  mrp?: number;
  barcode?: string;
  type?: string;
};

type Row = {
  productId: number | null;
  productName: string;
  barcode?: string;
  oldPrice?: number;
  newPrice?: number | null;
  units?: string;
  margin?: number | null;
  searchText?: string;
  filteredProducts?: ProductOption[];
};

interface PriceChange {
  diff: number;
  percent: number;
  direction: 'up' | 'down' | 'none';
}

@Component({
  selector: 'app-price-change',
  templateUrl: './price-change.component.html',
  styleUrls: ['./price-change.component.css'],
})
export class PriceChangeComponent implements OnInit, OnDestroy {
  @ViewChildren('productSearchInput')
  productSearchInputs!: QueryList<ElementRef<HTMLInputElement>>;
  @ViewChildren('newPriceInput')
  newPriceInputs!: QueryList<ElementRef<HTMLInputElement>>;

  products: ProductOption[] = [];
  namesMap: Record<number, ProductOption> = {};

  rows: Row[] = [this.emptyRow()];

  defaultEmails = [
    'Sunil17.Singh@ril.com',
    'Vijendra.Anthwal@ril.com',
    'niraj.shinde@ril.com',
  ];

  toList = '';
  subject = this.buildDefaultSubject();
  message =
    'Below is the list of products requiring a price update. We would appreciate it if you could update them and notify us by email.';
  filename = 'New Product Price Change.xlsx';

  isBuilding = false;
  isEmailing = false;

  /** Debounce timers keyed by row index */
  private searchTimers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor(
    private productService: ProductService,
    private priceSvc: PriceChangeService,
    private toast: ToastService
  ) { }

  ngOnInit(): void {
    this.loadProducts();
  }

  ngOnDestroy(): void {
    this.searchTimers.forEach((timer) => clearTimeout(timer));
    this.searchTimers.clear();
  }

  /* ------------------------------------------------------------------ */
  /*  Computed properties                                                 */
  /* ------------------------------------------------------------------ */

  get validCount(): number {
    return this.rows.filter((r) => this.isRowValid(r)).length;
  }

  get invalidCount(): number {
    return this.rows.length - this.validCount;
  }

  get avgMargin(): number {
    const valid = this.rows.filter((r) => this.isRowValid(r));
    if (!valid.length) return 0;
    return (
      valid.reduce((sum, r) => sum + (r.margin ?? 15), 0) / valid.length
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  private buildDefaultSubject(): string {
    const now = new Date();
    const month = now.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
    return `Product Price Change - ${month}`;
  }

  isRowValid(r: Row): boolean {
    return !!(r.productId && r.productName && (r.newPrice ?? 0) > 0);
  }

  isEmailAdded(email: string): boolean {
    return this.toList
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .includes(email.toLowerCase());
  }

  addEmail(email: string): void {
    const current = this.toList
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (current.some((e) => e.toLowerCase() === email.toLowerCase())) {
      // Already added — remove it (toggle behaviour)
      const filtered = current.filter(
        (e) => e.toLowerCase() !== email.toLowerCase()
      );
      this.toList = filtered.join(', ');
      return;
    }

    current.push(email);
    this.toList = current.join(', ');
  }

  getPriceChange(r: Row): PriceChange | null {
    if (r.oldPrice == null || r.newPrice == null || r.oldPrice === 0)
      return null;
    const diff = +(r.newPrice - r.oldPrice).toFixed(2);
    if (diff === 0) return { diff: 0, percent: 0, direction: 'none' };
    return {
      diff,
      percent: +((diff / r.oldPrice) * 100).toFixed(1),
      direction: diff > 0 ? 'up' : 'down',
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Row management                                                     */
  /* ------------------------------------------------------------------ */

  private emptyRow(): Row {
    return {
      productId: null,
      productName: '',
      barcode: '',
      oldPrice: undefined,
      newPrice: null,
      units: '',
      margin: 15,
      searchText: '',
      filteredProducts: [...this.products],
    };
  }

  addRow(): void {
    this.rows.push(this.emptyRow());
    setTimeout(() => this.productSearchInputs?.last?.nativeElement?.focus(), 0);
  }

  removeRow(i: number): void {
    this.rows.splice(i, 1);
    if (!this.rows.length) this.rows.push(this.emptyRow());
  }

  duplicateRow(i: number): void {
    const src = this.rows[i];
    const dup: Row = {
      ...this.emptyRow(),
      productId: src.productId,
      productName: src.productName,
      barcode: src.barcode,
      oldPrice: src.oldPrice,
      units: src.units,
      margin: src.margin,
      searchText: src.productName,
    };
    this.rows.splice(i + 1, 0, dup);
    setTimeout(() => {
      const inputs = this.newPriceInputs.toArray();
      inputs[i + 1]?.nativeElement?.focus();
    }, 0);
  }

  async clearAllRows(): Promise<void> {
    const ok = await this.toast.confirm({
      message: 'Remove all rows and start fresh?',
      type: 'warn',
      okText: 'Clear All',
      cancelText: 'Cancel',
    });
    if (!ok) return;
    this.rows = [this.emptyRow()];
  }

  validRows(): Row[] {
    return this.rows.filter((r) => this.isRowValid(r));
  }

  /* ------------------------------------------------------------------ */
  /*  Product search & selection                                         */
  /* ------------------------------------------------------------------ */

  private loadProducts(): void {
    this.productService.getNames().subscribe({
      next: (list: Name[]) => {
        const vegOnly = (list || []).filter(
          (p) => (p.type || '').toLowerCase() === 'vegetable'
        );
        vegOnly.sort((a, b) =>
          `${a.name}${a.units ? ' ' + a.units : ''}`.localeCompare(
            `${b.name}${b.units ? ' ' + b.units : ''}`,
            undefined,
            { sensitivity: 'base' }
          )
        );

        this.products = vegOnly as ProductOption[];
        this.namesMap = this.products.reduce(
          (acc, p) => {
            acc[p.id] = p;
            return acc;
          },
          {} as Record<number, ProductOption>
        );

        this.rows.forEach((row) => {
          row.filteredProducts = [...this.products];
        });
      },
      error: (err) => {
        console.error('Failed to load products:', err);
        this.toast.error('Failed to load products.');
      },
    });
  }

  displayProductOption(product: ProductOption): string {
    return `${product.name}${product.units ? ' ' + product.units : ''}`.trim();
  }

  private normalizeText(value: string): string {
    return (value || '')
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeCompact(value: string): string {
    return this.normalizeText(value).replace(/\s+/g, '');
  }

  /** Debounced wrapper — actual work in performFilter */
  filterProducts(index: number): void {
    const existing = this.searchTimers.get(index);
    if (existing) clearTimeout(existing);

    this.searchTimers.set(
      index,
      setTimeout(() => {
        this.performFilter(index);
        this.searchTimers.delete(index);
      }, 150)
    );
  }

  private performFilter(index: number): void {
    const row = this.rows[index];
    const rawSearch = row.searchText || '';
    const search = this.normalizeText(rawSearch);
    const compactSearch = this.normalizeCompact(rawSearch);

    if (!search) {
      row.filteredProducts = [...this.products];
      return;
    }

    const searchWords = search.split(' ').filter(Boolean);

    row.filteredProducts = this.products.filter((product) => {
      const fullText = this.normalizeText(
        `${product.name} ${product.units || ''}`
      );
      const compactText = this.normalizeCompact(
        `${product.name} ${product.units || ''}`
      );

      const allWordsMatch = searchWords.every(
        (word) => fullText.includes(word) || compactText.includes(word)
      );

      return allWordsMatch || compactText.includes(compactSearch);
    });
  }

  onProductOptionSelected(
    index: number,
    selected: ProductOption,
    event: any
  ): void {
    if (!event?.isUserInput || !selected) return;
    this.applySelectedProduct(index, selected);
  }

  tryAutoSelectClosest(index: number): void {
    const row = this.rows[index];

    // Guard: if a product is already selected and text matches, skip
    if (
      row.productId &&
      row.searchText?.trim() === row.productName?.trim()
    ) {
      return;
    }

    const rawSearch = row.searchText || '';
    const search = this.normalizeText(rawSearch);
    const compactSearch = this.normalizeCompact(rawSearch);

    if (!search) return;

    // Exact match first
    const exact = this.products.find(
      (product) =>
        this.normalizeText(`${product.name} ${product.units || ''}`) === search
    );

    if (exact) {
      this.applySelectedProduct(index, exact);
      return;
    }

    // Fuzzy: all tokens must match
    const tokens = search.split(' ').filter(Boolean);
    const closest = this.products.find((product) => {
      const fullText = this.normalizeText(
        `${product.name} ${product.units || ''}`
      );
      const compactText = this.normalizeCompact(
        `${product.name} ${product.units || ''}`
      );
      return (
        tokens.every(
          (token) => fullText.includes(token) || compactText.includes(token)
        ) || compactText.includes(compactSearch)
      );
    });

    if (closest) {
      this.applySelectedProduct(index, closest);
    }
  }

  private applySelectedProduct(
    index: number,
    product: ProductOption
  ): void {
    const row = this.rows[index];
    row.productId = product.id;
    row.units = product.units || '';
    row.barcode = product.barcode || '';
    row.productName = this.displayProductOption(product);
    row.searchText = this.displayProductOption(product);
    row.oldPrice =
      typeof product.mrp === 'number' ? product.mrp : undefined;
    row.filteredProducts = [...this.products];
  }

  /* ------------------------------------------------------------------ */
  /*  Keyboard                                                           */
  /* ------------------------------------------------------------------ */

  onNewPriceKeydown(event: KeyboardEvent, index: number): void {
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();

    if (index === this.rows.length - 1) {
      this.addRow();
    } else {
      const inputs = this.productSearchInputs.toArray();
      inputs[index + 1]?.nativeElement.focus();
    }
  }

  @HostListener('keydown.control.enter')
  onCtrlEnter(): void {
    if (!this.isBuilding && !this.isEmailing && this.validCount) {
      this.sendEmail();
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Excel export                                                       */
  /* ------------------------------------------------------------------ */

  private async getXLSX(): Promise<any> {
    try {
      return await import('xlsx-js-style');
    } catch {
      console.warn('xlsx-js-style not available, falling back to xlsx');
      return await import('xlsx');
    }
  }

  private async buildWorkbook() {
    this.isBuilding = true;
    try {
      const XLSX = await this.getXLSX();

      const rows = this.validRows().map((r, idx) => {
        const marginNum = r.margin ?? 15;
        const cp = r.newPrice
          ? +(r.newPrice * (1 - marginNum / 100)).toFixed(2)
          : '';

        return {
          No: idx + 1,
          Barcode: r.barcode || '',
          Product: r.productName,
          'Selling Price': r.newPrice ?? '',
          'Cost Price': cp,
          'Margin %': `${marginNum}%`,
        };
      });

      const headerKeys = [
        'No',
        'Barcode',
        'Product',
        'Selling Price',
        'Cost Price',
        'Margin %',
      ];

      const emptyRow = Object.fromEntries(
        headerKeys.map((k) => [k, ''])
      );

      const ws = XLSX.utils.json_to_sheet(
        rows.length ? rows : [emptyRow]
      );

      ws['!cols'] = [
        { wch: 6 },
        { wch: 14 },
        { wch: 34 },
        { wch: 14 },
        { wch: 14 },
        { wch: 10 },
      ];

      // Style header row
      const ref = ws['!ref'];
      if (ref) {
        const range = XLSX.utils.decode_range(ref);
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: 0, c: C });
          const cell: any = ws[addr] || {};
          cell.s = {
            font: { bold: true },
            fill: {
              patternType: 'solid',
              fgColor: { rgb: 'FFF7D6' },
            },
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

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async downloadExcel(): Promise<void> {
    try {
      const { wb, XLSX } = await this.buildWorkbook();
      const wbout: ArrayBuffer = XLSX.write(wb, {
        type: 'array',
        bookType: 'xlsx',
      }) as any;
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

  /* ------------------------------------------------------------------ */
  /*  Email                                                              */
  /* ------------------------------------------------------------------ */

  private escapeHtml(s: string): string {
    return (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private buildTableEmail(rows: Row[]) {
    const text =
      `${this.message || ''}\n\n` +
      (rows.length
        ? rows
            .map((r, i) => {
              const m = r.margin ?? 15;
              const sp = r.newPrice ?? '';
              const cp = r.newPrice
                ? (r.newPrice * (1 - m / 100)).toFixed(2)
                : '';
              return `${i + 1}. ${r.productName} | Barcode: ${
                r.barcode || ''
              } | Selling Price: ${sp} | Cost: ${cp} | Margin: ${m}%`;
            })
            .join('\n')
        : 'No items provided.');

    const html = `
      <div style="font-family:Arial,system-ui,sans-serif;font-size:13px;color:#222;line-height:1.4;">
        <p style="margin:0 0 10px 0;">
          ${(this.message || '').replace(/\n/g, '<br/>')}
        </p>

        <table cellpadding="4" cellspacing="0"
              style="width:620px;max-width:620px;border-collapse:collapse;
                     background:#ffffff;border:1px solid #cfd3da;table-layout:fixed;">
          <thead>
            <tr style="background:#6b7280;color:#ffffff;">
              <th align="left"   style="width:220px;border:1px solid #cfd3da;font-weight:700;">PRODUCT</th>
              <th align="center" style="width:100px;border:1px solid #cfd3da;font-weight:700;">BARCODE</th>
              <th align="right"  style="width:120px;border:1px solid #cfd3da;font-weight:700;">SELLING PRICE</th>
              <th align="right"  style="width:120px;border:1px solid #cfd3da;font-weight:700;">COST PRICE</th>
              <th align="center" style="width:60px;border:1px solid #cfd3da;font-weight:700;">MARGIN</th>
            </tr>
          </thead>

          <tbody>
            ${rows.length
              ? rows
                  .map((r) => {
                    const m = r.margin ?? 15;
                    const sp = r.newPrice ?? '';
                    const cp = r.newPrice
                      ? (r.newPrice * (1 - m / 100)).toFixed(2)
                      : '';

                    return `
                    <tr>
                      <td style="border:1px solid #d5d8de;padding:4px 6px;font-weight:600;
                                 white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                        ${this.escapeHtml(r.productName)}
                      </td>
                      <td align="center" style="border:1px solid #d5d8de;padding:4px 6px;">
                        ${this.escapeHtml(r.barcode || '')}
                      </td>
                      <td align="right" style="border:1px solid #d5d8de;padding:4px 6px;font-weight:600;">
                        ${sp}
                      </td>
                      <td align="right" style="border:1px solid #d5d8de;padding:4px 6px;">
                        ${cp}
                      </td>
                      <td align="center" style="border:1px solid #d5d8de;padding:4px 6px;">
                        ${m}%
                      </td>
                    </tr>`;
                  })
                  .join('')
              : `
              <tr>
                <td colspan="5" style="border:1px solid #d5d8de;padding:10px;color:#666;">
                  <i>No items provided.</i>
                </td>
              </tr>`}
          </tbody>
        </table>
      </div>`.trim();

    return { text, html };
  }

  async sendEmail(): Promise<void> {
    const to = this.toList
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!to.length) {
      this.toast.warn('Please enter at least one recipient email.');
      return;
    }

    const rows = this.validRows();
    if (!rows.length) {
      this.toast.warn('Please add at least one complete row (product + new price).');
      return;
    }

    const confirmed = await this.toast.confirm({
      message: `Send price change email to ${to.length} recipient(s) with ${rows.length} product(s)?`,
      type: 'info',
      okText: 'Send',
      cancelText: 'Cancel',
    });
    if (!confirmed) return;

    try {
      this.isEmailing = true;

      const { wb, XLSX } = await this.buildWorkbook();
      const fileBase64 = XLSX.write(wb, {
        type: 'base64',
        bookType: 'xlsx',
      });

      const { text, html } = this.buildTableEmail(rows);

      await firstValueFrom(
        this.priceSvc.sendEmail({
          to,
          subject: this.subject,
          message: text,
          text,
          html,
          filename: this.filename,
          fileBase64,
        })
      );

      this.toast.success('Email sent!');
    } catch (e: any) {
      console.error(e);
      this.toast.error('Failed to send email. Check server logs.');
    } finally {
      this.isEmailing = false;
    }
  }
}