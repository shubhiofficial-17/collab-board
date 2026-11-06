import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { BoardsApi } from '../boards/boards-api.service';
import { Sharing } from '../boards/board';
import { ShareDialogComponent } from './share-dialog.component';

describe('ShareDialogComponent', () => {
  let fixture: ComponentFixture<ShareDialogComponent>;
  let api: jasmine.SpyObj<BoardsApi>;
  const sharing: Sharing = {
    members: [
      { userId: 'u1', name: 'Owner', email: 'o@example.com', role: 'owner' },
      { userId: 'u2', name: 'Friend', email: 'f@example.com', role: 'viewer' },
    ],
    links: [{ token: 'tok123', role: 'viewer' }],
  };

  beforeEach(() => {
    api = jasmine.createSpyObj<BoardsApi>('BoardsApi', ['sharing', 'createLink', 'removeLink', 'setRole', 'removeMember']);
    api.sharing.and.returnValue(of(sharing));
    TestBed.configureTestingModule({ imports: [ShareDialogComponent], providers: [{ provide: BoardsApi, useValue: api }] });
    fixture = TestBed.createComponent(ShareDialogComponent);
    fixture.componentRef.setInput('boardId', 'b1');
    fixture.detectChanges();
  });

  it('shows existing links and offers to create missing ones', () => {
    const viewer: HTMLInputElement = fixture.nativeElement.querySelector('[data-role=viewer] input');
    expect(viewer.value).toBe(`${location.origin}/invite/tok123`);
    expect(fixture.nativeElement.querySelector('[data-role=editor] .create')).not.toBeNull();
  });

  it('creates a link', () => {
    api.createLink.and.returnValue(of({ token: 'new', role: 'editor' }));

    fixture.nativeElement.querySelector('[data-role=editor] .create').click();

    expect(api.createLink).toHaveBeenCalledWith('b1', 'editor');
    expect(api.sharing).toHaveBeenCalledTimes(2);
  });

  it('lists people and lets the owner change roles or remove them', () => {
    api.setRole.and.returnValue(of(undefined));
    api.removeMember.and.returnValue(of(undefined));
    expect(fixture.nativeElement.querySelectorAll('.members li').length).toBe(2);

    fixture.componentInstance.setRole('u2', 'editor');
    fixture.componentInstance.remove('u2');

    expect(api.setRole).toHaveBeenCalledWith('b1', 'u2', 'editor');
    expect(api.removeMember).toHaveBeenCalledWith('b1', 'u2');
  });
});
