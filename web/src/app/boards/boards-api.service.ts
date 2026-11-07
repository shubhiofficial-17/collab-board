import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Op } from '../board/model/ops';
import { Board, BoardContent } from './board';

@Injectable({ providedIn: 'root' })
export class BoardsApi {
  private readonly http = inject(HttpClient);

  list(): Observable<Board[]> {
    return this.http.get<Board[]>('/api/boards');
  }

  get(id: string): Observable<BoardContent> {
    return this.http.get<BoardContent>(`/api/boards/${encodeURIComponent(id)}`);
  }

  create(title: string): Observable<Board> {
    return this.http.post<Board>('/api/boards', { title });
  }

  rename(id: string, title: string): Observable<Board> {
    return this.http.patch<Board>(`/api/boards/${encodeURIComponent(id)}`, { title });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/boards/${encodeURIComponent(id)}`);
  }

  /** Saves a batch of changes; returns the board's new version. */
  applyOps(id: string, ops: Op[]): Observable<{ version: number }> {
    return this.http.post<{ version: number }>(`/api/boards/${encodeURIComponent(id)}/ops`, { ops });
  }
}
