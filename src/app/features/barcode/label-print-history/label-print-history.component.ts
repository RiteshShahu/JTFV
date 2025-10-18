import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { Observable, of, BehaviorSubject, combineLatest, switchMap, map, startWith, tap } from 'rxjs';
import {
  LabelPrintsService,
  DaySummary,
  JobRow,
  ItemRow,
  FieldFilter,
  PrintStyle, // <-- use the shared type from the service
} from 'src/app/core/services/label-prints.service';
import { ProductService, Name } from 'src/app/core/services/products.service';

@Component({
  selector: 'app-label-print-history',
  templateUrl: './label-print-history.component.html',
  styleUrls: ['./label-print-history.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LabelPrintHistoryComponent implements OnInit {
  field: FieldFilter = 'packedOnDate';
  styleFilter: '' | PrintStyle = ''; // <-- typed via shared PrintStyle

  // inputs (YYYY-MM-DD)
  dateFrom: string | null = null;
  dateTo: string | null = null;

  // product selector state
  products$: Observable<Name[]> = of([]);
  productsList: Name[] = [];
  selectedNameId: number | null = null; // prefer ID to avoid name collisions
  typedProductName = '';                // fallback (if no ID chosen)

  // state
  loading = false;
  expandedDate: string | null = null;
  expandedJobId: number | null = null;

  // view-model streams
  summaries$: Observable<DaySummary[]> = of([]);
  jobsForDay$: Observable<JobRow[]> = of([]);
  itemsForJob$: Observable<ItemRow[]> = of([]);

  // calculated totals for the product + date range
  productTotals$: Observable<{ totalLabels: number; totalMrp: number; finalAmount: number } | null> = of(null);

  // triggers
  private productChanged$ = new BehaviorSubject<void>(undefined);
  private datesOrFieldChanged$ = new BehaviorSubject<void>(undefined);

  constructor(private api: LabelPrintsService, private productApi: ProductService) {}

  onStyleChange() {
    // Only totals are filtered by style as requested
    this.productChanged$.next();
  }

  ngOnInit(): void {
    this.setDefaultRangeLastMonthToToday();

    // Load products list for the dropdown and also keep a local copy for labels
    this.products$ = this.productApi.getNames().pipe(
      startWith([] as Name[]),
      tap(list => (this.productsList = list))
    );

    this.reloadSummary();

    // Wire the product totals stream
    this.productTotals$ = combineLatest([
      this.productChanged$,
      this.datesOrFieldChanged$,
    ]).pipe(
      switchMap(() => {
        if (!this.dateFrom || !this.dateTo) return of(null);

        const byId = this.selectedNameId != null;
        const byName = !!this.typedProductName?.trim();
        if (!byId && !byName) return of(null);

        return this.api.getProductTotals(
          this.dateFrom, this.dateTo, this.field,
          byId
            ? { nameId: this.selectedNameId!, printStyle: this.styleFilter || undefined }
            : { productName: this.typedProductName.trim(), printStyle: this.styleFilter || undefined }
        );
      }),
      map(r => r ? ({ totalLabels: r.totalLabels, totalMrp: r.totalMrp, finalAmount: r.finalAmount }) : null)
    );
  }

  // Helpful computed label for the totals chip
  get selectedProductLabel(): string {
    if (this.selectedNameId != null) {
      const p = this.productsList.find(x => x.id === this.selectedNameId);
      if (p) return p.units ? `${p.name} (${p.units})` : p.name;
    }
    return this.typedProductName || '';
  }

  // ---------- Defaults / helpers ----------
  private setDefaultRangeLastMonthToToday(): void {
    const todayYMD = this.todayYMDinIST();
    const { y, m, d } = this.splitYMD(todayYMD);
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? y - 1 : y;
    const lastDayPrevMonth = this.daysInMonth(prevY, prevM);
    const prevD = Math.min(d, lastDayPrevMonth);
    this.dateFrom = this.joinYMD(prevY, prevM, prevD);
    this.dateTo = todayYMD;
  }

  private splitYMD(ymd: string) {
    const [ys, ms, ds] = ymd.split('-');
    return { y: +ys, m: +ms, d: +ds };
  }
  private joinYMD(y: number, m: number, d: number) {
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }
  private daysInMonth(y: number, m: number) {
    return new Date(y, m, 0).getDate();
  }
  private todayYMDinIST(): string { return this.toYMDinIST(new Date().toISOString()); }
  toYMDinIST(iso: string): string {
    if (!iso) return '';
    const date = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const y = parts.find(p => p.type === 'year')?.value || '';
    const m = parts.find(p => p.type === 'month')?.value || '';
    const d = parts.find(p => p.type === 'day')?.value || '';
    return `${y}-${m}-${d}`;
  }

  // ---------- Data load ----------
  reloadSummary() {
    if (!this.dateFrom || !this.dateTo) return;
    this.loading = true;
    this.expandedDate = null;
    this.expandedJobId = null;

    this.summaries$ = this.api.getSummary(this.dateFrom, this.dateTo, this.field);
    this.loading = false;

    // Also refresh the product totals when date/field changes
    this.datesOrFieldChanged$.next();
  }

  onFieldChange() { this.reloadSummary(); }
  onDateChange() { this.reloadSummary(); }

  // product selector handlers
  onSelectNameId(id: number | null) {
    this.selectedNameId = id ?? null;
    this.productChanged$.next();
  }
  onTypedProductNameChange() {
    // Clear nameId when manually typing, to avoid ambiguity
    this.selectedNameId = null;
    this.productChanged$.next();
  }

  // ---------- Expanders ----------
  toggleDay(date: string) {
    this.itemsForJob$ = of([]);
    this.expandedJobId = null;

    if (this.expandedDate === date) {
      this.expandedDate = null;
      this.jobsForDay$ = of([]);
      return;
    }
    this.expandedDate = date;
    this.jobsForDay$ = this.api.getJobsForDay(date, this.field);
  }

  toggleItems(job: JobRow) {
    if (this.expandedJobId === job.id) {
      this.expandedJobId = null;
      this.itemsForJob$ = of([]);
      return;
    }
    this.expandedJobId = job.id;
    this.itemsForJob$ = this.api.getJobItems(job.id);
  }

  // ---------- Formatters ----------
  formatDDMMYYYY(ymd: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '';
    const [y, m, d] = ymd.split('-');
    return `${d}-${m}-${y}`;
  }
  formatDateTime(iso: string): string {
    if (!iso) return '';
    const date = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
    }).formatToParts(date);
    const get = (t: string) => parts.find(p => p.type === t)?.value || '';
    return `${get('day')}-${get('month')}-${get('year')} , at ${get('hour')}:${get('minute')}${(get('dayPeriod') || '').toUpperCase()}`;
  }

  // ---------- Totals (row helpers for items table) ----------
  private toNum(v: any): number { const n = Number(v); return isFinite(n) ? n : 0; }
  rowTotal(r: ItemRow): number { return this.toNum(r.mrp) * this.toNum(r.quantity); }
  rowFinalWithMargin(r: ItemRow): number { return this.rowTotal(r) * 0.85; }
  grandFinalWithMargin(items: ItemRow[] = []): number { return items.reduce((s, r) => s + this.rowFinalWithMargin(r), 0); }
  grandTotal(items: ItemRow[] = []): number { return items.reduce((s, r) => s + this.rowTotal(r), 0); }
  isReliance(job: JobRow): boolean { return (job?.printStyle || '').toLowerCase() === 'reliance'; }

  // ---------- trackBy ----------
  trackByDate = (_: number, g: DaySummary) => g.date;
  trackByJob  = (_: number, j: JobRow)     => j.id;
  trackByItem = (_: number, r: ItemRow)    => r.id ?? `${r.barcode}-${r.mrp}-${r.quantity}`;
}