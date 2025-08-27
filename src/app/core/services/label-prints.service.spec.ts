import { TestBed } from '@angular/core/testing';

import { LabelPrintsService } from './label-prints.service';

describe('LabelPrintsService', () => {
  let service: LabelPrintsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LabelPrintsService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
