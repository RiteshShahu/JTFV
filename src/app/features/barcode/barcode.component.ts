import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { ProductService, Name } from 'src/app/core/services/products.service';
import bwipjs from 'bwip-js';
import { LabelPrintsService } from 'src/app/core/services/label-prints.service';
import { Router } from '@angular/router';

export type LabelStyle = 'dmart' | 'reliance' | 'old-dmart';

@Component({
  selector: 'app-barcode',
  templateUrl: './barcode.component.html',
  styleUrls: ['./barcode.component.css'],
})
export class BarcodeComponent implements OnInit {
  products: any[] = [];
  printItems: any[] = [];
  nameOptions: Name[] = [];
  packedOnDate: string = this.getTodayLocalDate();
  currentDate: string = this.getTodayLocalDate();
  selectedPrintStyle: LabelStyle = 'reliance';

  constructor(
    private cdRef: ChangeDetectorRef,
    private productService: ProductService,
    private labelPrints: LabelPrintsService,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.addRow();
    this.onPrintStyleChange(this.selectedPrintStyle);
    this.packedOnDate = this.getTodayLocalDate();

    this.productService.getNames().subscribe({
      next: (names) => {
        this.nameOptions = names.sort((a, b) =>
          (`${a.name} ${a.units}`).localeCompare(`${b.name} ${b.units}`)
        );
      },
      error: (err) => console.error('Failed to load names:', err),
    });
  }

  goToHistory() { this.router.navigate(['/label-history']); }

  onMrpKeyDown(event: KeyboardEvent, index: number) {
    if (event.key === 'Tab' && index === this.products.length - 1) {
      event.preventDefault();
      this.addRow();
      setTimeout(() => {
        const inputs = document.querySelectorAll(
          `tr:nth-child(${this.products.length + 1}) select[name^='productName']`
        );
        if (inputs.length > 0) (inputs[0] as HTMLElement).focus();
      });
    }
  }

  addRow() {
    this.products.push({
      nameId: null,
      productName: '',
      mrp: 0,
      category: '',
      quantity: 1,
      expiryDays: 1,
      expiryDate: this.currentDate,
      barcode: '',
      dbBarcode: '',
      mrpEdited: false,
      expiryEdited: false,
    });
  }

