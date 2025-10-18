import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';

const API_BASE =
  (window as any).__APP_API__ ||
  'http://localhost:3001';

export type DayTotalsRow = {
  date: string;
  totalLabels: number;
  totalMrp: number;
};

export type PrintStyle = 'reliance' | 'dmart';

/** ✅ Export the shapes used by component & service */
export type FieldFilter = 'createdAt' | 'packedOnDate';

export interface DaySummary {
  date: string;        // YYYY-MM-DD
  jobCount: number;
  totalLabels: number;
  totalMrp: number;
  finalAmount: number; // 0.85 * totalMrp
}

export interface JobRow {
  id: number;
  createdAt: string;     // ISO
  packedOnDate: string;  // YYYY-MM-DD
  printStyle: string;
  totalLabels: number;
  totalMrp: number;
  finalAmount: number;   // 0.85 * totalMrp
}

/** (Optional) if you want a typed items call later */
export interface ItemRow {
  id: number;
  jobId: number;
  productName: string;
  units?: string | null;
  category?: string | null;
  mrp: number;
  quantity: number;
  expiryDays: number;
  expiryDate: string;
  packedOnDate: string;
  barcode: string;
}

@Injectable({ providedIn: 'root' })
export class LabelPrintsService {
  private base = `${API_BASE}/api/label-prints`;

  constructor(private http: HttpClient) {}

  savePrintJob(payload: {
    packedOnDate: string;
    printStyle: 'reliance' | 'dmart' | 'old-dmart';
    clientName?: string;
    items: Array<{
      nameId?: number;
      productName: string;
      units?: string;
      category?: string;
      mrp: number;
      quantity: number;
      expiryDays: number;
      expiryDate: string;
      barcode: string;
    }>;
  }) {
    return this.http.post<{ jobId: number; createdAt: string; totalLabels: number }>(
      this.base,
      payload
    );
  }

  getRecentJobs(days = 7) {
    return this.http.get<any[]>(`${this.base}?days=${days}`);
  }

  getJobItems(jobId: number) {
    return this.http.get<any[]>(`${this.base}/${jobId}/items`);
    // If you want typing later:
    // return this.http.get<ItemRow[]>(`${this.base}/${jobId}/items`);
  }

  getAllJobs() {
    return this.http.get<any[]>(`${this.base}/all`);
  }

  getJobsByDate(date: string, field: FieldFilter = 'createdAt') {
    return this.http.get<any[]>(
      `${this.base}/by-date?date=${encodeURIComponent(date)}&field=${field}`
    );
  }

  /** Existing totals endpoint (legacy) */
  getDayTotals(from: string, to: string, field: FieldFilter) {
    const params = new HttpParams().set('from', from).set('to', to).set('field', field);
    return this.http.get<DayTotalsRow[]>(`${this.base}/day-totals`, { params });
  }

  /** ✅ New aggregated summary endpoint */
  getSummary(from: string, to: string, field: FieldFilter) {
    const params = new HttpParams().set('from', from).set('to', to).set('field', field);
    return this.http.get<DaySummary[]>(`${this.base}/summary`, { params });
  }

  /** ✅ New jobs-by-day endpoint */
  getJobsForDay(date: string, field: FieldFilter) {
    const params = new HttpParams().set('date', date).set('field', field);
    return this.http.get<JobRow[]>(`${this.base}/jobs-by-day`, { params });
  }

  getProductTotals(
    from: string, to: string, field: FieldFilter,
    opts: { nameId?: number; productName?: string; printStyle?: PrintStyle }
  ) {
    let params = new HttpParams().set('from', from).set('to', to).set('field', field);
    if (opts.nameId != null) params = params.set('nameId', String(opts.nameId));
    if (opts.productName)    params = params.set('productName', opts.productName);
    if (opts.printStyle)     params = params.set('printStyle', opts.printStyle); // ✅ pass style
    return this.http.get<{
      from: string; to: string; field: FieldFilter;
      nameId: number | null; productName: string | null;
      totalLabels: number; totalMrp: number; finalAmount: number;
    }>(`${this.base}/product-totals`, { params });
  }
}