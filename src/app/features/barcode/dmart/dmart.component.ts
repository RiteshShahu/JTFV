import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { ProductService, Name } from 'src/app/core/services/products.service';
import bwipjs from 'bwip-js';
import { LabelPrintsService } from 'src/app/core/services/label-prints.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-dmart',
  templateUrl: './dmart.component.html',
  styleUrls: ['./dmart.component.css']
})
export class DmartComponent implements OnInit {
  products: any[] = [];
  printItems: any[] = [];
  nameOptions: Name[] = [];
  packedOnDate: string = this.getTodayLocalDate();
  currentDate: string = this.getTodayLocalDate();

  constructor(
    private cdRef: ChangeDetectorRef,
    private productService: ProductService,
    private labelPrints: LabelPrintsService,
    private router: Router,
  ) { }

  ngOnInit(): void {
    this.addRow();
    this.packedOnDate = this.getTodayLocalDate();

    this.productService.getNames().subscribe({
      next: (names) => {
        this.nameOptions = names.sort((a, b) =>
          (`${a.name} ${a.units}`).localeCompare(`${b.name} ${b.units}`)
        );

        this.products.forEach((p) => {
          p.filteredOptions = [...this.nameOptions];
        });
      },
      error: (err) => console.error('Failed to load names:', err),
    });
  }

  goToHistory() {
    this.router.navigate(['/label-history']);
  }

  onMrpKeyDown(event: KeyboardEvent, index: number) {
    if (event.key === 'Tab' && index === this.products.length - 1) {
      event.preventDefault();
      this.addRow();

      setTimeout(() => {
        const inputs = document.querySelectorAll(`input[name^='productSearch']`);
        const lastInput = inputs[inputs.length - 1] as HTMLElement;
        if (lastInput) {
          lastInput.focus();
        }
      });
    }
  }

  addRow() {
    this.products.push({
      nameId: null,
      productName: '',
      searchText: '',
      filteredOptions: [...this.nameOptions],
      mrp: 0,
      category: '',
      quantity: 1,
      expiryDays: 1,
      expiryDate: this.currentDate,
      barcode: '',
      dbBarcode: '',
      mrpEdited: false,
      expiryEdited: false,
      units: '',
    });
  }

