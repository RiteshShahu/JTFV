import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DmartComponent } from './dmart.component';

describe('DmartComponent', () => {
  let component: DmartComponent;
  let fixture: ComponentFixture<DmartComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [DmartComponent]
    });
    fixture = TestBed.createComponent(DmartComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
