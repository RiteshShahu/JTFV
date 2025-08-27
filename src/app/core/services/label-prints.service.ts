import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';

const API_BASE =
  (window as any).__APP_API__ ||                 // allow override if you ever inject it
  'http://localhost:3001';                       // <-- DEV server port for Express

@Injectable({ providedIn: 'root' })
export class LabelPrintsService {
  private base = `${API_BASE}/api/label-prints`; // <-- absolute URL

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
    // helpful logging so you can see what’s being posted
    console.log('POST /api/label-prints payload:', payload);
    return this.http.post<{ jobId: number; createdAt: string; totalLabels: number }>(this.base, payload);
  }

  getRecentJobs(days = 7) {
    return this.http.get<any[]>(`${this.base}?days=${days}`);
  }

  getJobItems(jobId: number) {
    return this.http.get<any[]>(`${this.base}/${jobId}/items`);
  }

  // src/app/core/services/label-prints.service.ts
  getAllJobs() {
    return this.http.get<any[]>(`${this.base}/all`);
  }

  getJobsByDate(date: string, field: 'createdAt'|'packedOnDate' = 'createdAt') {
    return this.http.get<any[]>(`${this.base}/by-date?date=${encodeURIComponent(date)}&field=${field}`);
  }
}
