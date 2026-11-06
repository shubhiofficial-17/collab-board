import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BoardsApi } from './boards-api.service';

describe('BoardsApi', () => {
  let api: BoardsApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(BoardsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('creates a board with a title', () => {
    api.create('Retro').subscribe((board) => expect(board.id).toBe('abc'));

    const req = http.expectOne('/api/boards');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ title: 'Retro' });
    req.flush({ id: 'abc', title: 'Retro', createdAt: '', updatedAt: '' });
  });

  it('encodes board ids in the URL', () => {
    api.get('a/b').subscribe();

    http.expectOne('/api/boards/a%2Fb').flush({});
  });
});
