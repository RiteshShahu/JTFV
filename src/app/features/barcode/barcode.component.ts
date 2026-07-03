import { Component, OnInit, ChangeDetectorRef, OnDestroy } from '@angular/core';
import { ProductService, Name } from 'src/app/core/services/products.service';
import bwipjs from 'bwip-js';
import { LabelPrintsService } from 'src/app/core/services/label-prints.service';
import { Router } from '@angular/router';

// ============= INTERFACES =============
export type LabelStyle = 'dmart' | 'reliance' | 'old-dmart';

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
const MAX_QUANTITY = 999;
const MIN_MRP = 0;
const TOAST_DURATION = 3000;

// ============= COMPONENT =============
@Component({
  selector: 'app-barcode',
  templateUrl: './barcode.component.html',
  styleUrls: ['./barcode.component.css'],
})
export class BarcodeComponent implements OnInit, OnDestroy {
  products: ProductRow[] = [];
  printItems: PrintItem[] = [];
  nameOptions: Name[] = [];
  filteredOptionsCache: Name[] = [];

  packedOnDate: string = this.getTodayLocalDate();
  selectedPrintStyle: LabelStyle = 'reliance';

  isLoading = false;
  validationErrors: string[] = [];
  toast: ToastState = { show: false, message: '', type: 'success' };

  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private printIframe: HTMLIFrameElement | null = null;

  constructor(
    private cdRef: ChangeDetectorRef,
    private productService: ProductService,
    private labelPrints: LabelPrintsService,
    private router: Router,
  ) { }

  ngOnInit(): void {
    this.addRow();
    this.loadProductNames();
    this.packedOnDate = this.getTodayLocalDate();
  }

  ngOnDestroy(): void {
    this.cleanupPrintIframe();
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
  }

  // ============= PUBLIC GETTERS =============

  get totalPrintItems(): number {
    return this.getValidProducts().reduce((sum, p) => sum + p.quantity, 0);
  }

  // ============= INITIALIZATION =============

  private loadProductNames(): void {
    this.productService.getNames().subscribe({
      next: (names) => {
        this.nameOptions = names.sort((a, b) =>
          (`${a.name} ${a.units}`).localeCompare(`${b.name} ${b.units}`)
        );
        this.updateFilteredOptionsCache();
      },
      error: (err) => {
        console.error('Failed to load names:', err);
        this.showToast('Failed to load product list', 'error');
      },
    });
  }

  private updateFilteredOptionsCache(): void {
    if (this.selectedPrintStyle === 'reliance') {
      this.filteredOptionsCache = this.nameOptions.filter(
        (n) => n.type?.toLowerCase() === 'vegetable'
      );
    } else {
      this.filteredOptionsCache = [...this.nameOptions];
    }
  }

