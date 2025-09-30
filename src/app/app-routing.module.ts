import { NgModule } from '@angular/core';
import { RouterModule, Routes } from '@angular/router';
import { LoginComponent } from './features/login/login.component';
import { RegisterComponent } from './features/register/register.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { AddMerchantComponent } from './features/dashboard/add-merchant/add-merchant.component';
import { ProductsComponent } from './features/products/products.component';
import { AddProductsComponent } from './features/products/add-products/add-products.component';
import { EditProductsComponent } from './features/products/edit-products/edit-products.component';
import { BillsComponent } from './features/bills/bills.component';
import { EditBillsComponent } from './features/bills/edit-bills/edit-bills.component';
import { AddLumpsumBillsComponent } from './features/bills/add-lumpsum-bills/add-lumpsum-bills.component';
import { EditLumpsumBillsComponent } from './features/bills/edit-lumpsum-bills/edit-lumpsum-bills.component';
import { RelianceBillsComponent } from './features/bills/reliance-bills/reliance-bills.component';
import { EditRelianceBillsComponent } from './features/bills/edit-reliance-bills/edit-reliance-bills.component';
import { ReportsComponent } from './features/bills/reports/reports.component';
import { PriceChangeComponent } from './features/price-change/price-change.component';
import { BarcodeComponent } from './features/barcode/barcode.component';
import { LabelPrintHistoryComponent } from './features/barcode/label-print-history/label-print-history.component';

const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'register', component: RegisterComponent },
  { path: 'dashboard', component: DashboardComponent },
  { path: 'add-merchants', component: AddMerchantComponent },
  { path: 'products', component: ProductsComponent },
  { path: 'add-products', component: AddProductsComponent },
  { path: 'edit-products/:id', component: EditProductsComponent },
  { path: 'bills', component: BillsComponent },
  { path: 'edit-bills/:billNumber', component: EditBillsComponent },
  { path: 'add-lumpsum-bills', component: AddLumpsumBillsComponent },
  { path: 'edit-lumpsum-bills/:billNumber', component: EditLumpsumBillsComponent },
  { path: 'reliance-bills', component: RelianceBillsComponent },
  { path: 'edit-reliance-bills/:billNumber', component: EditRelianceBillsComponent },
  { path: 'reports', component: ReportsComponent },
  { path: 'price-change', component: PriceChangeComponent},
  { path: 'barcode', component: BarcodeComponent },
  { path: 'label-history', component: LabelPrintHistoryComponent },
  { path: '', redirectTo: '/login', pathMatch: 'full' },
];

@NgModule({
  imports: [RouterModule.forRoot(routes)],
  exports: [RouterModule]
})
export class AppRoutingModule {}