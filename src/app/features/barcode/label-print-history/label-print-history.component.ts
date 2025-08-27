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

  constructor(private api: LabelPrintsService) {}

  ngOnInit(): void {
    this.load();
  }

  load() {
    this.loading = true;
    this.expandedDate = null;
    this.expandedJobId = null;
    this.items = [];

    // 👇 show ALL jobs
    this.api.getAllJobs().subscribe({
      next: (rows) => {
        this.allJobs = Array.isArray(rows) ? rows : [];
        this.groups = this.groupByDay(this.allJobs, this.field);
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
    this.groups = this.groupByDay(this.allJobs, this.field);
  }

  private groupByDay(rows: any[], field: FieldFilter): GroupedDay[] {
    const map = new Map<string, { jobs: any[]; totalLabels: number }>();

    for (const j of rows) {
      const key =
        field === 'createdAt'
          ? this.toYMDinIST(j.createdAt)
          : (j.packedOnDate || '');

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
      // Ascending by day: 23-08-2025, then 24-08-2025, etc.
      .sort((a, b) => b.date.localeCompare(a.date));
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
      error: (e) => {
        console.error('Failed to load items:', e);
        this.items = [];
      },
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
    const options: Intl.DateTimeFormatOptions = {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
    };
    const parts = new Intl.DateTimeFormat('en-GB', options).formatToParts(date);
    const day = parts.find(p => p.type === 'day')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const year = parts.find(p => p.type === 'year')?.value;
    const hour = parts.find(p => p.type === 'hour')?.value;
    const minute = parts.find(p => p.type === 'minute')?.value;
    const dayPeriod = (parts.find(p => p.type === 'dayPeriod')?.value || '').toUpperCase();
    return `${day}-${month}-${year} , at ${hour}:${minute}${dayPeriod}`;
  }

  // amounts
  private toNum(v: any): number { const n = Number(v); return isFinite(n) ? n : 0; }
  rowTotal(r: any): number { return this.toNum(r.mrp) * this.toNum(r.quantity); }
  rowFinalWithMargin(r: any): number { return this.rowTotal(r) * 0.85; }
  grandFinalWithMargin(): number { return (this.items || []).reduce((s, r) => s + this.rowFinalWithMargin(r), 0); }
  grandTotal(): number { return (this.items || []).reduce((s, r) => s + this.rowTotal(r), 0); }
  isReliance(job: any): boolean { return (job?.printStyle || '').toLowerCase() === 'reliance'; }
}