import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { Observable, firstValueFrom, tap } from 'rxjs';
import { OFFLINE_STORAGE, OfflineCache } from '../board/offline-cache';

/** The signed-in user. */
export interface Me {
  id: string;
  email: string;
  name: string;
}

const KEY = 'collab-board/me';

/**
 * Who is signed in. The session itself is an HttpOnly cookie the browser sends automatically, so this
 * only keeps the user's details. They're remembered locally so the app still opens offline.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(OFFLINE_STORAGE);
  private readonly cache = inject(OfflineCache);
  private checked: Promise<Me | null> | null = null;

  readonly me = signal<Me | null>(null);

  /** Asks the server once who is signed in. Without a connection, trusts the last known user. */
  ensureLoaded(): Promise<Me | null> {
    this.checked ??= firstValueFrom(this.http.get<Me>('/api/account/me')).then(
      (me) => this.remember(me),
      (error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          return this.remember(null);
        }

        const cached = this.cached();
        this.me.set(cached);
        return cached;
      },
    );
    return this.checked;
  }

  signIn(email: string, password: string): Observable<Me> {
    return this.http.post<Me>('/api/account/signin', { email, password }).pipe(tap((me) => this.signedIn(me)));
  }

  signUp(email: string, name: string, password: string): Observable<Me> {
    return this.http.post<Me>('/api/account/signup', { email, name, password }).pipe(tap((me) => this.signedIn(me)));
  }

  signOut(): Observable<void> {
    return this.http.post<void>('/api/account/signout', {}).pipe(tap(() => this.forget()));
  }

  /** The server no longer accepts the session (expired or signed out elsewhere). */
  sessionExpired(): void {
    this.remember(null);
    this.checked = Promise.resolve(null);
  }

  private signedIn(me: Me): void {
    const previous = this.cached();
    if (previous && previous.id !== me.id) {
      this.cache.clear(); // someone else's boards shouldn't stay on a shared computer
    }

    this.remember(me);
    this.checked = Promise.resolve(me);
  }

  private forget(): void {
    this.cache.clear();
    this.sessionExpired();
  }

  private remember(me: Me | null): Me | null {
    this.me.set(me);
    try {
      if (me) {
        this.storage?.setItem(KEY, JSON.stringify(me));
      } else {
        this.storage?.removeItem(KEY);
      }
    } catch {
      // Storage unavailable: just not remembered.
    }

    return me;
  }

  private cached(): Me | null {
    try {
      const raw = this.storage?.getItem(KEY);
      return raw ? (JSON.parse(raw) as Me) : null;
    } catch {
      return null;
    }
  }
}
