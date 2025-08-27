import { ComponentFixture, TestBed } from '@angular/core/testing';

import { LabelPrintHistoryComponent } from './label-print-history.component';

describe('LabelPrintHistoryComponent', () => {
  let component: LabelPrintHistoryComponent;
  let fixture: ComponentFixture<LabelPrintHistoryComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [LabelPrintHistoryComponent]
    });
    fixture = TestBed.createComponent(LabelPrintHistoryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
