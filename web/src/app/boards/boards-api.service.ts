import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Board } from './board';

@Injectable({ providedIn: 'root' })
export class BoardsApi {
  private readonly http = inject(HttpClient);

  list(): Observable<Board[]> {
    return this.http.get<Board[]>('/api/boards');
  }

  get(id: string): Observable<Board> {
    return this.http.get<Board>(`/api/boards/${encodeURIComponent(id)}`);
  }

  create(title: string): Observable<Board> {
    return this.http.post<Board>('/api/boards', { title });
  }
}
