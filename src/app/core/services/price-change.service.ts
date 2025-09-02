// src/app/core/services/price-change.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

@Injectable({ providedIn: 'root' })
export class PriceChangeService {
  private baseUrl = 'http://localhost:3001';
  constructor(private http: HttpClient) {}

  sendEmail(payload: {
    to: string[];            // recipients
    subject: string;
    message: string;
    filename: string;        // e.g. 'New Product Price Change.xlsx'
    fileBase64: string;      // xlsx content (base64, no data: prefix)
  }) {
    return this.http.post(`${this.baseUrl}/email/price-change`, payload);
  }
}