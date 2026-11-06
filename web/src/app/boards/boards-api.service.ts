import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Op } from '../board/model/ops';
import { Board, BoardContent, ShareLink, ShareRole, Sharing, VersionDetail, VersionSummary } from './board';

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

  /** Members and invite links (owner only). */
  sharing(id: string): Observable<Sharing> {
    return this.http.get<Sharing>(`${url(id)}/sharing`);
  }

  /** Makes a new invite link for a role, replacing the old one. */
  createLink(id: string, role: ShareRole): Observable<ShareLink> {
    return this.http.post<ShareLink>(`${url(id)}/links`, { role });
  }

  removeLink(id: string, role: ShareRole): Observable<void> {
    return this.http.delete<void>(`${url(id)}/links/${role}`);
  }

  setRole(id: string, userId: string, role: ShareRole): Observable<void> {
    return this.http.put<void>(`${url(id)}/members/${encodeURIComponent(userId)}`, { role });
  }

  /** Removes someone, or with your own id, leaves the board. */
  removeMember(id: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${url(id)}/members/${encodeURIComponent(userId)}`);
  }

  acceptInvite(token: string): Observable<{ boardId: string; role: string }> {
    return this.http.post<{ boardId: string; role: string }>(`/api/invites/${encodeURIComponent(token)}/accept`, {});
  }

  versions(id: string): Observable<VersionSummary[]> {
    return this.http.get<VersionSummary[]>(`${url(id)}/versions`);
  }

  version(id: string, versionId: string): Observable<VersionDetail> {
    return this.http.get<VersionDetail>(`${url(id)}/versions/${encodeURIComponent(versionId)}`);
  }

  saveVersion(id: string, name: string): Observable<VersionSummary> {
    return this.http.post<VersionSummary>(`${url(id)}/versions`, { name });
  }

  restoreVersion(id: string, versionId: string): Observable<{ version: number }> {
    return this.http.post<{ version: number }>(`${url(id)}/versions/${encodeURIComponent(versionId)}/restore`, {});
  }

  /**
   * Saves a batch of changes; returns the board's new version. `connectionId` identifies this tab's
   * real-time connection, so the server broadcasts the changes to everyone except us.
   */
  applyOps(id: string, ops: Op[], connectionId?: string | null): Observable<{ version: number }> {
    const headers = connectionId ? new HttpHeaders({ 'X-Connection-Id': connectionId }) : undefined;
    return this.http.post<{ version: number }>(`/api/boards/${encodeURIComponent(id)}/ops`, { ops }, { headers });
  }
}

const url = (id: string) => `/api/boards/${encodeURIComponent(id)}`;
