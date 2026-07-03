import { Component, OnInit, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { ProductService, Name } from 'src/app/core/services/products.service';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';

type NameField = 'name' | 'type' | 'priority' | 'units' | 'mrp' | 'expiryDays';

interface SearchByOption {
  value: NameField;
  label: string;
}

@Component({
  selector: 'app-products',
  templateUrl: './products.component.html',
  styleUrls: ['./products.component.css']
})
export class ProductsComponent implements OnInit, OnDestroy {
  // Search & Filter
  searchBy: NameField = 'name';
  searchText: string = '';
  private searchSubject$ = new Subject<string>();

  // Data
  products: Name[] = [];
  filteredProducts: Name[] = [];

  // Sorting
  sortField: NameField | null = null;
  sortDirection: 'asc' | 'desc' = 'asc';

  // Pagination
  currentPage: number = 1;
  pageSize: number = 25;

  // States
  isLoading: boolean = false;
  errorMessage: string | null = null;
  successMessage: string | null = null;

  // Search By Options (for label display)
  private searchByOptions: SearchByOption[] = [
    { value: 'name', label: 'Product Name' },
    { value: 'type', label: 'Type' },
    { value: 'priority', label: 'Priority' },
    { value: 'units', label: 'Units' },
    { value: 'mrp', label: 'MRP' },
    { value: 'expiryDays', label: 'Expiry Days' }
  ];

  // Numeric fields for proper comparison
  private numericFields: NameField[] = ['mrp', 'expiryDays'];

  // Cleanup subscription
  private destroy$ = new Subject<void>();

  constructor(
    private productService: ProductService,
    private router: Router
  ) { }

  ngOnInit(): void {
    this.loadProducts();
    this.setupSearchDebounce();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /**
   * Load products from service
   */
  private loadProducts(): void {
    this.isLoading = true;
    this.errorMessage = null;

    this.productService.getNames()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (names) => {
          this.products = names;
          this.filteredProducts = this.sortArray([...names], 'name', 'asc');
          this.isLoading = false;
        },
        error: (error) => {
          console.error('Failed to load products:', error);
          this.errorMessage = 'Failed to load products. Please try again later.';
          this.isLoading = false;
        }
      });
  }

  /**
   * Setup debounced search input
   */
  private setupSearchDebounce(): void {
    this.searchSubject$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.performSearch();
    });
  }

  /**
   * Handle search input event (for debounce)
   */
  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchSubject$.next(value);
  }

  /**
   * Handle search button click (immediate)
   */
  onSearch(): void {
    this.performSearch();
  }

  /**
   * Perform the actual search/filter logic
   */
  private performSearch(): void {
    const searchText = this.searchText.trim();

    // Reset to all products if no search text
    if (!searchText) {
      this.filteredProducts = [...this.products];
      this.applyCurrentSort();
      this.currentPage = 1;
      return;
    }

    const isNumericField = this.numericFields.includes(this.searchBy);

    this.filteredProducts = this.products.filter(product => {
      const fieldValue = product[this.searchBy];

      // Skip null/undefined values
      if (fieldValue === undefined || fieldValue === null) {
        return false;
      }

      // Numeric field comparison
      if (isNumericField) {
        const searchNumber = Number(searchText);
        if (isNaN(searchNumber)) {
          return false;
        }
        return Number(fieldValue) === searchNumber;
      }

      // String comparison (case-insensitive)
      return fieldValue
        .toString()
        .toLowerCase()
        .includes(searchText.toLowerCase());
    });

    this.applyCurrentSort();
    this.currentPage = 1;
  }

  /**
   * Clear search and reset results
   */
  clearSearch(): void {
    this.searchText = '';
    this.performSearch();
  }

  /**
   * Sort by specified field
   */
  sortBy(field: NameField): void {
    if (this.sortField === field) {
      // Toggle direction if same field
      this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      // New field, default to ascending
      this.sortField = field;
      this.sortDirection = 'asc';
    }

    this.applyCurrentSort();
  }

  /**
   * Apply current sort settings to filtered products
   */
  private applyCurrentSort(): void {
    if (this.sortField) {
      this.filteredProducts = this.sortArray(
        this.filteredProducts,
        this.sortField,
        this.sortDirection
      );
    } else {
      // Default sort by name
      this.filteredProducts = this.sortArray(
        this.filteredProducts,
        'name',
        'asc'
      );
    }
  }

  /**
   * Generic sort function for arrays
   */
  private sortArray(
    array: Name[],
    field: NameField,
    direction: 'asc' | 'desc'
  ): Name[] {
    return [...array].sort((a, b) => {
      const aVal = a[field];
      const bVal = b[field];

      // Handle null/undefined - push to bottom
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      // Try numeric comparison
      const aNum = Number(aVal);
      const bNum = Number(bVal);

      if (
        !isNaN(aNum) &&
        !isNaN(bNum) &&
        aVal.toString().trim() !== '' &&
        bVal.toString().trim() !== ''
      ) {
        const result = aNum - bNum;
        return direction === 'asc' ? result : -result;
      }

      // String comparison (case-insensitive)
      const result = aVal
        .toString()
        .toLowerCase()
        .localeCompare(bVal.toString().toLowerCase());
      return direction === 'asc' ? result : -result;
    });
  }

  /**
   * Get aria-sort attribute value for accessibility
   */
  getAriaSort(field: NameField): 'ascending' | 'descending' | 'none' {
    if (this.sortField !== field) {
      return 'none';
    }
    return this.sortDirection === 'asc' ? 'ascending' : 'descending';
  }

  /**
   * Get human-readable label for current search field
   */
  getSearchByLabel(): string {
    const option = this.searchByOptions.find(opt => opt.value === this.searchBy);
    return option ? option.label : this.searchBy;
  }

  /**
   * TrackBy function for ngFor performance
   */
  trackByProductId(index: number, product: Name): number {
    return product.id ?? index;
  }

  /**
   * Check if row should be highlighted (optional feature)
   */
  isRowHighlighted(product: Name): boolean {
    // Add your highlight logic here if needed
    return false;
  }

  /**
   * Get CSS class for type badge
   */
  /**
   * Get CSS class for type badge
   */
  getTypeBadgeClass(type: string | null | undefined): string {
    if (!type) return 'badge-default';

    const typeLower = type.toLowerCase();

    if (typeLower.includes('vegetable')) return 'badge-vegetable';
    if (typeLower.includes('fruit')) return 'badge-fruit';
    if (typeLower.includes('dairy')) return 'badge-dairy';
    if (typeLower.includes('meat') || typeLower.includes('chicken')) return 'badge-meat';
    if (typeLower.includes('grain') || typeLower.includes('rice')) return 'badge-grain';
    if (typeLower.includes('beverage') || typeLower.includes('drink')) return 'badge-beverage';
    if (typeLower.includes('snack')) return 'badge-snack';
    if (typeLower.includes('others')) return 'badge-others';

    return 'badge-default';
  }

  /**
   * Download filtered products as Excel file
   */
  downloadExcel(): void {
    if (this.filteredProducts.length === 0) {
      this.showErrorMessage('No data available to download.');
      return;
    }

    try {
      const excelData = this.filteredProducts.map(p => ({
        'Product Name': p.name || '',
        'Type': p.type || '',
        'Priority': p.priority || '',
        'Units': p.units || '',
        'MRP': p.mrp ?? '',
        'Expiry Days': p.expiryDays ?? ''
      }));

      const worksheet: XLSX.WorkSheet = XLSX.utils.json_to_sheet(excelData);

      // Set column widths
      worksheet['!cols'] = [
        { wch: 25 }, // Product Name
        { wch: 15 }, // Type
        { wch: 10 }, // Priority
        { wch: 10 }, // Units
        { wch: 10 }, // MRP
        { wch: 12 }  // Expiry Days
      ];

      const workbook: XLSX.WorkBook = {
        Sheets: { Products: worksheet },
        SheetNames: ['Products']
      };

      const excelBuffer: ArrayBuffer = XLSX.write(workbook, {
        bookType: 'xlsx',
        type: 'array'
      });

      const data: Blob = new Blob([excelBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8'
      });

      // Generate filename with timestamp
      const timestamp = new Date().toISOString().slice(0, 10);
      saveAs(data, `Products-${timestamp}.xlsx`);

      this.showSuccessMessage(
        `Successfully downloaded ${this.filteredProducts.length} products.`
      );
    } catch (error) {
      console.error('Failed to download Excel:', error);
      this.showErrorMessage('Failed to download Excel file. Please try again.');
    }
  }

  /**
   * Navigate to edit page
   */
  onEdit(productId: number | undefined): void {
    if (!productId) return;
    this.router.navigate(['/edit-products', productId]);
  }

  /**
   * Navigate back to home/dashboard
   */
  backToHome(): void {
    this.router.navigate(['/dashboard']);
  }

  /**
   * Pagination: Go to specific page
   */
  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages) return;
    this.currentPage = page;
  }

  /**
   * Get total number of pages
   */
  get totalPages(): number {
    return Math.ceil(this.filteredProducts.length / this.pageSize);
  }

  // ==================== Message Helpers ====================

  private showErrorMessage(message: string): void {
    this.errorMessage = message;
    this.successMessage = null;
  }

  private showSuccessMessage(message: string): void {
    this.successMessage = message;
    this.errorMessage = null;
  }

  dismissError(): void {
    this.errorMessage = null;
  }

  dismissSuccess(): void {
    this.successMessage = null;
  }
}