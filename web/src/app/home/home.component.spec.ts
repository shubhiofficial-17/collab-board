import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '../auth/auth.service';
import { MemoryStorage, OFFLINE_STORAGE } from '../board/offline-cache';
import { of, throwError } from 'rxjs';
import { BoardsApi } from '../boards/boards-api.service';
import { HomeComponent } from './home.component';

describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;
  let api: jasmine.SpyObj<BoardsApi>;

  function setup() {
    TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: OFFLINE_STORAGE, useValue: new MemoryStorage() },
        { provide: BoardsApi, useValue: api },
      ],
    });
    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<BoardsApi>('BoardsApi', ['list', 'create', 'get']);
  });

  it('lists boards', () => {
    api.list.and.returnValue(of([{ id: '1', title: 'Roadmap', createdAt: '', updatedAt: '2026-11-06T10:00:00Z' }]));
    setup();

    expect(fixture.nativeElement.textContent).toContain('Roadmap');
  });

  it('shows who is signed in', () => {
    api.list.and.returnValue(of([]));
    setup();
    TestBed.inject(AuthService).me.set({ id: 'u1', email: 'ada@example.com', name: 'Ada' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.account').textContent).toContain('Ada');
  });

  it('shows an empty state', () => {
    api.list.and.returnValue(of([]));
    setup();

    expect(fixture.nativeElement.textContent).toContain('No boards yet');
  });

  it('shows an error when the API is down', () => {
    api.list.and.returnValue(throwError(() => new Error('down')));
    setup();

    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Could not load boards');
  });

  it('opens the new board after creating it', () => {
    api.list.and.returnValue(of([]));
    api.create.and.returnValue(of({ id: 'xyz', title: 'Plan', createdAt: '', updatedAt: '' }));
    setup();
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);

    fixture.componentInstance.title = 'Plan';
    fixture.componentInstance.create();

    expect(api.create).toHaveBeenCalledWith('Plan');
    expect(navigate).toHaveBeenCalledWith(['/b', 'xyz']);
  });
});
