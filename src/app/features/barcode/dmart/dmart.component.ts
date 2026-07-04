import { Component, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { ProductService, Name } from 'src/app/core/services/products.service';
import bwipjs from 'bwip-js';
import { LabelPrintsService } from 'src/app/core/services/label-prints.service';
import { Router } from '@angular/router';

// ============= INTERFACES =============
export interface ProductRow {
  id: string; // Unique ID for trackBy
  nameId: number | null;
  productName: string;
  mrp: number;
  category: string;
  quantity: number;
  expiryDays: number;
  expiryDate: string;
  barcode: string;
  dbBarcode: string;
  mrpEdited: boolean;
  expiryEdited: boolean;
  units: string;
}

export interface PrintItem {
  nameId: number | null;
  productName: string;
  units: string;
  category: string;
  mrp: number;
  quantity: number;
  expiryDays: number;
  expiryDate: string;
  barcode: string;
  dbBarcode?: string;
}

export interface ToastState {
  show: boolean;
  message: string;
  type: 'success' | 'error' | 'warning';
}

// ============= CONSTANTS =============
const VEGETABLE_PREFIX = '953779';
const FRUIT_PREFIX = '95378';
const DEFAULT_EXPIRY_DAYS = 1;
const MIN_MRP = 0;
const TOAST_DURATION = 3000;

// ============= COMPONENT =============
@Component({
  selector: 'app-dmart',
  templateUrl: './dmart.component.html',
  styleUrls: ['./dmart.component.css']
})
export class DmartComponent implements OnInit, OnDestroy {
  products: ProductRow[] = [];
  printItems: PrintItem[] = [];
  nameOptions: Name[] = [];

  packedOnDate: string = this.getTodayLocalDate();
  currentDate: string = this.getTodayLocalDate();

  isLoading = false;
  validationErrors: string[] = [];
  toast: ToastState = { show: false, message: '', type: 'success' };

  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private printIframe: HTMLIFrameElement | null = null;
  private barcodeCache: Record<string, string> = {};

  constructor(
    private cdRef: ChangeDetectorRef,
    private productService: ProductService,
    private labelPrints: LabelPrintsService,
    private router: Router,
  ) { }

  ngOnInit(): void {
    this.addRow();
    this.packedOnDate = this.getTodayLocalDate();
    this.loadProductNames();
  }

  ngOnDestroy(): void {
    this.cleanupPrintIframe();
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
  }

  // ============= PUBLIC GETTERS =============

  get totalPrintItems(): number {
    return this.getValidProducts().reduce((sum, p) => sum + Number(p.quantity), 0);
  }

  // ============= INITIALIZATION =============

  private loadProductNames(): void {
    this.productService.getNames().subscribe({
      next: (names) => {
        this.nameOptions = names.sort((a, b) =>
          (`${a.name} ${a.units}`).localeCompare(`${b.name} ${b.units}`)
        );
      },
      error: (err) => {
        console.error('Failed to load names:', err);
        this.showToast('Failed to load product list', 'error');
      },
    });
  }

  // ============= NAVIGATION =============

  goToHistory(): void {
    this.router.navigate(['/label-history']);
  }

  // ============= ROW MANAGEMENT =============

  addRow(): void {
    const newRow: ProductRow = {
      id: this.generateUniqueId(),
      nameId: null,
      productName: '',
      mrp: 0,
      category: '',
      quantity: 1,
      expiryDays: DEFAULT_EXPIRY_DAYS,
      expiryDate: this.currentDate,
      barcode: '',
      dbBarcode: '',
      mrpEdited: false,
      expiryEdited: false,
      units: '',
    };
    this.products = [...this.products, newRow];
  }

  removeRow(index: number): void {
    this.products = this.products.filter((_, i) => i !== index);

    if (this.products.length === 0) {
      this.addRow();
    }

    this.cdRef.detectChanges();
  }

  duplicateRow(index: number): void {
    const source = this.products[index];
    if (!source.nameId) return;

    const duplicate: ProductRow = {
      ...source,
      id: this.generateUniqueId(),
      quantity: 1, // Reset quantity to 1 for duplicate
    };

    // Insert after the source row
    this.products = [
      ...this.products.slice(0, index + 1),
      duplicate,
      ...this.products.slice(index + 1),
    ];

    this.showToast('Row duplicated', 'success');
  }

  resetForm(): void {
    this.packedOnDate = this.getTodayLocalDate();
    this.products = [];
    this.validationErrors = [];
    this.barcodeCache = {};
    this.addRow();
    this.cdRef.detectChanges();
    this.showToast('Form reset', 'success');
  }

  // ============= PRODUCT SELECTION =============

  onProductIdChange(index: number, nameId: number | null): void {
    const product = this.products[index];

    if (!nameId) {
      this.resetProductRow(product);
      return;
    }

    const selected = this.nameOptions.find((n) => n.id === nameId);
    if (!selected) {
      this.resetProductRow(product);
      return;
    }

    this.populateProductFromSelection(product, selected);
    this.generateBarcode(product);
  }

  private resetProductRow(product: ProductRow): void {
    product.nameId = null;
    product.productName = '';
    product.category = '';
    product.units = '';
    product.dbBarcode = '';
    product.mrp = 0;
    product.expiryDays = DEFAULT_EXPIRY_DAYS;
    product.expiryDate = this.getTodayLocalDate();
    product.barcode = '';
    product.mrpEdited = false;
    product.expiryEdited = false;
  }

  private populateProductFromSelection(product: ProductRow, selected: Name): void {
    product.nameId = selected.id;
    product.productName = `${selected.name} ${selected.units}`;
    product.category = this.formatCategory(selected.type);
    product.units = selected.units;
    product.dbBarcode = selected.barcode || '';
    product.mrp = selected.mrp ?? 0;
    product.mrpEdited = false;
    product.expiryDays = selected.expiryDays ?? DEFAULT_EXPIRY_DAYS;
    product.expiryEdited = false;
    product.expiryDate = this.calculateExpiryDate(this.packedOnDate, product.expiryDays);
  }

  // ============= MRP & DATE HANDLING =============

  onMrpChange(index: number): void {
    const product = this.products[index];
    product.mrpEdited = true;

    // Clamp MRP to valid range
    if (product.mrp < MIN_MRP) {
      product.mrp = MIN_MRP;
    }

    this.generateBarcode(product);
  }

  onMrpKeyDown(event: KeyboardEvent, index: number): void {
    if (event.key === 'Tab' && !event.shiftKey && index === this.products.length - 1) {
      event.preventDefault();
      this.addRow();

      setTimeout(() => {
        const selects = document.querySelectorAll<HTMLSelectElement>('select[name^="productName"]');
        const lastSelect = selects[selects.length - 1];
        lastSelect?.focus();
      }, 50);
    }
  }

  onExpiryChange(index: number): void {
    this.products[index].expiryEdited = true;
    this.updateExpiry(index);
  }

  updateExpiry(index: number): void {
    this.products[index].expiryDate = this.calculateExpiryDate(
      this.packedOnDate,
      Number(this.products[index].expiryDays)
    );
  }

  onPackedOnChange(): void {
    this.products = this.products.map((p) => ({
      ...p,
      expiryDate: this.calculateExpiryDate(this.packedOnDate, Number(p.expiryDays)),
    }));

    this.products.forEach((p) => this.generateBarcode(p));
    this.cdRef.detectChanges();
  }

  // ============= BARCODE GENERATION =============

  generateBarcode(product: ProductRow | PrintItem): void {
    if (!product.category || product.mrp == null || product.mrp <= 0) {
      product.barcode = '';
      return;
    }

    const isVegetable = product.category.toLowerCase() === 'vegetable';
    const prefix = isVegetable ? VEGETABLE_PREFIX : FRUIT_PREFIX;
    const paise = Math.round(product.mrp * 100);

    product.barcode = `${prefix}0000${paise}`;
  }

  // ============= VALIDATION =============

  hasRowErrors(index: number): boolean {
    const p = this.products[index];
    if (!p.nameId) return false;

    return !p.productName ||
      p.mrp <= 0 ||
      !p.category ||
      !p.barcode;
  }

  isRowComplete(product: ProductRow): boolean {
    return !!(
      product.nameId &&
      product.productName &&
      product.mrp > 0 &&
      product.category &&
      product.barcode
    );
  }

  getValidProducts(): ProductRow[] {
    return this.products.filter(
      (p) => p.quantity > 0 && p.productName && p.mrp > 0 && p.barcode
    );
  }

  validateBeforePrint(): boolean {
    this.validationErrors = [];

    if (this.products.length === 0) {
      this.validationErrors.push('No products added');
      return false;
    }

    const validProducts = this.getValidProducts();
    if (validProducts.length === 0) {
      this.validationErrors.push('No valid products to print');

      // Add specific errors
      this.products.forEach((p, i) => {
        if (p.nameId && !p.productName) {
          this.validationErrors.push(`Row ${i + 1}: Product name missing`);
        }
        if (p.nameId && p.mrp <= 0) {
          this.validationErrors.push(`Row ${i + 1}: Invalid MRP`);
        }
        if (p.nameId && !p.category) {
          this.validationErrors.push(`Row ${i + 1}: Category not selected`);
        }
        if (p.nameId && !p.barcode) {
          this.validationErrors.push(`Row ${i + 1}: Barcode could not be generated`);
        }
      });

      return false;
    }

    return true;
  }

  // ============= JOB PAYLOAD =============

  private buildJobPayload(): {
    packedOnDate: string;
    printStyle: 'dmart';
    items: {
      nameId?: number;
      productName: string;
      units?: string;
      category: string;
      mrp: number;
      quantity: number;
      expiryDays: number;
      expiryDate: string;
      barcode: string;
    }[];
  } {
    const items = this.getValidProducts().map(p => ({
      nameId: p.nameId ?? undefined,
      productName: p.productName,
      units: p.units,
      category: p.category,
      mrp: Number(p.mrp),
      quantity: Number(p.quantity),
      expiryDays: Number(p.expiryDays),
      expiryDate: p.expiryDate,
      barcode: p.barcode,
    }));

    return {
      packedOnDate: this.packedOnDate,
      printStyle: 'dmart',
      items,
    };
  }

  // ============= BARCODE IMAGE (DATA URL) =============

  private getBarcodeDataUrl(barcode: string): string {
    if (!barcode) return '';

    if (this.barcodeCache[barcode]) {
      return this.barcodeCache[barcode];
    }

    const canvas = document.createElement('canvas');

    bwipjs.toCanvas(canvas, {
      bcid: 'code128',
      text: barcode,
      scale: 1.6,
      height: 8,
      includetext: false,
      textxalign: 'center',
      backgroundcolor: 'FFFFFF',
    });

    const dataUrl = canvas.toDataURL('image/png');
    this.barcodeCache[barcode] = dataUrl;
    return dataUrl;
  }

  // ============= PRINT OPERATIONS =============

  printSelected(): void {
    if (!this.validateBeforePrint()) {
      this.showToast('Please fix the errors before printing', 'error');
      return;
    }

    this.isLoading = true;
    this.preparePrintItems();

    try {
      const payload = this.buildJobPayload();

      const htmlPayload = {
        html: this.generatePrintHTML(),
        copies: 1,
      };

      const electron = (window as any).electron;

      if (!electron || typeof electron.printDmart38x25 !== 'function') {
        this.isLoading = false;
        this.showToast('Electron print API not available.', 'error');
        return;
      }

      electron.printDmart38x25(htmlPayload).then((result: any) => {
        this.isLoading = false;
        this.cdRef.detectChanges();

        if (!result?.ok) {
          this.showToast(result?.error || 'Print failed', 'error');
          return;
        }

        this.showToast(`Printed ${this.printItems.length} labels`, 'success');

        this.labelPrints.savePrintJob(payload).subscribe({
          next: () => { },
          error: (e) => console.error('Failed to log print job:', e),
        });
      }).catch((e: any) => {
        console.error('Failed to print:', e);
        this.isLoading = false;
        this.showToast('Print failed', 'error');
        this.cdRef.detectChanges();
      });
    } catch (e) {
      console.error('Failed to print:', e);
      this.isLoading = false;
      this.showToast('Print failed', 'error');
    }
  }

  testPreview(): void {
    if (!this.validateBeforePrint()) {
      this.showToast('Please fix the errors before previewing', 'error');
      return;
    }

    this.preparePrintItems();

    const previewWin = window.open('', '_blank');
    if (!previewWin) {
      this.showToast('Popup blocked. Please allow popups for this site.', 'warning');
      return;
    }

    previewWin.document.open();
    previewWin.document.write(this.generatePrintHTML());
    previewWin.document.close();
    previewWin.focus();
  }

  printAllBarcodesTest(): void {
    if (!this.nameOptions || this.nameOptions.length === 0) {
      this.showToast('Product list not loaded yet. Please wait.', 'warning');
      return;
    }

    this.printItems = this.nameOptions
      .map((n) => this.createPrintItemFromName(n))
      .filter((p): p is PrintItem =>
        p !== null && !!p.productName && p.mrp > 0 && !!p.barcode
      );

    if (this.printItems.length === 0) {
      this.showToast('No valid items to print', 'warning');
      return;
    }

    this.isLoading = true;
    this.executeIframePrint(() => {
      this.isLoading = false;
      this.cdRef.detectChanges();
    });
  }

  private executeIframePrint(onComplete: () => void): void {
    this.cleanupPrintIframe();

    const iframe = document.createElement('iframe');
    this.printIframe = iframe;

    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) {
      this.showToast('Failed to create print window', 'error');
      this.cleanupPrintIframe();
      onComplete();
      return;
    }

    doc.open();
    doc.write(this.generatePrintHTML());
    doc.close();

    iframe.onload = () => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();

      setTimeout(() => {
        this.cleanupPrintIframe();
        onComplete();
        this.showToast(`Printed ${this.printItems.length} labels`, 'success');
      }, 1000);
    };
  }

  private cleanupPrintIframe(): void {
    if (this.printIframe && this.printIframe.parentNode) {
      try {
        document.body.removeChild(this.printIframe);
      } catch (e) {
        // iframe may already be removed
      }
    }
    this.printIframe = null;
  }

  // ============= PREPARATION =============

  private preparePrintItems(): void {
    this.printItems = this.getValidProducts().flatMap((p) =>
      Array.from({ length: Number(p.quantity) }, () => ({
        nameId: p.nameId,
        productName: p.productName,
        units: p.units,
        category: p.category,
        mrp: Number(p.mrp),
        quantity: 1,
        expiryDays: Number(p.expiryDays),
        expiryDate: p.expiryDate,
        barcode: p.barcode,
        dbBarcode: p.dbBarcode,
      }))
    );
    this.cdRef.detectChanges();
  }

  private createPrintItemFromName(n: Name): PrintItem | null {
    const category = this.formatCategory(n.type);
    const expiryDays = n.expiryDays ?? DEFAULT_EXPIRY_DAYS;
    const expiryDate = this.calculateExpiryDate(this.packedOnDate, expiryDays);

    const item: PrintItem = {
      nameId: n.id,
      productName: `${n.name} ${n.units}`,
      units: n.units,
      category,
      mrp: Number(n.mrp ?? 0),
      quantity: 1,
      expiryDays,
      expiryDate,
      dbBarcode: n.barcode || '',
      barcode: '',
    };

    this.generateBarcode(item);
    return item;
  }

  // ============= HTML GENERATION =============

  private generatePrintHTML(): string {
    const head = `
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Dmart Label</title>
    `;

    const dmartStyles = `
      @page {
        size: 38mm 25mm;
        margin: 0;
      }

      html, body {
        margin: 0;
        padding: 0;
        width: 38mm;
        background: #ffffff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
        font-family: Arial, sans-serif;
      }

      body {
        overflow: visible;
      }

      .print-section {
        margin: 0;
        padding: 0;
        width: 100%;
        background: #ffffff;
      }

      .dmart-label {
        position: relative;
        width: 39mm;
        height: 26mm;
        margin-left: 2mm;
        box-sizing: border-box;
        padding: 1.2mm 1.6mm 1mm 1.8mm;
        font-family: Arial, sans-serif;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        text-align: left;
        line-height: 1;
        overflow: hidden;
        background: #ffffff;
        page-break-after: always;
        break-after: page;
      }

      .dmart-label:last-child {
        page-break-after: auto;
        break-after: auto;
      }

      .label-header {
        font-size: 2.4mm;
        font-weight: bold;
        text-align: left;
        width: 30mm;
        margin: 0 0 0.3mm 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .label-product {
        font-size: 2.2mm;
        text-align: left;
        width: 30mm;
        margin: 0 0 0.4mm 0;
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .dmart-label img {
        width: 28.5mm;
        height: 8mm;
        margin: 0.2mm 0 0.2mm 0;
        display: block;
        object-fit: fill;
      }

      .barcode-value {
        font-size: 2.5mm;
        text-align: left;
        width: 30mm;
        letter-spacing: 0.2mm;
        margin: 0 0 0.3mm 0;
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
      }

      .info-row {
        display: flex;
        justify-content: space-between;
        width: 30mm;
        font-size: 2.2mm;
        margin: 0;
        line-height: 1;
        white-space: nowrap;
        gap: 1.2mm;
      }

      .info-left {
        font-weight: normal;
        font-size: 2mm;
        text-align: left;
      }

      .price-value {
        font-size: 2.2mm;
        font-weight: bold;
        text-align: left;
      }

      .label-footer {
        font-size: 1.45mm;
        text-align: left;
        width: 30mm;
        margin-top: 0.3mm;
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .side-brand {
        position: absolute;
        right: -1.5mm;
        top: 9.2mm;
        transform: rotate(-90deg);
        transform-origin: center;
        font-size: 3.3mm;
        font-weight: bold;
        line-height: 1;
        white-space: nowrap;
        width: 12mm;
        text-align: center;
        z-index: 5;
      }
    `;

    return `
      <!DOCTYPE html>
      <html>
        <head>
          ${head}
          <style>${dmartStyles}</style>
        </head>
        <body>
          <div class="print-section">
            ${this.generateDmartBody()}
          </div>
        </body>
      </html>
    `;
  }

  private generateDmartBody(): string {
    const formatDate = (dateStr: string): string => {
      const d = new Date(dateStr);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(-2);
      return `${dd}.${mm}.${yy}`;
    };

    return this.printItems
      .map((p) => {
        const pkd = formatDate(this.packedOnDate);
        const exp = formatDate(p.expiryDate);

        return `
        <div class="dmart-label">
          <span class="side-brand">Dmart</span>
          <div class="label-header">J T FRUITS &amp; VEG</div>
          <div class="label-product">${this.escapeHtml(p.productName)}</div>
          <img src="${this.getBarcodeDataUrl(p.barcode)}" />
          <div class="barcode-value">${p.barcode}</div>

          <div class="info-row">
            <div class="info-left">M.R.P.</div>
            <div>Pkd. On ${pkd}</div>
          </div>
          <div class="info-row">
            <div class="price-value">₹${Number(p.mrp).toFixed(2)}</div>
            <div>Exp. Dt. ${exp}</div>
          </div>

          <div class="label-footer">Incl. of all Taxes)</div>
        </div>
      `;
      })
      .join('');
  }

  // ============= TRACK BY =============

  trackByProductId(index: number, item: ProductRow): string {
    return item.id;
  }

  // ============= UTILITY METHODS =============

  getTodayLocalDate(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private calculateExpiryDate(packedOnDate: string, expiryDays: number): string {
    const packed = new Date(packedOnDate);
    packed.setDate(packed.getDate() + expiryDays);
    return packed.toISOString().split('T')[0];
  }

  private formatCategory(type: string | null | undefined): string {
    if (!type) return '';
    return type.charAt(0).toUpperCase() + type.slice(1);
  }

  private generateUniqueId(): string {
    return `row_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  getTotalMRP(): number {
    return this.getValidProducts().reduce(
      (sum, p) => sum + (p.mrp * p.quantity),
      0
    );
  }

  private showToast(message: string, type: ToastState['type']): void {
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }

    this.toast = { show: true, message, type };
    this.cdRef.detectChanges();

    this.toastTimer = setTimeout(() => {
      this.toast.show = false;
      this.cdRef.detectChanges();
    }, TOAST_DURATION);
  }
}