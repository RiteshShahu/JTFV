import { Component, OnInit } from '@angular/core';
import { ToastService, ToastType } from 'src/app/core/services/toast.service';

type ToastMsg = { msg: string; type: ToastType; ts: number };
type ConfirmMsg = {
  id: number;
  message: string;
  type: ToastType;
  okText: string;
  cancelText: string;
  timeoutMs: number;
  resolve: (v: boolean) => void;
};

@Component({
  selector: 'app-toast-container',
  template: `
    <div class="toast-wrap">
      <!-- normal toasts -->
      <div *ngFor="let t of toasts" class="toast" [attr.data-type]="t.type">
        {{ t.msg }}
      </div>

      <!-- confirm toasts -->
      <div *ngFor="let c of confirms" class="toast toast-confirm" [attr.data-type]="c.type" (keydown.escape)="cancel(c)">
        <div class="row">
          <div class="msg">{{ c.message }}</div>
          <div class="actions">
            <button class="btn ok" (click)="ok(c)">{{ c.okText }}</button>
            <button class="btn cancel" (click)="cancel(c)">{{ c.cancelText }}</button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .toast-wrap { position: fixed; right: 16px; bottom: 16px; z-index: 99999; display: grid; gap: 8px; pointer-events: none; }
    .toast { pointer-events: auto; padding: 10px 14px; border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.25);
             background:#323232; color:#fff; font-size:14px; max-width: 360px; }
    .toast[data-type="success"] { background:#2e7d32; }
    .toast[data-type="error"]   { background:#c62828; }
    .toast[data-type="info"]    { background:#1565c0; }
    .toast[data-type="warn"]    { background:#ef6c00; }

    .toast-confirm .row { display:flex; align-items:center; gap:12px; }
    .toast-confirm .msg { flex: 1 1 auto; }
    .toast-confirm .actions { display:flex; gap:8px; }
    .btn { border: none; padding: 6px 10px; border-radius: 4px; font-weight: 600; cursor: pointer; }
    .btn.ok { background: rgba(255,255,255,.18); color: #fff; }
    .btn.cancel { background: rgba(0,0,0,.25); color: #fff; }
  `]
})
export class ToastContainerComponent implements OnInit {
  toasts: ToastMsg[] = [];
  confirms: ConfirmMsg[] = [];
  private seed = 1;

  constructor(private toast: ToastService) {}

  ngOnInit() {
    this.toast.register({
      show: (msg, type) => {
        const ts = Date.now();
        this.toasts = [...this.toasts, { msg, type, ts }];
        setTimeout(() => this.toasts = this.toasts.filter(x => x.ts !== ts), 2500);
      },
      showConfirm: (opts) => this.enqueueConfirm(opts)
    });
  }

  private enqueueConfirm(opts: { message: string; type?: ToastType; okText?: string; cancelText?: string; timeoutMs?: number; }): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const item: ConfirmMsg = {
        id: this.seed++,
        message: opts.message,
        type: opts.type ?? 'warn',
        okText: opts.okText ?? 'OK',
        cancelText: opts.cancelText ?? 'Cancel',
        timeoutMs: opts.timeoutMs ?? 0,
        resolve
      };
      this.confirms = [...this.confirms, item];

      if (item.timeoutMs > 0) {
        setTimeout(() => this.safeResolve(item, false), item.timeoutMs);
      }
    });
  }

  ok(c: ConfirmMsg)    { this.safeResolve(c, true); }
  cancel(c: ConfirmMsg){ this.safeResolve(c, false); }

  private safeResolve(c: ConfirmMsg, v: boolean) {
    if (!this.confirms.find(x => x.id === c.id)) return;
    this.confirms = this.confirms.filter(x => x.id !== c.id);
    try { c.resolve(v); } catch {}
  }
}