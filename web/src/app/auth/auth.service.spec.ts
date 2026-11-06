import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { MemoryStorage, OFFLINE_STORAGE, OfflineCache } from '../board/offline-cache';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let storage: MemoryStorage;
  const ada = { id: 'u1', email: 'ada@example.com', name: 'Ada' };

  beforeEach(() => {
    storage = new MemoryStorage();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: OFFLINE_STORAGE, useValue: storage }],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks the server who is signed in, once', async () => {
    const first = auth.ensureLoaded();
    const second = auth.ensureLoaded();
    http.expectOne('/api/account/me').flush(ada);

    expect(await first).toEqual(ada);
    expect(await second).toEqual(ada);
    expect(auth.me()).toEqual(ada);
  });

  it('knows nobody is signed in on a 401', async () => {
    const loaded = auth.ensureLoaded();
    http.expectOne('/api/account/me').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(await loaded).toBeNull();
  });

  it('trusts the last known user when the server cannot be reached', async () => {
    storage.setItem('collab-board/me', JSON.stringify(ada));

    const loaded = auth.ensureLoaded();
    http.expectOne('/api/account/me').error(new ProgressEvent('error'), { status: 0 });

    expect(await loaded).toEqual(ada);
  });

  it('signs in, and forgets local boards on sign-out', () => {
    const cache = TestBed.inject(OfflineCache);
    cache.saveSnapshot({ id: 'b1', title: 'x', createdAt: '', updatedAt: '' }, []);

    auth.signIn('ada@example.com', 'secret123').subscribe();
    const request = http.expectOne('/api/account/signin');
    expect(request.request.body).toEqual({ email: 'ada@example.com', password: 'secret123' });
    request.flush(ada);
    expect(auth.me()).toEqual(ada);

    auth.signOut().subscribe();
    http.expectOne('/api/account/signout').flush(null);

    expect(auth.me()).toBeNull();
    expect(cache.load('b1')).toBeNull();
  });
});
