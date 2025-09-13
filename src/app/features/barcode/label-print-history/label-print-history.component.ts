import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { Observable, of } from 'rxjs';
import { LabelPrintsService, DaySummary, JobRow, ItemRow, FieldFilter } from 'src/app/core/services/label-prints.service';

@Component({
  selector: 'app-label-print-history',
  templateUrl: './label-print-history.component.html',
  styleUrls: ['./label-print-history.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LabelPrintHistoryComponent implements OnInit {
  field: FieldFilter = 'packedOnDate';

  // inputs (YYYY-MM-DD)
  dateFrom: string | null = null;
  dateTo: string | null = null;

  // state
  loading = false;
  expandedDate: string | null = null;
  expandedJobId: number | null = null;

  // view-model streams
  summaries$: Observable<DaySummary[]> = of([]);
  jobsForDay$: Observable<JobRow[]> = of([]);
  itemsForJob$: Observable<ItemRow[]> = of([]);

  constructor(private api: LabelPrintsService) {}

  ngOnInit(): void {
    this.setDefaultRangeLastMonthToToday();
    this.reloadSummary();
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
    return new Date(y, m, 0).getDate(); // m is 1-12 here
  }

  private todayYMDinIST(): string {
    return this.toYMDinIST(new Date().toISOString());
  }
  toYMDinIST(iso: string): string {
    if (!iso) return '';
    const date = new Date(iso);
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
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
    // Spinner is local only; the async pipe controls rendering readiness
    this.loading = false;
  }

  onFieldChange() {
    this.reloadSummary();
  }

  onDateChange() {
    this.reloadSummary();
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
  grandFinalWithMargin(items: ItemRow[] = []): number {
    return items.reduce((s, r) => s + this.rowFinalWithMargin(r), 0);
  }
  grandTotal(items: ItemRow[] = []): number {
    return items.reduce((s, r) => s + this.rowTotal(r), 0);
  }

  isReliance(job: JobRow): boolean {
    return (job?.printStyle || '').toLowerCase() === 'reliance';
  }

  // ---------- trackBy ----------
  trackByDate = (_: number, g: DaySummary) => g.date;
  trackByJob  = (_: number, j: JobRow)     => j.id;
  trackByItem = (_: number, r: ItemRow)    => r.id ?? `${r.barcode}-${r.mrp}-${r.quantity}`;
}