import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class BillsService {
  private baseUrl = 'http://localhost:3001/api/bills';

  constructor(private http: HttpClient) {}

  // ✅ Return clients from the backend
  getClients(): Observable<any[]> {
    return this.http.get<any[]>('http://localhost:3001/api/clients');
  }

  saveBill(billData: any): Observable<any> {
    return this.http.post(this.baseUrl, billData);
  }
  
  getLatestBillNumber(): Observable<{ billNumber: string }> {
    return this.http.get<{ billNumber: string }>(`${this.baseUrl}/latest`);
  }

  /**
   * ✅ Send bill by email
   * Supports multiple recipients via:
   *   - billData.to: string[]   (preferred)
   *   - billData.to: string     (comma separated)
   *   - billData.email: string  (legacy single email)
   */
  sendBillByEmail(billData: {
    to?: string[] | string;
    email?: string;
    pdfHtml: string;
    subject?: string;
    filename?: string;
    billNumber?: string;
    clientName?: string;
    billDate?: string;
    totalAmount?: number;
    discount?: number;
    finalAmount?: number;
    cc?: string | string[];
    bcc?: string | string[];
    [key: string]: any;
  }): Observable<any> {
    return this.http.post('http://localhost:3001/api/send-bill', billData);
  }

  getAllBills(): Observable<any[]> {
    return this.http.get<any[]>(this.baseUrl);
  }
  
  getBillById(id: number): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/${id}`);
  }
  
  getBillByNumber(billNumber: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/${billNumber}`);
  }
  
  updateBill(billNumber: string, billData: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/${billNumber}`, billData);
  }
  
  deleteBill(billNumber: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/${billNumber}`);
  }

  billExists(billNumber: string): Observable<boolean> {
    return this.http.get<boolean>(`${this.baseUrl}/exists`, { params: { billNumber } });
  }

  markBillPaid(billNumber: string, isPaid: boolean): Observable<{ ok: boolean; billNumber: string; isPaid: boolean; paidAt?: string }> {
    return this.http.put<{ ok: boolean; billNumber: string; isPaid: boolean; paidAt?: string }>(
      `${this.baseUrl}/${encodeURIComponent(billNumber)}/paid`,
      { isPaid }
    );
  }
}