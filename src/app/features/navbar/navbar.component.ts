import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';

const API_BASE = (window as any).__APP_API__ || 'http://localhost:3001';

@Component({
  selector: 'app-navbar',
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent {
  isLoggingOut = false;

  constructor(private router: Router, private http: HttpClient) { }

  async logout(): Promise<void> {
    if (this.isLoggingOut) return;
    this.isLoggingOut = true;

    const electron = (window as any).electron;

    try {
      // 1) Get the stored token so we can invalidate it server-side
      const tokenResult = electron?.auth?.getToken
        ? await electron.auth.getToken()
        : null;
      const token = tokenResult?.token;

      // 2) Tell the server to clear authToken in the DB (best-effort)
      if (token) {
        await this.http.post(`${API_BASE}/api/logout`, { token }).toPromise().catch(() => { });
      }

      // 3) Delete the local session file so auto-login won't fire again
      if (electron?.auth?.clearToken) {
        await electron.auth.clearToken();
      }
    } catch (err) {
      console.error('Logout error (proceeding anyway):', err);
    } finally {
      // 4) Clean up the old localStorage flag too, just in case anything still checks it
      localStorage.removeItem('isLoggedIn');
      this.isLoggingOut = false;
      this.router.navigate(['/login']);
    }
  }
}