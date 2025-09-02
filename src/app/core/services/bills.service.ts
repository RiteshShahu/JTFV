import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class BillsService {

  constructor(private http: HttpClient) {}

  // ✅ Return clients from the backend
  getClients(): Observable<any[]> {
    return this.http.get<any[]>('http://localhost:3001/api/clients');
  }

  saveBill(billData: any): Observable<any> {
    return this.http.post('http://localhost:3001/api/bills', billData);
  }
  
  getLatestBillNumber(): Observable<{ billNumber: string }> {
    return this.http.get<{ billNumber: string }>('http://localhost:3001/api/bills/latest');
  }

  sendBillByEmail(billData: any): Observable<any> {
    return this.http.post('http://localhost:3001/api/send-bill', billData);
  }

  getAllBills(): Observable<any[]> {
    return this.http.get<any[]>('http://localhost:3001/api/bills');
  }
  
  getBillById(id: number): Observable<any> {
    return this.http.get<any>(`http://localhost:3001/api/bills/${id}`);
  }
  
  getBillByNumber(billNumber: string): Observable<any> {
    return this.http.get<any>(`http://localhost:3001/api/bills/${billNumber}`);
  }
  
  updateBill(billNumber: string, billData: any): Observable<any> {
    return this.http.put(`http://localhost:3001/api/bills/${billNumber}`, billData);
  }
  
  deleteBill(billNumber: string): Observable<any> {
    return this.http.delete(`http://localhost:3001/api/bills/${billNumber}`);
  }

  billExists(billNumber: string) {
    return this.http.get<boolean>('http://localhost:3001/api/bills/exists', { params: { billNumber }});
  }
}
