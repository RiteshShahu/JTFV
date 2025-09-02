import { TestBed } from '@angular/core/testing';

import { PriceChangeService } from './price-change.service';

describe('PriceChangeService', () => {
  let service: PriceChangeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(PriceChangeService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