  getFilteredNameOptions(): Name[] {
    return this.filteredOptionsCache;
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
      expiryDate: this.getTodayLocalDate(),
      barcode: '',
      dbBarcode: '',
      mrpEdited: false,
      units: '',
    };
    this.products = [...this.products, newRow];
  }

  removeRow(index: number): void {
    const removed = this.products[index];
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

    const expiryDate = this.calculateExpiryDate(this.packedOnDate, product.expiryDays);
    product.expiryDate = expiryDate;
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

  onPackedOnChange(): void {
    this.products = this.products.map((p) => ({
      ...p,
      expiryDate: this.calculateExpiryDate(this.packedOnDate, p.expiryDays),
    }));

    this.products.forEach((p) => this.generateBarcode(p));
    this.cdRef.detectChanges();
  }

  // ============= BARCODE GENERATION =============

  generateBarcode(product: ProductRow): void {
    if (!product.category || product.mrp == null || product.mrp <= 0) {
      product.barcode = '';
      return;
    }

    const isVegetable = product.category.toLowerCase() === 'vegetable';
    const prefix = isVegetable ? VEGETABLE_PREFIX : FRUIT_PREFIX;
    const paise = Math.round(product.mrp * 100);

    if (this.selectedPrintStyle === 'dmart' || this.selectedPrintStyle === 'old-dmart') {
      product.barcode = `${prefix}0000${paise}`;
    } else {
      product.barcode = product.dbBarcode || '';
    }
  }

  // ============= PRINT STYLE CHANGE =============

  onPrintStyleChange(style: LabelStyle): void {
    this.selectedPrintStyle = style;
    this.updateFilteredOptionsCache();

    if (style === 'reliance') {
      this.products = this.products.map((p) => {
        const match = this.nameOptions.find(
          (n) => `${n.name} ${n.units}` === p.productName
        );

        if (!match || match.type?.toLowerCase() !== 'vegetable') {
          return {
            ...p,
            nameId: null,
            productName: '',
            category: '',
            barcode: '',
            dbBarcode: '',
            units: '',
          };
        }
        return p;
      });
    }

    this.products.forEach((p) => this.generateBarcode(p));
    this.cdRef.detectChanges();
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

  // ============= PRINT OPERATIONS =============

  printSelected(): void {
    if (!this.validateBeforePrint()) {
      this.showToast('Please fix the errors before printing', 'error');
      return;
    }

    this.isLoading = true;
    this.preparePrintItems();

    this.logPrintJob();

    this.executePrint(() => {
      this.isLoading = false;
      this.cdRef.detectChanges();
    });
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

    previewWin.onload = () => {
      this.renderBarcodesInWindow(previewWin).then(() => {
        previewWin.focus();
        this.isLoading = false;
        this.cdRef.detectChanges();
      }).catch((err) => {
        console.error('Preview render error:', err);
        this.showToast('Error rendering preview', 'error');
        this.isLoading = false;
      });
    };
  }

  printAllBarcodesTest(): void {
    if (!this.nameOptions || this.nameOptions.length === 0) {
      this.showToast('Product list not loaded yet. Please wait.', 'warning');
      return;
    }

    const list = this.selectedPrintStyle === 'reliance'
      ? this.nameOptions.filter((n) => n.type?.toLowerCase() === 'vegetable')
      : this.nameOptions;

    this.printItems = list
      .map((n) => this.createPrintItemFromName(n))
      .filter((p): p is PrintItem =>
        p !== null && !!p.productName && p.mrp > 0 && !!p.barcode
      );

    if (this.printItems.length === 0) {
      this.showToast('No valid items to print', 'warning');
      return;
    }

    this.isLoading = true;
    this.executePrint(() => {
      this.isLoading = false;
      this.cdRef.detectChanges();
    });
  }

  private executePrint(onComplete: () => void): void {
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
      onComplete();
      return;
    }

    doc.open();
    doc.write(this.generatePrintHTML());
    doc.close();

    iframe.onload = () => {
      this.renderBarcodesInWindow(iframe.contentWindow as Window)
        .then(() => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();

          setTimeout(() => {
            this.cleanupPrintIframe();
            onComplete();
            this.showToast(`Printed ${this.printItems.length} labels`, 'success');
          }, 1000);
        })
        .catch((err) => {
          console.error('Render error:', err);
          this.showToast('Error rendering barcodes', 'error');
          this.cleanupPrintIframe();
          onComplete();
        });
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
      Array.from({ length: p.quantity }, () => ({
        nameId: p.nameId,
        productName: p.productName,
        units: p.units,
        category: p.category,
        mrp: Number(p.mrp),
        quantity: 1,
        expiryDays: Number(p.expiryDays),
        expiryDate: p.expiryDate,
        barcode: p.barcode,
      }))
    );
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
      barcode: '',
    };

    // Generate barcode for this item
    if (category && item.mrp > 0) {
      const isVegetable = category.toLowerCase() === 'vegetable';
      const prefix = isVegetable ? VEGETABLE_PREFIX : FRUIT_PREFIX;
      const paise = Math.round(item.mrp * 100);

      if (this.selectedPrintStyle === 'dmart' || this.selectedPrintStyle === 'old-dmart') {
        item.barcode = `${prefix}0000${paise}`;
      } else {
        item.barcode = n.barcode || '';
      }
    }

    return item;
  }

  private logPrintJob(): void {
    try {
      const payload = {
        packedOnDate: this.packedOnDate,
        printStyle: this.selectedPrintStyle,
        items: this.getValidProducts().map((p) => ({
          nameId: p.nameId ?? undefined,
          productName: p.productName,
          units: p.units,
          category: p.category,
          mrp: Number(p.mrp),
          quantity: Number(p.quantity),
          expiryDays: Number(p.expiryDays),
          expiryDate: p.expiryDate,
          barcode: p.barcode,
        })),
      };

      this.labelPrints.savePrintJob(payload).subscribe({
        next: () => { },
        error: (e) => console.error('Failed to log print job:', e),
      });
    } catch (e) {
      console.error('Failed to build/log print job:', e);
    }
  }

  // ============= HTML GENERATION =============

  private generatePrintHTML(): string {
    const head = `
      <meta charset="UTF-8">
      <meta name="viewport" content="width=240px">
      <title>Print Labels</title>`;

    const styleMap: Record<LabelStyle, string> = {
      dmart: this.getDmartStyles(),
      'old-dmart': this.getOldDmartStyles(),
      reliance: this.getRelianceStyles(),
    };

    const bodyMap: Record<LabelStyle, () => string> = {
      dmart: () => this.generateDmartBody(),
      'old-dmart': () => this.generateOldDmartBody(),
      reliance: () => this.generateRelianceBody(),
    };

    const css = styleMap[this.selectedPrintStyle];
    const body = bodyMap[this.selectedPrintStyle]();

    return `<!DOCTYPE html>
<html>
  <head>${head}
    <style>${css}</style>
  </head>
  <body>
    <div class="print-section">${body}</div>
  </body>
</html>`;
  }

  // ============= PRINT STYLES =============

  private getDmartStyles(): string {
    return `
      @media print {
        @page { size: 50mm 50mm; margin: 0; }
        body { margin: 0; padding: 0; }
        .print-section {
          margin: 0; padding: 6px;
          display: flex; flex-wrap: wrap; gap: 6px;
          justify-content: flex-start;
        }
      }
      .dmart-label {
        width: 240px; height: 189px;
        padding: 6px 10px; box-sizing: border-box;
        display: flex; flex-direction: column; justify-content: space-between;
        font-family: Arial, sans-serif; font-size: 10px; line-height: 1.2;
        text-align: left; page-break-inside: avoid;
        border: 1px solid transparent; position: relative; overflow: visible;
      }
      .barcode-row {
        display: flex; flex-direction: row; align-items: center;
        justify-content: flex-start; margin-top: 2px; gap: 4px;
      }
      .barcode-left {
        display: flex; flex-direction: column; align-items: flex-start;
      }
      .barcode-left .label-product {
        font-size: 11px; font-weight: bold; margin-bottom: 2px; text-align: left;
      }
      .barcode-left img { width: 160px; height: 35px; }
      .barcode-left .barcode-value {
        font-size: 13px; letter-spacing: 1px; text-align: center;
        margin-top: 2px; width: 160px;
      }
      .side-brand {
        writing-mode: vertical-rl; text-orientation: mixed;
        transform: rotate(180deg); font-size: 15px; font-weight: bold;
        color: black; padding-left: 2px; line-height: 1;
      }
      .dmart-footer { text-align: center; font-size: 9px; line-height: 1.1; margin-top: 4px; }
    `;
  }

  private getOldDmartStyles(): string {
    return `
      @media print {
        @page { size: 38mm 25mm; margin: 0mm; }
        body, html { margin: 0 !important; padding: 0 !important; }
        .print-section {
          display: flex; flex-wrap: wrap; gap: 0; margin: 0; padding: 0;
        }
      }
      .dmart-label {
        position: relative; width: 136px; height: 94px;
        box-sizing: border-box; padding: 2px 3px 1px;
        font-family: Arial, sans-serif; font-size: 9px;
        display: flex; flex-direction: column; justify-content: flex-start;
        text-align: left; line-height: 1.05; overflow: hidden;
      }
      .label-header { font-size: 9px; text-align: center; width: 100%; margin: 0; }
      .label-product {
        font-size: 9px; text-align: left; width: 100%;
        margin: 1px 0; padding-left: 2px;
      }
      .dmart-label img { width: 120px; height: 30px; margin: 0 0 1px; }
      .barcode-value {
        font-size: 10px; text-align: left; width: 100%;
        letter-spacing: 1px; padding-left: 2px; margin: 0 0 1px;
      }
      .info-row {
        display: flex; justify-content: space-between;
        width: 100%; font-size: 9px; margin: 0;
      }
      .info-left { font-weight: normal; font-size: 9.5px; text-align: center; }
      .price-value { font-size: 9.5px; font-weight: bold; text-align: center; }
      .label-footer {
        font-size: 7px; text-align: left; width: 100%;
        margin-top: 1px; line-height: 1; padding-bottom: 1px;
      }
      .side-brand {
        position: absolute; right: -4px; top: 28%;
        transform: rotate(-90deg); transform-origin: right top;
        font-size: 14px; font-weight: bold;
      }
    `;
  }

  private getRelianceStyles(): string {
    return `
      @media print {
        @page { size: 50mm 50mm; margin: 0; }
        body { margin: 0; padding: 0; }
        .print-section {
          margin: 0; padding: 6px;
          display: flex; flex-wrap: wrap; gap: 6px;
          justify-content: flex-start;
        }
      }
      .reliance-label {
        width: 240px; height: 189px;
        padding: 6px 10px; box-sizing: border-box;
        display: flex; flex-direction: column; justify-content: space-between;
        font-family: Arial, sans-serif; font-size: 10px; line-height: 1.2;
        text-align: left; page-break-inside: avoid;
        border: 1px solid transparent;
      }
      .barcode-value {
        font-size: 14px; letter-spacing: 1px; margin: 2px 0; text-align: center;
      }
      .label-product {
        font-size: 11px; font-weight: bold; margin: 2px 0; text-align: center;
      }
    `;
  }

  // ============= BODY GENERATION =============

  private generateDmartBody(): string {
    return this.printItems
      .map(
        (p, i) => `
        <div class="dmart-label">
          <div style="text-align:center;font-size:11px;"><b>J T FRUITS &amp; VEG</b></div>
          <div class="barcode-row">
            <div class="barcode-left">
              <div class="label-product">${this.escapeHtml(p.productName)}</div>
              <img id="dmart-bar-${i}" />
              <div class="barcode-value">${p.barcode}</div>
            </div>
            <div class="side-brand">Dmart</div>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <div>M.R.P :</div><b><div>₹${p.mrp}/-</div></b>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <div>PACKED ON :</div><b><div>${this.packedOnDate}</div></b>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <div>BEST BEFORE :</div><b><div>${p.expiryDate}</div></b>
          </div>
          <div class="dmart-footer">
            <div style="text-align:center;font-size:11px;"><b>FSSAI No. 11517011000128</b></div>
            <div style="text-align:center;font-size:10px;">Shop No. 31-32, Bldg No. 27,</div>
            <div style="text-align:center;font-size:10px;">EMP Op Jogers Park, Thakur Village,</div>
            <div style="text-align:center;font-size:10px;">Kandivali(E)</div>
            <div style="text-align:center;font-size:10px;">Customer Care No. 9594117456</div>
          </div>
        </div>`
      )
      .join('');
  }

  private generateRelianceBody(): string {
    return this.printItems
      .map(
        (p, i) => `
        <div class="reliance-label">
          <div style="text-align:center;font-size:11px;"><b>J T FRUITS &amp; VEG</b></div>
          <div style="text-align:center;font-size:12px;">${this.escapeHtml(p.productName)}</div>
          <img id="rel-barcode-img-${i}" style="width:180px;height:37px;" />
          <div class="barcode-value">${p.barcode}</div>
          <div style="display:flex;justify-content:space-between;">
            <div>M.R.P :</div><b><div>₹${p.mrp}/-</div></b>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <div>PACKED ON :</div><b><div>${this.packedOnDate}</div></b>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <div>BEST BEFORE :</div><div><b>${p.expiryDays} DAYS</b></div>
          </div>
          <div style="text-align:center;font-size:9px;">
            <div style="text-align:center;font-size:11px;"><b>FSSAI No. 11517011000128</b></div>
            <div style="text-align:center;font-size:10px;">Shop No. 31-32, Bldg No. 27,</div>
            <div style="text-align:center;font-size:10px;">EMP Op Jogers Park, Thakur Village,</div>
            <div style="text-align:center;font-size:10px;">Kandivali(E)</div>
            <div style="text-align:center;font-size:10px;">Customer Care No. 9594117456</div>
          </div>
        </div>`
      )
      .join('');
  }

  private generateOldDmartBody(): string {
    const formatDate = (dateStr: string): string => {
      const d = new Date(dateStr);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(-2);
      return `${dd}.${mm}.${yy}`;
    };

    return this.printItems
      .map((p, i) => {
        const pkd = formatDate(this.packedOnDate);
        const exp = formatDate(p.expiryDate);

        return `
        <div class="dmart-label">
          <span class="side-brand">Dmart</span>
          <div class="label-header">J T FRUITS &amp; VEG</div>
          <div class="label-product">${this.escapeHtml(p.productName)}</div>
          <img id="dmart-bar-${i}" />
          <div class="barcode-value">${p.barcode}</div>
          <div class="info-row">
            <div class="info-left">M.R.P.</div>
            <div>Pkd. On ${pkd}</div>
          </div>
          <div class="info-row">
            <div class="price-value">₹${p.mrp.toFixed(2)}</div>
            <div>Exp. Dt. ${exp}</div>
          </div>
          <div class="label-footer">Incl. of all Taxes)</div>
        </div>`;
      })
      .join('');
  }

  // ============= BARCODE RENDERING =============

  private async renderBarcodesInWindow(win: Window): Promise<void[]> {
    const promises = this.printItems.map((p, i) => this.renderSingleBarcode(win, p, i));
    return Promise.all(promises);
  }

  private renderSingleBarcode(win: Window, item: PrintItem, index: number): Promise<void> {
    const imgId = this.selectedPrintStyle === 'reliance'
      ? `rel-barcode-img-${index}`
      : `dmart-bar-${index}`;

    const imgEl = win.document.getElementById(imgId) as HTMLImageElement;
    if (!imgEl || !item.barcode) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      try {
        const canvas = document.createElement('canvas');

        bwipjs.toCanvas(canvas, {
          bcid: 'code128',
          text: item.barcode,
          scale: 1.6,
          height: 8,
          includetext: false,
          textxalign: 'center',
          backgroundcolor: 'FFFFFF',
        });

        const dataUrl = canvas.toDataURL('image/png');

        imgEl.onload = () => resolve();
        imgEl.onerror = () => {
          console.error(`Failed to load barcode image for ${item.productName}`);
          resolve();
        };
        imgEl.src = dataUrl;
      } catch (e) {
        console.error('bwip-js render error:', e);
        resolve();
      }
    });
  }

  // ============= NAVIGATION =============

  goToHistory(): void {
    this.router.navigate(['/label-history']);
  }

  resetForm(): void {
    this.packedOnDate = this.getTodayLocalDate();
    this.products = [];
    this.validationErrors = [];
    this.addRow();
    this.cdRef.detectChanges();
    this.showToast('Form reset', 'success');
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
    return type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
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