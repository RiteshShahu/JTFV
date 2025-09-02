import { Injectable } from '@angular/core';

export type ToastType = 'success' | 'error' | 'info' | 'warn';

type ToastHost = {
  show: (msg: string, type: ToastType) => void;
  showConfirm?: (opts: {
    message: string;
    type?: ToastType;
    okText?: string;
    cancelText?: string;
    timeoutMs?: number; // auto-cancel after N ms (optional)
  }) => Promise<boolean>;
};

@Injectable({ providedIn: 'root' })
export class ToastService {
  private host?: ToastHost;

  register(host: ToastHost) { this.host = host; }

  private push(msg: string, type: ToastType) { this.host?.show(msg, type); }
  success(m: string) { this.push(m, 'success'); }
  error(m: string)   { this.push(m, 'error'); }
  info(m: string)    { this.push(m, 'info'); }
  warn(m: string)    { this.push(m, 'warn'); }

  // NEW: async confirm that resolves true/false without blocking
  async confirm(opts: {
    message: string;
    type?: ToastType;         // default 'warn'
    okText?: string;          // default 'OK'
    cancelText?: string;      // default 'Cancel'
    timeoutMs?: number;       // default 0 (no auto-cancel)
  }): Promise<boolean> {
    if (!this.host?.showConfirm) {
      // Fallback if host didn't implement the UI yet
      return Promise.resolve(window.confirm(opts.message));
    }
    return this.host.showConfirm({
      message: opts.message,
      type: opts.type ?? 'warn',
      okText: opts.okText ?? 'OK',
      cancelText: opts.cancelText ?? 'Cancel',
      timeoutMs: opts.timeoutMs ?? 0
    });
  }
}