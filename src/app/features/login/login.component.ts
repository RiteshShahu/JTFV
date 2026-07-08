import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';

const API_BASE = (window as any).__APP_API__ || 'http://localhost:3001';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css']
})
export class LoginComponent implements OnInit {
  loginForm: FormGroup;
  logoUrl: string = '';

  isSubmitting = false;
  isCheckingSession = true; // true while we check for an existing token
  errorMessage: string | null = null;
  showPassword = false;

  constructor(
    private formBuilder: FormBuilder,
    private http: HttpClient,
    private router: Router
  ) {
    this.loginForm = this.formBuilder.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(6)]],
    });
  }

  async ngOnInit(): Promise<void> {
    this.logoUrl = 'assets/logo.jpg';

    // 🧹 One-time cleanup: remove anything a previous version stored
    localStorage.removeItem('savedPassword');
    localStorage.removeItem('savedEmail');

    await this.tryAutoLogin();
  }

  private async tryAutoLogin(): Promise<void> {
    const electron = (window as any).electron;
    if (!electron?.auth?.getToken) {
      this.isCheckingSession = false;
      return;
    }

    try {
      const result = await electron.auth.getToken();
      const token = result?.token;
      if (!token) {
        this.isCheckingSession = false;
        return;
      }

      this.http.post<{ valid: boolean; email?: string }>(
        `${API_BASE}/api/session/validate`, { token }
      ).subscribe({
        next: (res) => {
          if (res.valid) {
            this.router.navigate(['/dashboard']);
          } else {
            electron.auth.clearToken();
            this.isCheckingSession = false;
          }
        },
        error: () => {
          // Server unreachable or token rejected — fall back to manual login
          this.isCheckingSession = false;
        },
      });
    } catch {
      this.isCheckingSession = false;
    }
  }

  togglePasswordVisibility(): void {
    this.showPassword = !this.showPassword;
  }

  onSubmit(): void {
    if (this.loginForm.invalid || this.isSubmitting) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.errorMessage = null;
    this.isSubmitting = true;

    const { email, password } = this.loginForm.value;

    this.http.post<{ message: string; token: string }>(
      `${API_BASE}/api/login`, { email, password }
    ).subscribe({
      next: async (res) => {
        const electron = (window as any).electron;
        if (electron?.auth?.saveToken && res.token) {
          await electron.auth.saveToken(res.token);
        }
        this.isSubmitting = false;
        this.router.navigate(['/dashboard']);
      },
      error: (err: HttpErrorResponse) => {
        this.isSubmitting = false;
        this.errorMessage =
          err?.error?.message ||
          (err.status === 0
            ? 'Cannot reach server. Please check your connection.'
            : 'Invalid email or password. Please try again.');
      },
    });
  }

  goToRegister(): void {
    this.router.navigate(['/register']);
  }
}