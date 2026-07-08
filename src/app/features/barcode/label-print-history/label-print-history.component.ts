import { Component, OnInit, OnDestroy, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import {
  Observable, of, BehaviorSubject, combineLatest, Subscription,
  switchMap, map, startWith, tap, catchError, shareReplay,
} from 'rxjs';
import {
  LabelPrintsService,
  DaySummary,
  JobRow,
  ItemRow,
  FieldFilter,
  PrintStyle,
} from 'src/app/core/services/label-prints.service';
import { ProductService, Name } from 'src/app/core/services/products.service';

type JobSortField = 'id' | 'createdAt' | 'packedOnDate' | 'printStyle' | 'totalLabels' | 'totalMrp' | 'finalAmount';

@Component({
  selector: 'app-label-print-history',
  templateUrl: './label-print-history.component.html',
  styleUrls: ['./label-print-history.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LabelPrintHistoryComponent implements OnInit, OnDestroy {
  field: FieldFilter = 'packedOnDate';
  styleFilter: '' | PrintStyle = '';

  dateFrom: string | null = null;
  dateTo: string | null = null;

  products$: Observable<Name[]> = of([]);
  productsList: Name[] = [];
  selectedNameId: number | null = null;
  typedProductName = '';

  loading = false;
  loadError: string | null = null;
  jobsError: string | null = null;
  jobsLoading = false;
  itemsError: string | null = null;
  expandedDate: string | null = null;
  expandedJobId: number | null = null;

  summaries: DaySummary[] = [];

  // ✅ Jobs list is now a plain array so we can sort/filter it client-side
  rawJobsForDay: JobRow[] = [];
  jobSearch = '';
  jobSortField: JobSortField = 'id';
  jobSortDir: 'asc' | 'desc' = 'desc';

  itemsForJob$: Observable<ItemRow[]> = of([]);

  productTotals$: Observable<{ totalLabels: number; totalMrp: number; finalAmount: number } | null> = of(null);

  private productChanged$ = new BehaviorSubject<void>(undefined);
  private datesOrFieldChanged$ = new BehaviorSubject<void>(undefined);
  private summarySub: Subscription | null = null;
  private jobsSub: Subscription | null = null;

  constructor(
    private api: LabelPrintsService,
    private productApi: ProductService,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnInit(): void {
    this.setDefaultRangeLastMonthToToday();

    this.products$ = this.productApi.getNames().pipe(
      map(list => [...list].sort((a, b) =>
        (`${a.name} ${a.units}`).localeCompare(`${b.name} ${b.units}`)
      )),
      tap(list => (this.productsList = list)),
      catchError(err => {
        console.error('Failed to load product list:', err);
        return of([] as Name[]);
      }),
      startWith([] as Name[]),
      shareReplay(1),
    );

    this.reloadSummary();

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
        ).pipe(
          catchError(err => {
            console.error('Failed to load product totals:', err);
            return of(null);
          })
        );
      }),
      map(r => r ? ({ totalLabels: r.totalLabels, totalMrp: r.totalMrp, finalAmount: r.finalAmount }) : null),
      shareReplay(1),
    );
  }

  ngOnDestroy(): void {
    this.summarySub?.unsubscribe();
    this.jobsSub?.unsubscribe();
  }

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
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
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

    if (this.dateFrom > this.dateTo) {
      const tmp = this.dateFrom;
      this.dateFrom = this.dateTo;
      this.dateTo = tmp;
    }

    this.loading = true;
    this.loadError = null;
    this.expandedDate = null;
    this.expandedJobId = null;
    this.rawJobsForDay = [];
    this.itemsForJob$ = of([]);
    this.cdr.markForCheck();

    this.summarySub?.unsubscribe();
    this.summarySub = this.api.getSummary(this.dateFrom, this.dateTo, this.field).subscribe({
      next: (rows) => {
        this.summaries = [...(rows || [])].sort((a, b) => b.date.localeCompare(a.date));
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to load summary:', err);
        this.summaries = [];
        this.loadError = 'Failed to load print history. Is the server running?';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });

    this.datesOrFieldChanged$.next();
  }

  onFieldChange() { this.reloadSummary(); }
  onDateChange() { this.reloadSummary(); }

  onStyleChange() {
    this.productChanged$.next();
  }

  onSelectNameId(id: number | null) {
    this.selectedNameId = id ?? null;
    this.productChanged$.next();
  }
  onTypedProductNameChange() {
    this.selectedNameId = null;
    this.productChanged$.next();
  }

  // ---------- Day expand / job list ----------
  toggleDay(date: string) {
    this.itemsForJob$ = of([]);
    this.expandedJobId = null;
    this.jobsError = null;
    this.jobSearch = '';
    this.jobSortField = 'id';
    this.jobSortDir = 'desc';

    if (this.expandedDate === date) {
      this.expandedDate = null;
      this.rawJobsForDay = [];
      return;
    }
    this.expandedDate = date;
    this.jobsLoading = true;
    this.rawJobsForDay = [];
    this.cdr.markForCheck();

    this.jobsSub?.unsubscribe();
    this.jobsSub = this.api.getJobsForDay(date, this.field).subscribe({
      next: (jobs) => {
        this.rawJobsForDay = jobs || [];
        this.jobsLoading = false;
        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to load jobs for day:', err);
        this.jobsError = 'Failed to load jobs for this day.';
        this.rawJobsForDay = [];
        this.jobsLoading = false;
        this.cdr.markForCheck();
      },
    });

    this.scrollTo(`day-${date}`);
  }

  /** Sorted + filtered view of the current day's jobs (computed on demand) */
  get jobsForDayView(): JobRow[] {
    let list = this.rawJobsForDay;

    const term = this.jobSearch.trim().toLowerCase();
    if (term) {
      list = list.filter(j => {
        const hay = [
          String(j.id),
          j.printStyle,
          j.packedOnDate,
          this.formatDDMMYYYY(j.packedOnDate),
          this.formatDateTime(j.createdAt),
        ].join(' ').toLowerCase();
        return hay.includes(term);
      });
    }

    const field = this.jobSortField;
    const dir = this.jobSortDir === 'asc' ? 1 : -1;

    return [...list].sort((a, b) => {
      const av = (a as any)[field];
      const bv = (b as any)[field];
      if (typeof av === 'string' && typeof bv === 'string') {
        return av.localeCompare(bv) * dir;
      }
      return ((Number(av) || 0) - (Number(bv) || 0)) * dir;
    });
  }

  get jobsViewTotals() {
    const list = this.jobsForDayView;
    return {
      count: list.length,
      totalLabels: list.reduce((s, j) => s + (j.totalLabels || 0), 0),
      totalMrp: list.reduce((s, j) => s + (j.totalMrp || 0), 0),
      finalAmount: list.reduce((s, j) => s + (j.finalAmount || 0), 0),
    };
  }

  setJobSort(field: JobSortField) {
    if (this.jobSortField === field) {
      this.jobSortDir = this.jobSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.jobSortField = field;
      this.jobSortDir = 'desc';
    }
  }

  clearJobSearch() {
    this.jobSearch = '';
  }

  // ---------- Item expand ----------
  toggleItems(job: JobRow) {
    this.itemsError = null;

    if (this.expandedJobId === job.id) {
      this.expandedJobId = null;
      this.itemsForJob$ = of([]);
      return;
    }
    this.expandedJobId = job.id;
    this.itemsForJob$ = this.api.getJobItems(job.id).pipe(
      catchError(err => {
        console.error('Failed to load job items:', err);
        this.itemsError = 'Failed to load items for this job.';
        this.cdr.markForCheck();
        return of([] as ItemRow[]);
      }),
      shareReplay(1),
    );

    this.scrollTo(`job-${job.id}`);
  }

  private scrollTo(elementId: string): void {
    setTimeout(() => {
      document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
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

  // ---------- Totals ----------
  private toNum(v: any): number { const n = Number(v); return isFinite(n) ? n : 0; }
  rowTotal(r: ItemRow): number { return this.toNum(r.mrp) * this.toNum(r.quantity); }
  rowFinalWithMargin(r: ItemRow): number { return this.rowTotal(r) * 0.85; }
  grandFinalWithMargin(items: ItemRow[] = []): number { return items.reduce((s, r) => s + this.rowFinalWithMargin(r), 0); }
  grandTotal(items: ItemRow[] = []): number { return items.reduce((s, r) => s + this.rowTotal(r), 0); }
  isReliance(job: JobRow): boolean { return (job?.printStyle || '').toLowerCase() === 'reliance'; }

  // ---------- trackBy ----------
  trackByDate = (_: number, g: DaySummary) => g.date;
  trackByJob = (_: number, j: JobRow) => j.id;
  trackByItem = (_: number, r: ItemRow) => r.id ?? `${r.barcode}-${r.mrp}-${r.quantity}`;
}