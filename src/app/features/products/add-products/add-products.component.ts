import { Component } from '@angular/core';
import { NgForm } from '@angular/forms';
import { Router } from '@angular/router';
import { ProductService } from 'src/app/core/services/products.service';
import { ToastService } from 'src/app/core/services/toast.service';

@Component({
  selector: 'app-add-products',
  templateUrl: './add-products.component.html',
  styleUrls: ['./add-products.component.css']
})
export class AddProductsComponent {
  currentDate = new Date().toLocaleDateString();
  currentTime = new Date().toLocaleTimeString();
  saving = false;

  constructor(
    private productService: ProductService,
    private router: Router,
    private toast: ToastService
  ) {}

  onSubmit(form: NgForm): void {
    if (!form.valid) {
      this.toast.warn('Please fill all required fields.');
      return;
    }

    const nameData = form.value;
    this.saving = true;

    this.productService.addName(nameData).subscribe({
      next: () => {
        this.toast.success('Product added!');
        this.saving = false;
        this.router.navigate(['/products']);
      },
      error: (err) => {
        console.error('Failed to add name:', err);
        this.toast.error(err.error?.message || 'Failed to add product.');
        this.saving = false;
      }
    });
  }

  backToHome(): void {
    this.router.navigate(['/products']);
  }
}