import { Component, OnInit } from '@angular/core';
import { LabelPrintsService } from 'src/app/core/services/label-prints.service';

type FieldFilter = 'createdAt' | 'packedOnDate';
type GroupedDay = { date: string; jobs: any[]; totalLabels: number };

@Component({
  selector: 'app-label-print-history',
  templateUrl: './label-print-history.component.html',
  styleUrls: ['./label-print-history.component.css'],
})
export class LabelPrintHistoryComponent implements OnInit {
  field: FieldFilter = 'packedOnDate';

  loading = false;
  allJobs: any[] = [];
  groups: GroupedDay[] = [];

  expandedDate: string | null = null;
  expandedJobId: number | null = null;
  items: any[] = [];

  // YYYY-MM-DD for <input type="date">
  dateFrom: string | null = null;
  dateTo: string | null = null;

  constructor(private api: LabelPrintsService) {}

  ngOnInit(): void {
    // set default: last month same day -> today (both in IST)
    this.setDefaultRangeLastMonthToToday();
    this.load();
  }

  // --- Defaults / Quick helpers ------------------------------------------------
  private setDefaultRangeLastMonthToToday(): void {
    const todayYMD = this.todayYMDinIST();
    const { y, m, d } = this.splitYMD(todayYMD);

    // previous month (clamp day to last day of that month)
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? y - 1 : y;
    const lastDayPrevMonth = this.daysInMonth(prevY, prevM);
    const prevD = Math.min(d, lastDayPrevMonth);

    this.dateFrom = this.joinYMD(prevY, prevM, prevD); // e.g., 2025-08-05
    this.dateTo   = todayYMD;                           // e.g., 2025-09-05
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

  // today's Y-M-D in IST
  private todayYMDinIST(): string {
    return this.toYMDinIST(new Date().toISOString());
  }
  // 'YYYY-MM-DD' in IST for an ISO instant
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

  // --- Data load / filtering ---------------------------------------------------
  load() {
    this.loading = true;
    this.expandedDate = null;
    this.expandedJobId = null;
    this.items = [];

    this.api.getAllJobs().subscribe({
      next: (rows) => {
        this.allJobs = Array.isArray(rows) ? rows : [];
        const filtered = this.applyRangeFilter(this.allJobs, this.field, this.dateFrom, this.dateTo);
        this.groups = this.groupByDay(filtered, this.field);
        this.loading = false;
      },
      error: (e) => {
        console.error('Failed to load jobs:', e);
        this.allJobs = [];
        this.groups = [];
        this.loading = false;
      },
    });
  }

  onFieldChange() {
    this.expandedDate = null;
    this.expandedJobId = null;
    this.items = [];
    const filtered = this.applyRangeFilter(this.allJobs, this.field, this.dateFrom, this.dateTo);
    this.groups = this.groupByDay(filtered, this.field);
  }

  // inclusive filter over [from..to] in chosen field (IST YMD)
  private applyRangeFilter(rows: any[], field: FieldFilter, from?: string | null, to?: string | null): any[] {
    let f = (from || '').trim();
    let t = (to || '').trim();
    if (f && t && f > t) [f, t] = [t, f]; // normalize

    if (!f && !t) return rows;

    return rows.filter(j => {
      const key = field === 'createdAt'
        ? this.toYMDinIST(j.createdAt)
        : (j.packedOnDate || '');
      if (!key) return false;
      if (f && key < f) return false;
      if (t && key > t) return false;
      return true;
    });
  }

  onDateChange() {
    const filtered = this.applyRangeFilter(this.allJobs, this.field, this.dateFrom, this.dateTo);
    this.groups = this.groupByDay(filtered, this.field);
    this.expandedDate = null;
    this.expandedJobId = null;
    this.items = [];
  }

  clearRange() {
    // restore default last-month→today instead of blanking
    this.setDefaultRangeLastMonthToToday();
    this.onDateChange();
  }

  private groupByDay(rows: any[], field: FieldFilter): GroupedDay[] {
    const map = new Map<string, { jobs: any[]; totalLabels: number }>();
    for (const j of rows) {
      const key = field === 'createdAt' ? this.toYMDinIST(j.createdAt) : (j.packedOnDate || '');
      if (!key) continue;
      if (!map.has(key)) map.set(key, { jobs: [], totalLabels: 0 });
      const bucket = map.get(key)!;
      bucket.jobs.push(j);
      bucket.totalLabels += Number(j.totalLabels) || 0;
    }
    return Array.from(map.entries())
      .map(([date, v]) => ({
        date,
        jobs: v.jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
        totalLabels: v.totalLabels,
      }))
      .sort((a, b) => b.date.localeCompare(a.date)); // newest day first
  }

  toggleDay(date: string) {
    this.items = [];
    this.expandedJobId = null;
    this.expandedDate = this.expandedDate === date ? null : date;
  }

  toggleItems(job: any) {
    if (this.expandedJobId === job.id) {
      this.expandedJobId = null;
      this.items = [];
      return;
    }
    this.expandedJobId = job.id;
    this.items = [];
    this.api.getJobItems(job.id).subscribe({
      next: (rows) => (this.items = rows || []),
      error: (e) => { console.error('Failed to load items:', e); this.items = []; },
    });
  }

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

  // amounts
  private toNum(v: any): number { const n = Number(v); return isFinite(n) ? n : 0; }
  rowTotal(r: any): number { return this.toNum(r.mrp) * this.toNum(r.quantity); }
  rowFinalWithMargin(r: any): number { return this.rowTotal(r) * 0.85; }
  grandFinalWithMargin(): number { return (this.items || []).reduce((s, r) => s + this.rowFinalWithMargin(r), 0); }
  grandTotal(): number { return (this.items || []).reduce((s, r) => s + this.rowTotal(r), 0); }
  isReliance(job: any): boolean { return (job?.printStyle || '').toLowerCase() === 'reliance'; }
}