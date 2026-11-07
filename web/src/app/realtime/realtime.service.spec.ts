import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { FakeHubConnection } from './fake-hub-connection';
import { CURSOR_INTERVAL_MS, HUB_CONNECTION_FACTORY, OpsMessage, RealtimeService } from './realtime.service';

describe('RealtimeService', () => {
  let hub: FakeHubConnection;
  let service: RealtimeService;
  let received: OpsMessage[];
  let resyncs: number;

  const me = { connectionId: 'conn-me', name: 'Swift Otter', color: '#2563eb' };
  const bob = { connectionId: 'conn-bob', name: 'Bob', color: '#e11d48' };

  beforeEach(() => {
    hub = new FakeHubConnection();
    hub.joinResult = { version: 3, participants: [me, bob] };
    TestBed.configureTestingModule({
      providers: [RealtimeService, { provide: HUB_CONNECTION_FACTORY, useValue: () => hub.asConnection() }],
    });
    service = TestBed.inject(RealtimeService);
    received = [];
    resyncs = 0;
  });

  async function connect() {
    await service.connect('b1', { name: me.name, color: me.color }, {
      onOps: (m) => received.push(m),
      onResync: () => resyncs++,
    });
  }

  it('joins the board and lists everyone else', async () => {
    await connect();

    expect(hub.invoked[0]).toEqual(['JoinBoard', 'b1', 'Swift Otter', '#2563eb']);
    expect(service.status()).toBe('live');
    expect(service.others()).toEqual([bob]);
  });

  it('passes on changes and tracks people and cursors', async () => {
    await connect();

    hub.emit('OpsApplied', { ops: [{ type: 'delete', id: 's1' }], version: 4, from: 'conn-bob' });
    hub.emit('CursorMoved', { connectionId: 'conn-bob', x: 10, y: 20 });
    expect(received.length).toBe(1);
    expect(service.cursors()).toEqual([{ ...bob, x: 10, y: 20 }]);

    hub.emit('ParticipantLeft', 'conn-bob');
    expect(service.others()).toEqual([]);
    expect(service.cursors()).toEqual([]);
  });

  it('sends cursor positions at most every 50 ms, always ending with the latest', fakeAsync(() => {
    void connect();
    flushMicrotasks();

    service.moveCursor(1, 1);
    service.moveCursor(2, 2);
    service.moveCursor(3, 3);
    expect(hub.sent).toEqual([['MoveCursor', 'b1', 1, 1]]);

    tick(CURSOR_INTERVAL_MS);
    expect(hub.sent).toEqual([
      ['MoveCursor', 'b1', 1, 1],
      ['MoveCursor', 'b1', 3, 3],
    ]);

    tick(CURSOR_INTERVAL_MS * 2);
    expect(hub.sent.length).toBe(2);
  }));

  it('rejoins and asks for a resync after reconnecting', async () => {
    await connect();

    await hub.simulateReconnect('conn-me-2');

    expect(hub.invoked.length).toBe(2);
    expect(resyncs).toBe(1);
    expect(service.connectionId).toBe('conn-me-2');
  });

  it('works offline when the connection fails', async () => {
    hub.startError = new Error('no server');

    await connect();

    expect(service.status()).toBe('offline');
  });

  it('connects again on retry and asks for a resync', async () => {
    hub.startError = new Error('no server');
    await connect();

    hub.startError = null;
    await service.retry();

    expect(service.status()).toBe('live');
    expect(resyncs).toBe(1);
  });
});
