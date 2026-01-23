// src/app/core/services/price-change.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';

export type PriceChangeEmailPayload = {
  to: string[];                 // recipients
  subject: string;

  // Backward compatibility
  message?: string;             // plain text fallback (OLD)

  // New (for table-style email)
  text?: string;                // plain text version
  html?: string;                // HTML table email body

  filename: string;             // e.g. 'New Product Price Change.xlsx'
  fileBase64: string;           // xlsx content (base64, no data: prefix)
};

@Injectable({ providedIn: 'root' })
export class PriceChangeService {
  private baseUrl = 'http://localhost:3001';

  constructor(private http: HttpClient) {}

  sendEmail(payload: PriceChangeEmailPayload) {
    return this.http.post(`${this.baseUrl}/email/price-change`, payload);
  }
}