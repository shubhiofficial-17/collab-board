import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { BoardsApi } from '../boards/boards-api.service';
import { InviteComponent } from './invite.component';

describe('InviteComponent', () => {
  let api: jasmine.SpyObj<BoardsApi>;

  function setup() {
    TestBed.configureTestingModule({ imports: [InviteComponent], providers: [provideRouter([]), { provide: BoardsApi, useValue: api }] });
    const router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(InviteComponent);
    fixture.componentRef.setInput('token', 'tok123');
    fixture.detectChanges();
    return { fixture, router };
  }

  beforeEach(() => {
    api = jasmine.createSpyObj<BoardsApi>('BoardsApi', ['acceptInvite']);
  });

  it('joins the board and opens it', () => {
    api.acceptInvite.and.returnValue(of({ boardId: 'b1', role: 'editor' }));
    const { router } = setup();

    expect(api.acceptInvite).toHaveBeenCalledWith('tok123');
    expect(router.navigate).toHaveBeenCalledWith(['/b', 'b1'], { replaceUrl: true });
  });

  it('explains a dead link', () => {
    api.acceptInvite.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    const { fixture } = setup();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('invalid or has been turned off');
  });
});