  displayName(option: any): string {
    if (!option) return '';
    return `${option.name} ${option.units}`.trim();
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

  filterProducts(index: number) {
    const item = this.products[index];
    const rawSearch = item.searchText || '';
    const search = this.normalizeText(rawSearch);
    const compactSearch = this.normalizeCompact(rawSearch);

    if (!search) {
      item.filteredOptions = [...this.nameOptions];
      return;
    }

    const searchWords = search.split(' ').filter(Boolean);

    item.filteredOptions = this.nameOptions.filter((option) => {
      const fullText = this.normalizeText(`${option.name} ${option.units}`);
      const compactText = this.normalizeCompact(`${option.name} ${option.units}`);

      const allWordsMatch = searchWords.every(word =>
        fullText.includes(word) || compactText.includes(word)
      );

      return allWordsMatch || compactText.includes(compactSearch);
    });
  }

  onOptionChosen(index: number, selected: any, event: any) {
    if (!event?.isUserInput || !selected) return;

    const product = this.products[index];
    product.nameId = selected.id;
    product.searchText = `${selected.name} ${selected.units}`;
    this.applySelectedProduct(index, selected);
  }

  tryAutoSelectClosest(index: number) {
    const item = this.products[index];
    const rawSearch = item.searchText || '';
    const search = this.normalizeText(rawSearch);
    const compactSearch = this.normalizeCompact(rawSearch);

    if (!search) return;

    const exact = this.nameOptions.find(option =>
      this.normalizeText(`${option.name} ${option.units}`) === search
    );

    if (exact) {
      item.nameId = exact.id;
      item.searchText = `${exact.name} ${exact.units}`;
      this.applySelectedProduct(index, exact);
      return;
    }

    const tokens = search.split(' ').filter(Boolean);

    const closest = this.nameOptions.find(option => {
      const fullText = this.normalizeText(`${option.name} ${option.units}`);
      const compactText = this.normalizeCompact(`${option.name} ${option.units}`);

      return tokens.every(token =>
        fullText.includes(token) || compactText.includes(token)
      ) || compactText.includes(compactSearch);
    });

    if (closest) {
      item.nameId = closest.id;
      item.searchText = `${closest.name} ${closest.units}`;
      this.applySelectedProduct(index, closest);
    }
  }

  onProductIdChange(i: number, nameId: number | null) {
    const selected = this.nameOptions.find(n => n.id === nameId!);
    const product = this.products[i];

    if (!selected) {
      product.productName = '';
      product.searchText = '';
      product.category = '';
      product.units = '';
      product.dbBarcode = '';
      product.mrp = 0;
      product.expiryDays = 1;
      product.expiryDate = this.getTodayLocalDate();
      product.barcode = '';
      return;
    }

    product.searchText = `${selected.name} ${selected.units}`;
    this.applySelectedProduct(i, selected);
  }

  private applySelectedProduct(i: number, selected: any) {
    const product = this.products[i];

    product.nameId = selected.id;
    product.productName = `${selected.name} ${selected.units}`;
    product.searchText = `${selected.name} ${selected.units}`;
    product.category = selected.type
      ? selected.type.charAt(0).toUpperCase() + selected.type.slice(1)
      : '';
    product.units = selected.units;
    product.dbBarcode = selected.barcode;

    product.mrp = selected.mrp ?? 0;
    product.mrpEdited = false;

    product.expiryDays = selected.expiryDays ?? 1;
    product.expiryEdited = false;

    const packed = new Date(this.packedOnDate);
    packed.setDate(packed.getDate() + product.expiryDays);
    product.expiryDate = packed.toISOString().split('T')[0];

    this.generateBarcode(product);
  }

  onMrpChange(index: number) {
    this.products[index].mrpEdited = true;
    this.generateBarcode(this.products[index]);
  }

  onExpiryChange(index: number) {
    this.products[index].expiryEdited = true;
    this.updateExpiry(index);
  }

  private getTodayLocalDate(): string {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  resetForm() {
    this.packedOnDate = this.getTodayLocalDate();
    this.products = [];
    this.addRow();
    this.cdRef.detectChanges();
  }

  removeRow(index: number) {
    this.products.splice(index, 1);
    if (this.products.length === 0) {
      this.addRow();
    }
  }

  updateExpiry(index: number) {
    const today = new Date(this.packedOnDate);
    const expiry = new Date(today);
    expiry.setDate(today.getDate() + Number(this.products[index].expiryDays));
    this.products[index].expiryDate = expiry.toISOString().substring(0, 10);
  }

  onPackedOnChange() {
    this.products.forEach((p) => {
      const packed = new Date(this.packedOnDate);
      packed.setDate(packed.getDate() + Number(p.expiryDays));
      p.expiryDate = packed.toISOString().substring(0, 10);
      this.generateBarcode(p);
    });

    this.cdRef.detectChanges();
  }

  generateBarcode(product: any) {
    if (!product.category || product.mrp == null) return;

    const isVegetable = product.category.toLowerCase() === 'vegetable';
    const prefix = isVegetable ? '953779' : '95378';
    const paise = Math.round(product.mrp * 100);

    product.barcode = `${prefix}0000${paise}`;
  }

  trackByIndex(index: number): number {
    return index;
  }

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
    const items = this.products
      .filter(p => p.quantity > 0 && p.productName && p.mrp > 0 && p.barcode)
      .map(p => ({
        nameId: p.nameId,
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

  private getBarcodeDataUrl(barcode: string): string {
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

    return canvas.toDataURL('image/png');
  }

  printSelected() {
    this.preparePrintItems();

    try {
      const payload = this.buildJobPayload();

      this.labelPrints.savePrintJob(payload).subscribe({
        next: () => { },
        error: (e) => console.error('Failed to log print job:', e),
      });

      const htmlPayload = {
        labelsHtml: this.printItems.map((p) => this.generateSingleLabelHTML(p)),
        copies: 1,
      };

      const electron = (window as any).electron;

      if (!electron || typeof electron.printDmart38x25 !== 'function') {
        alert('Electron print API not available.');
        return;
      }

      electron.printDmart38x25(htmlPayload).then((result: any) => {
        if (!result?.ok) {
          alert(result?.error || 'Print failed');
        }
      });
    } catch (e) {
      console.error('Failed to print:', e);
    }
  }

  testPreview() {
    this.preparePrintItems();

    const previewWin = window.open('', '_blank');
    if (!previewWin) {
      alert('Popup blocked. Please allow popups for this site.');
      return;
    }

    previewWin.document.open();
    previewWin.document.write(this.generatePrintHTML());
    previewWin.document.close();
    previewWin.focus();
  }

  private preparePrintItems() {
    this.printItems = [];
    this.products.forEach((p) => {
      if (p.quantity > 0 && p.productName && p.mrp > 0 && p.barcode) {
        for (let i = 0; i < p.quantity; i++) {
          this.printItems.push({ ...p });
        }
      }
    });
    this.cdRef.detectChanges();
  }

  private generatePrintHTML(): string {
    const head = `
      <meta charset="UTF-8">
      <meta name="viewport" content="width=304, initial-scale=1.0">
      <title>Dmart Label</title>
    `;

    const dmartStyles = `
      html, body {
        margin: 0;
        padding: 0;
        width: 304px;
        height: 188px;
        overflow: hidden;
        background: #ffffff;
      }

      .print-section {
        width: 304px;
        height: 188px;
        margin: 0;
        padding: 0;
        background: #ffffff;
        overflow: hidden;
      }

      .dmart-label {
        position: relative;
        width: 312px;
        height: 196px;
        box-sizing: border-box;
        padding: 4px 8px 3px 10px;
        font-family: Arial, sans-serif;
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        text-align: left;
        line-height: 1.02;
        overflow: hidden;
        background: #ffffff;
      }

      .label-product {
        font-size: 18px;
        text-align: left;
        width: 252px;
        margin: 1px 0 1px 0;
        padding-left: 2px;
        box-sizing: border-box;
        line-height: 1.0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .dmart-label img {
        width: 225px;
        height: 46px;
        margin: 1px 0 1px 2px;
        display: block;
        object-fit: fill;
      }

      .barcode-value {
        font-size: 18px;
        text-align: left;
        width: 252px;
        letter-spacing: 1px;
        padding-left: 2px;
        box-sizing: border-box;
        margin: 0 0 1px 0;
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
      }

      .info-row {
        display: flex;
        justify-content: space-between;
        width: 252px;
        font-size: 16px;
        margin: 0;
        padding-left: 2px;
        box-sizing: border-box;
        line-height: 1.0;
        white-space: nowrap;
        gap: 6px;
      }

      .info-left {
        font-weight: normal;
        font-size: 16px;
        text-align: left;
      }

      .price-value {
        font-size: 16px;
        font-weight: bold;
        text-align: left;
      }

      .label-footer {
        font-size: 12px;
        text-align: left;
        width: 252px;
        margin-top: 1px;
        padding-left: 2px;
        box-sizing: border-box;
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .side-brand {
        position: absolute;
        right: 6px;
        top: 58px;
        transform: rotate(-90deg);
        transform-origin: center;
        font-size: 21px;
        font-weight: bold;
        line-height: 1;
        white-space: nowrap;
        width: 86px;
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

  private generateSingleLabelHTML(item: any): string {
    const originalItems = this.printItems;
    this.printItems = [item];
    const html = this.generatePrintHTML();
    this.printItems = originalItems;
    return html;
  }

  private generateDmartBody(): string {
    const formatDate = (dateStr: string) => {
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
          <div class="label-product">${p.productName}</div>
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

  private async renderBarcodesInWindow(win: Window) {
    const promises: Promise<void>[] = [];

    this.printItems.forEach((p, i) => {
      const imgId = `dmart-bar-${i}`;
      const imgEl = win.document.getElementById(imgId) as HTMLImageElement;

      if (!imgEl || !p.barcode) return;

      const canvas = document.createElement('canvas');

      try {
        bwipjs.toCanvas(canvas, {
          bcid: 'code128',
          text: p.barcode,
          scale: 1.6,
          height: 8,
          includetext: false,
          textxalign: 'center',
          backgroundcolor: 'FFFFFF',
        });

        const dataUrl = canvas.toDataURL('image/png');

        const loadPromise = new Promise<void>((resolve, reject) => {
          imgEl.onload = () => resolve();
          imgEl.onerror = () => reject();
          imgEl.src = dataUrl;
        });

        promises.push(loadPromise);
      } catch (e) {
        console.error('bwip-js render error:', e);
      }
    });

    await Promise.all(promises);
  }

  printAllBarcodesTest() {
    if (!this.nameOptions || this.nameOptions.length === 0) {
      alert('Names not loaded yet. Please wait a moment.');
      return;
    }

    this.printItems = this.nameOptions
      .map((n) => {
        const category = n.type
          ? n.type.charAt(0).toUpperCase() + n.type.slice(1)
          : '';

        const expiryDays = n.expiryDays ?? 1;

        const packed = new Date(this.packedOnDate);
        packed.setDate(packed.getDate() + expiryDays);
        const expiryDate = packed.toISOString().split('T')[0];

        const item: any = {
          nameId: n.id,
          productName: `${n.name} ${n.units}`,
          searchText: `${n.name} ${n.units}`,
          filteredOptions: [...this.nameOptions],
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
      })
      .filter(p => p.productName && p.mrp > 0 && p.barcode);

    if (this.printItems.length === 0) {
      alert('No valid items to print.');
      return;
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;

    doc.open();
    doc.write(this.generatePrintHTML());
    doc.close();

    iframe.onload = () => {
      this.renderBarcodesInWindow(iframe.contentWindow as Window).then(() => {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();

        setTimeout(() => {
          document.body.removeChild(iframe);
        }, 1000);
      });
    };
  }
}