  onProductIdChange(i: number, nameId: number | null) {
    const selected = this.nameOptions.find(n => n.id === nameId!);
    const product = this.products[i];

    if (!selected) {
      product.productName = '';
      product.category = '';
      product.units = '';
      product.dbBarcode = '';
      product.mrp = 0;
      product.expiryDays = 1;
      product.expiryDate = this.getTodayLocalDate();
      product.barcode = '';
      return;
    }

    product.productName = `${selected.name} ${selected.units}`;
    product.category = selected.type
      ? selected.type.charAt(0).toUpperCase() + selected.type.slice(1)
      : '';
    product.units = selected.units;
    product.dbBarcode = selected.barcode;

    product.mrp = selected.mrp ?? 0; product.mrpEdited = false;
    product.expiryDays = selected.expiryDays ?? 1; product.expiryEdited = false;

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

  removeRow(index: number) { this.products.splice(index, 1); }

  updateExpiry(index: number) {
    const today = new Date(this.packedOnDate);
    const expiry = new Date(today);
    expiry.setDate(today.getDate() + Number(this.products[index].expiryDays));
    this.products[index].expiryDate = expiry.toISOString().substring(0, 10);
  }

  get filteredNameOptions(): Name[] {
    if (this.selectedPrintStyle === 'reliance') {
      return this.nameOptions.filter((n) => n.type?.toLowerCase() === 'vegetable');
    }
    return this.nameOptions;
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

  onProductSelect(i: number, event: Event) {
    const target = event.target as HTMLSelectElement;
    const nameId = Number(target.value);
    const selected = this.nameOptions.find((n) => n.id === nameId);
    if (!selected) return;
    const product = this.products[i];
    product.productName = `${selected.name} ${selected.units}`;
    product.category = selected.type ? selected.type.charAt(0).toUpperCase() + selected.type.slice(1) : '';
    product.units = selected.units;
    product.dbBarcode = selected.barcode;
    product.mrp = selected.mrp ?? 0; product.mrpEdited = false;
    product.expiryDays = selected.expiryDays ?? 1; product.expiryEdited = false;
    const today = new Date(this.packedOnDate);
    today.setDate(today.getDate() + product.expiryDays);
    product.expiryDate = today.toISOString().split('T')[0];
    this.generateBarcode(product);
  }

  generateBarcode(product: any) {
    if (!product.category || product.mrp == null) return;
    const isVegetable = product.category.toLowerCase() === 'vegetable';
    const prefix = isVegetable ? '953779' : '95378';
    const paise = Math.round(product.mrp * 100);
    if (this.selectedPrintStyle === 'dmart' || this.selectedPrintStyle === 'old-dmart') {
      product.barcode = `${prefix}0000${paise}`;
    } else {
      product.barcode = product.dbBarcode || '';
    }
  }

  trackByIndex(index: number): number { return index; }

  private buildJobPayload() {
    const items = this.products
      .filter(p => p.quantity > 0 && p.productName && p.mrp > 0 && p.barcode)
      .map(p => ({
        nameId: this.nameOptions.find(n => `${n.name} ${n.units}` === p.productName)?.id,
        productName: p.productName,
        units: p.units,
        category: p.category,
        mrp: Number(p.mrp),
        quantity: Number(p.quantity),
        expiryDays: Number(p.expiryDays),
        expiryDate: p.expiryDate,
        barcode: p.barcode,
      }));
    return { packedOnDate: this.packedOnDate, printStyle: this.selectedPrintStyle, items };
  }

  // 🚀 Direct printing without preview (silent if Electron bridge exists)
  async printSelected() {
    this.preparePrintItems();

    try {
      const payload = this.buildJobPayload();
      this.labelPrints.savePrintJob(payload).subscribe({ next: () => {}, error: () => {} });
    } catch {}

    const html = this.generatePrintHTML();
    const el = (window as any).electron;
    const useElectron = !!el?.printCitizen50 || !!el?.printCitizen38x25;
    console.debug('electron bridge?', !!el, 'useElectron?', useElectron);

    if (useElectron) {
      const finalizedHtml = await this.renderBarcodesIntoHtml(html); // ensures <img src="data:...">
      const dataUrl = this.htmlToDataUrl(finalizedHtml);

      try {
        let res: any;
        if (this.selectedPrintStyle === 'old-dmart' && el?.printCitizen38x25) {
          res = await el.printCitizen38x25(dataUrl, { copies: 1 });
        } else if (el?.printCitizen50) {
          res = await el.printCitizen50(dataUrl, { copies: 1 });
        }
        if (!res?.ok) {
          console.error('Electron print failed, fallback to iframe:', res?.error);
          await this.printViaIframe(finalizedHtml);
        }
        return;
      } catch (e) {
        console.error('Electron print error, falling back to iframe:', e);
        await this.printViaIframe(finalizedHtml);
        return;
      }
    }

    // Browser/dev fallback
    await this.printViaIframe(html);
  }

  // Render barcodes inside offscreen doc and return final HTML
  private async renderBarcodesIntoHtml(html: string): Promise<string> {
    return new Promise<string>((resolve) => {
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document!;
      doc.open(); doc.write(html); doc.close();

      const win = iframe.contentWindow as Window;

      const finalize = () => {
        const out = `<!DOCTYPE html><html><head>${doc.head.innerHTML}</head><body>${doc.body.innerHTML}</body></html>`;
        try { document.body.removeChild(iframe); } catch {}
        resolve(out);
      };

      iframe.onload = () => {
        this.renderBarcodesInWindow(win).then(() => {
          setTimeout(finalize, 50);
        }).catch(() => finalize());
      };

      setTimeout(() => {
        this.renderBarcodesInWindow(win).then(() => setTimeout(finalize, 50)).catch(() => finalize());
      }, 120);
    });
  }

  // Minimal iframe print (shows system dialog only in browser/dev)
  private async printViaIframe(html: string): Promise<void> {
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document!;
    doc.open(); doc.write(html); doc.close();

    return new Promise<void>((resolve) => {
      iframe.onload = () => {
        this.renderBarcodesInWindow(iframe.contentWindow as Window).then(() => {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          setTimeout(() => {
            try { document.body.removeChild(iframe); } catch {}
            resolve();
          }, 300);
        }).catch(() => {
          try { document.body.removeChild(iframe); } catch {}
          resolve();
        });
      };
    });
  }

  private preparePrintItems() {
    this.printItems = [];
    this.products.forEach((p) => {
      if (p.quantity > 0 && p.productName && p.mrp > 0) {
        for (let i = 0; i < p.quantity; i++) this.printItems.push({ ...p });
      }
    });
    this.cdRef.detectChanges();
  }

  private generatePrintHTML(): string {
    const head = `\n<meta charset="UTF-8">\n<meta name="viewport" content="width=240px">\n<title></title>`;

    const dmartStyles = `
      @media print { @page { size: 50mm 50mm; margin: 0; } body { margin: 0; padding: 0; }
      .print-section { margin: 0; padding: 6px; display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-start; } }
      .dmart-label { width: 240px; height: 189px; padding: 6px 10px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between;
        font-family: Arial, sans-serif; font-size: 10px; line-height: 1.2; text-align: left; page-break-inside: avoid; border: 1px solid transparent; position: relative; overflow: visible; }
      .barcode-row { display: flex; flex-direction: row; align-items: center; justify-content: flex-start; margin-top: 2px; gap: 4px; }
      .barcode-left { display: flex; flex-direction: column; align-items: flex-start; }
      .barcode-left .label-product { font-size: 11px; font-weight: bold; margin-bottom: 2px; text-align: left; }
      .barcode-left img { width: 160px; height: 35px; }
      .barcode-left .barcode-value { font-size: 13px; letter-spacing: 1px; text-align: center; margin-top: 2px; width: 160px; }
      .side-brand { writing-mode: vertical-rl; text-orientation: mixed; transform: rotate(180deg); font-size: 15px; font-weight: bold; color: black; padding-left: 2px; line-height: 1; }
      .label-info-row { display: flex; justify-content: space-between; margin: 2px 0; }
      .dmart-footer { text-align: center; font-size: 9px; line-height: 1.1; margin-top: 4px; }
    `;

    const oldDmartStyles = `
      @media print { @page { size: 38mm 25mm; margin: 0mm; } body, html { margin: 0 !important; padding: 0 !important; }
      .print-section { display: flex; flex-wrap: wrap; gap: 0; margin: 0; padding: 0; } }
      .dmart-label { position: relative; width: 136px; height: 94px; box-sizing: border-box; padding: 2px 3px 1px;
        font-family: Arial, sans-serif; font-size: 9px; display: flex; flex-direction: column; justify-content: flex-start; text-align: left; line-height: 1.05; overflow: hidden; }
      .label-header { font-size: 9px; text-align: center; width: 100%; margin: 0; }
      .label-product { font-size: 9px; text-align: left; width: 100%; margin: 1px 0; padding-left: 2px; }
      .dmart-label img { width: 120px; height: 30px; margin: 0 0 1px; }
      .barcode-value { font-size: 10px; text-align: left; width: 100%; letter-spacing: 1px; padding-left: 2px; margin: 0 0 1px; }
      .info-row { display: flex; justify-content: space-between; width: 100%; font-size: 9px; margin: 0; }
      .info-left { font-weight: normal; font-size: 9.5px; text-align: center; }
      .price-value { font-size: 9.5px; font-weight: bold; text-align: center; }
      .label-footer { font-size: 7px; text-align: left; width: 100%; margin-top: 1px; line-height: 1; padding-bottom: 1px; }
      .side-brand { position: absolute; right: -4px; top: 28%; transform: rotate(-90deg); transform-origin: right top; font-size: 14px; font-weight: bold; }
    `;

    const relianceStyles = `
      @media print { @page { size: 50mm 50mm; margin: 0; } body { margin: 0; padding: 0; }
      .print-section { margin: 0; padding: 6px; display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-start; } }
      .reliance-label { width: 240px; height: 189px; padding: 6px 10px; box-sizing: border-box; display: flex; flex-direction: column; justify-content: space-between;
        font-family: Arial, sans-serif; font-size: 10px; line-height: 1.2; text-align: left; page-break-inside: avoid; border: 1px solid transparent; }
      .reliance-label canvas { display: block; margin: 2px auto; width: 160px; height: 40px; }
      .barcode-value { font-size: 14px; letter-spacing: 1px; margin: 2px 0; text-align: center; }
      .label-product { font-size: 11px; font-weight: bold; margin: 2px 0; text-align: center; }
      .label-info-row { display: flex; justify-content: space-between; margin: 2px 0; }
      .reliance-footer { text-align: center; font-size: 9px; line-height: 1.1; margin-top: 4px; }
    `;

    let css = '';
    let body = '';
    switch (this.selectedPrintStyle) {
      case 'dmart': css = dmartStyles; body = this.generateDmartBody(); break;
      case 'old-dmart': css = oldDmartStyles; body = this.generateOldDmartBody(); break;
      case 'reliance':
      default: css = relianceStyles; body = this.generateRelianceBody(); break;
    }

    return `<!DOCTYPE html><html><head>${head}<style>${css}</style></head><body><div class="print-section">${body}</div></body></html>`;
  }

  private generateDmartBody(): string {
    return this.printItems
      .map((p, i) => `
        <div class="dmart-label">
          <div style="text-align:center;font-size:11px;"><b>J T FRUITS &amp; VEG</b></div>
          <div class="barcode-row">
            <div class="barcode-left">
              <div class="label-product">${p.productName}</div>
              <img id="dmart-bar-${i}" />
              <div class="barcode-value">${p.barcode}</div>
            </div>
            <div class="side-brand">Dmart</div>
          </div>
          <div style="display:flex;justify-content:space-between;"><div>M.R.P :</div><b><div>₹${p.mrp}/-</div></b></div>
          <div style="display:flex;justify-content:space-between;"><div>PACKED ON :</div><b><div>${this.packedOnDate}</div></b></div>
          <div style="display:flex;justify-content:space-between;"><div>BEST BEFORE :</div><b><div>${p.expiryDate}</div></b></div>
          <div class="dmart-footer">
            <div style="text-align:center;font-size:11px;"><b>FSSAI No. 11517011000128</b></div>
            <div style="text-align:center;font-size:10px;">Shop No. 31-32, Bldg No. 27,</div>
            <div style="text-align:center;font-size:10px;">EMP Op Jogers Park, Thakur Village,</div>
            <div style="text-align:center;font-size:10px;">Kandivali(E)</div>
            <div style="text-align:center;font-size:10px;">Customer Care No. 9594117456</div>
          </div>
        </div>`).join('');
  }

  private generateRelianceBody(): string {
    return this.printItems
      .map((p, i) => `
        <div class="reliance-label">
          <div style="text-align:center;font-size:11px;"><b>J T FRUITS &amp; VEG</b></div>
          <div style="text-align:center;font-size:12px;">${p.productName}</div>
          <img id="rel-barcode-img-${i}" style="width:180px;height:37px;" />
          <div class="barcode-value">${p.barcode}</div>
          <div style="display:flex;justify-content:space-between;"><div>M.R.P :</div><b><div>₹${p.mrp}/-</div></b></div>
          <div style="display:flex;justify-content:space-between;"><div>PACKED ON :</div><b><div>${this.packedOnDate}</div></b></div>
          <div style="display:flex;justify-content:space-between;"><div>BEST BEFORE :</div><div><b>${p.expiryDays} DAYS</b></div></div>
          <div style="text-align:center;font-size:9px;">
            <div style="text-align:center;font-size:11px;"><b>FSSAI No. 11517011000128</b></div>
            <div style="text-align:center;font-size:10px;">Shop No. 31-32, Bldg No. 27,</div>
            <div style="text-align:center;font-size:10px;">EMP Op Jogers Park, Thakur Village,</div>
            <div style="text-align:center;font-size:10px;">Kandivali(E)</div>
            <div style="text-align:center;font-size:10px;">Customer Care No. 9594117456</div>
          </div>
        </div>`).join('');
  }

  private generateOldDmartBody(): string {
    const formatDate = (dateStr: string) => {
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
            <div class="label-product">${p.productName}</div>
            <img id="dmart-bar-${i}" />
            <div class="barcode-value">${p.barcode}</div>
            <div class="info-row"><div class="info-left">M.R.P.</div><div>Pkd. On ${pkd}</div></div>
            <div class="info-row"><div class="price-value">₹${p.mrp.toFixed(2)}</div><div>Exp. Dt. ${exp}</div></div>
            <div class="label-footer">Incl. of all Taxes)</div>
          </div>`;
      }).join('');
  }

  private async renderBarcodesInWindow(win: Window) {
    const promises: Promise<void>[] = [];
    this.printItems.forEach((p, i) => {
      const imgId = this.selectedPrintStyle === 'reliance' ? `rel-barcode-img-${i}` : `dmart-bar-${i}`;
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

  onPrintStyleChange(style: LabelStyle) {
    this.selectedPrintStyle = style;
    if (style === 'reliance') {
      this.products.forEach((p) => {
        const match = this.nameOptions.find((n) => `${n.name} ${n.units}` === p.productName);
        if (!match || match.type?.toLowerCase() !== 'vegetable') {
          p.productName = ''; p.category = ''; p.barcode = ''; p.dbBarcode = '';
        }
      });
    }
    this.products.forEach((p) => this.generateBarcode(p));
    this.cdRef.detectChanges();
  }

  // Converts raw HTML to a data: URL so Electron can spool it as PDF
  private htmlToDataUrl(html: string): string {
    return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  }
}