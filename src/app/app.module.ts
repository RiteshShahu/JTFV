import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatCardModule } from '@angular/material/card';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { LoginComponent } from './features/login/login.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { AddMerchantComponent } from './features/dashboard/add-merchant/add-merchant.component';
import { NavbarComponent } from './features/navbar/navbar.component';
import { ReportsComponent } from './features/bills/reports/reports.component';
import { RegisterComponent } from './features/register/register.component';
import { AddProductsComponent } from './features/products/add-products/add-products.component';
import { ProductsComponent } from './features/products/products.component';
import { EditProductsComponent } from './features/products/edit-products/edit-products.component';
import { BarcodeComponent } from './features/barcode/barcode.component';
import { EditBillsComponent } from './features/bills/edit-bills/edit-bills.component';
import { BillsComponent } from './features/bills/bills.component';
import { AddLumpsumBillsComponent } from './features/bills/add-lumpsum-bills/add-lumpsum-bills.component';
import { EditLumpsumBillsComponent } from './features/bills/edit-lumpsum-bills/edit-lumpsum-bills.component';
import { RelianceBillsComponent } from './features/bills/reliance-bills/reliance-bills.component';
import { EditRelianceBillsComponent } from './features/bills/edit-reliance-bills/edit-reliance-bills.component';
import { LabelPrintHistoryComponent } from './features/barcode/label-print-history/label-print-history.component';
import { PriceChangeComponent } from './features/price-change/price-change.component';
import { ToastContainerComponent } from './features/toast-container/toast-container.component';
import { DmartComponent } from './features/barcode/dmart/dmart.component';

@NgModule({
  imports: [
    BrowserModule,
    AppRoutingModule,
    BrowserAnimationsModule,
    CommonModule,
    FormsModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    ReactiveFormsModule,
    HttpClientModule,
    MatToolbarModule,
    MatButtonModule,
    MatMenuModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatCardModule,
    MatAutocompleteModule
  ],

  declarations: [
    AppComponent,
    LoginComponent,
    DashboardComponent,
    NavbarComponent,
    BillsComponent,
    ReportsComponent,
    AddMerchantComponent,
    BarcodeComponent,
    RegisterComponent,
    AddProductsComponent,
    ProductsComponent,
    EditProductsComponent,
    EditBillsComponent,
    AddLumpsumBillsComponent,
    EditLumpsumBillsComponent,
    RelianceBillsComponent,
    EditRelianceBillsComponent,
    LabelPrintHistoryComponent,
    PriceChangeComponent,
    ToastContainerComponent,
    DmartComponent,
  ],

  providers: [],
  bootstrap: [AppComponent]
})
export class AppModule { }