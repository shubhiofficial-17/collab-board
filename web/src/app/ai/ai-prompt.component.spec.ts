import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { BoardsApi } from '../boards/boards-api.service';
import { Shape } from '../board/model/shapes';
import { AiPromptComponent } from './ai-prompt.component';

describe('AiPromptComponent', () => {
  let fixture: ComponentFixture<AiPromptComponent>;
  let api: jasmine.SpyObj<BoardsApi>;

  beforeEach(() => {
    api = jasmine.createSpyObj<BoardsApi>('BoardsApi', ['generateDiagram']);
    TestBed.configureTestingModule({ imports: [AiPromptComponent], providers: [{ provide: BoardsApi, useValue: api }] });
    fixture = TestBed.createComponent(AiPromptComponent);
    fixture.componentRef.setInput('boardId', 'b1');
    fixture.componentRef.setInput('center', { x: 10, y: 20 });
    fixture.detectChanges();
  });

  it('sends the prompt with the view centre and hands back the shapes', () => {
    const shapes: Shape[] = [{ id: 'g1', kind: 'sticky', x: 0, y: 0, w: 1, h: 1, color: '#fde68a', z: 1 }];
    api.generateDiagram.and.returnValue(of({ shapes }));
    let received: Shape[] = [];
    fixture.componentInstance.generated.subscribe((s) => (received = s));
    fixture.componentInstance.prompt = ' A release process ';

    fixture.componentInstance.generate();

    expect(api.generateDiagram).toHaveBeenCalledWith('b1', 'A release process', 10, 20);
    expect(received).toEqual(shapes);
  });

  it('explains rate limits', () => {
    api.generateDiagram.and.returnValue(throwError(() => new HttpErrorResponse({ status: 429 })));
    fixture.componentInstance.prompt = 'x';

    fixture.componentInstance.generate();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role=alert]').textContent).toContain('Wait a minute');
  });
});
