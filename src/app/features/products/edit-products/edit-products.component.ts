import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { NgForm } from '@angular/forms';
import { ProductService, Name } from 'src/app/core/services/products.service';
import { ToastService } from 'src/app/core/services/toast.service';

@Component({
  selector: 'app-edit-products',
  templateUrl: './edit-products.component.html',
  styleUrls: ['./edit-products.component.css']
})
export class EditProductsComponent implements OnInit {
  productId!: number;
  product: Partial<Name> = {};
  loading = false;
  saving = false;

  constructor(
    private productService: ProductService,
    private route: ActivatedRoute,
    private router: Router,
    private toast: ToastService
  ) {}

  ngOnInit(): void {
    this.productId = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isFinite(this.productId)) {
      this.toast.error('Invalid product id.');
      this.router.navigate(['/products']);
      return;
    }
    this.loadProduct();
  }

  loadProduct(): void {
    this.loading = true;
    this.productService.getNameById(this.productId).subscribe({
      next: (name) => {
        this.product = name;
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load name:', err);
        this.toast.error('Failed to load product.');
        this.loading = false;
      }
    });
  }

  onSubmit(form: NgForm): void {
    if (!form.valid) {
      this.toast.warn('Please fill all required fields.');
      return;
    }

    this.saving = true;

    this.productService.updateName(this.productId, form.value).subscribe({
      next: () => {
        this.toast.success('Product updated!');
        this.saving = false;
        this.router.navigate(['/products']);
      },
      error: (err) => {
        console.error('Update error:', err);
        this.toast.error(err.error?.message || 'Update failed.');
        this.saving = false;
      }
    });
  }

  backToProducts(): void {
    this.router.navigate(['/products']);
  }
}