import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { BoardsApi } from '../boards/boards-api.service';
import { VersionSummary } from '../boards/board';
import { HistoryPanelComponent } from './history-panel.component';

describe('HistoryPanelComponent', () => {
  let fixture: ComponentFixture<HistoryPanelComponent>;
  let api: jasmine.SpyObj<BoardsApi>;
  const versions: VersionSummary[] = [
    { id: 'v2', name: 'Draft', createdAt: '2026-11-06T10:00:00Z', createdByName: 'Ada', shapeCount: 2 },
    { id: 'v1', name: null, createdAt: '2026-11-06T09:00:00Z', createdByName: null, shapeCount: 1 },
  ];
  const shape = { id: 's1', kind: 'rect' as const, x: 0, y: 0, w: 10, h: 10, color: '#fde68a', z: 1 };

  function setup(canEdit = true) {
    api = jasmine.createSpyObj<BoardsApi>('BoardsApi', ['versions', 'version', 'saveVersion', 'restoreVersion']);
    api.versions.and.returnValue(of(versions));
    api.version.and.returnValue(of({ id: 'v1', name: null, createdAt: versions[1].createdAt, shapes: [shape] }));
    TestBed.configureTestingModule({ imports: [HistoryPanelComponent], providers: [{ provide: BoardsApi, useValue: api }] });
    fixture = TestBed.createComponent(HistoryPanelComponent);
    fixture.componentRef.setInput('boardId', 'b1');
    fixture.componentRef.setInput('canEdit', canEdit);
    fixture.detectChanges();
  }

  it('lists named and automatic versions', () => {
    setup();
    const items = fixture.nativeElement.querySelectorAll('.versions li');

    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Draft');
    expect(items[1].textContent).toContain('Automatic');
  });

  it('previews a version and restores it', () => {
    setup();
    api.restoreVersion.and.returnValue(of({ version: 9 }));
    let restored = false;
    fixture.componentInstance.restored.subscribe(() => (restored = true));

    fixture.nativeElement.querySelectorAll('.versions button')[1].click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-shape-preview')).not.toBeNull();

    fixture.nativeElement.querySelector('.preview .primary').click();

    expect(api.restoreVersion).toHaveBeenCalledWith('b1', 'v1');
    expect(restored).toBeTrue();
  });

  it('saves a named version', () => {
    setup();
    api.saveVersion.and.returnValue(of(versions[0]));
    fixture.componentInstance.name = '  Milestone ';

    fixture.componentInstance.save();

    expect(api.saveVersion).toHaveBeenCalledWith('b1', 'Milestone');
  });

  it('only lets viewers look', () => {
    setup(false);
    fixture.componentInstance.open(versions[1]);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('form.save')).toBeNull();
    expect(fixture.nativeElement.querySelector('.preview .primary')).toBeNull();
  });
});
