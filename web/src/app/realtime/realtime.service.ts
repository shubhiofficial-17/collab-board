import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { HubConnection, HubConnectionBuilder, LogLevel } from '@microsoft/signalr';
import { Op } from '../board/model/ops';
import { Identity } from './identity';

export interface Participant {
  connectionId: string;
  name: string;
  color: string;
}

export interface OpsMessage {
  ops: Op[];
  version: number;
  from: string | null;
}

interface CursorMessage {
  connectionId: string;
  x: number;
  y: number;
}

export interface RemoteCursor {
  connectionId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';

/** The subset of SignalR's HubConnection this service uses, so tests can supply a fake. */
export type HubConnectionLike = Pick<
  HubConnection,
  'start' | 'stop' | 'invoke' | 'send' | 'on' | 'onreconnecting' | 'onreconnected' | 'onclose' | 'connectionId'
>;

export const HUB_CONNECTION_FACTORY = new InjectionToken<() => HubConnectionLike>('HUB_CONNECTION_FACTORY', {
  providedIn: 'root',
  factory: () => () =>
    new HubConnectionBuilder()
      .withUrl('/hubs/board')
      // Keep trying for a long time: a laptop waking up should rejoin without a reload.
      .withAutomaticReconnect([0, 1000, 2000, 5000, 10000, 10000, 30000, 30000, 30000])
      .configureLogging(LogLevel.Warning)
      .build(),
});

/** Cursor positions are sent at most this often. */
export const CURSOR_INTERVAL_MS = 50;

/**
 * The live connection for one open board: who else is here, where their cursors are, and changes
 * they save. Provided per board page.
 */
@Injectable()
export class RealtimeService {
  private readonly createConnection = inject(HUB_CONNECTION_FACTORY);
  private connection: HubConnectionLike | null = null;
  private boardId = '';
  private identity: Identity | null = null;
  private handlers: { onOps: (message: OpsMessage) => void; onResync: () => void } | null = null;

  private pendingCursor: { x: number; y: number } | null = null;
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;

  readonly status = signal<ConnectionStatus>('connecting');
  readonly participants = signal<Participant[]>([]);
  private readonly cursorPositions = signal<ReadonlyMap<string, { x: number; y: number }>>(new Map());

  /** Other people's cursors, with their names and colours. */
  readonly cursors = computed<RemoteCursor[]>(() => {
    const positions = this.cursorPositions();
    return this.participants()
      .filter((p) => p.connectionId !== this.connectionId && positions.has(p.connectionId))
      .map((p) => ({ ...p, ...positions.get(p.connectionId)! }));
  });

  /** Everyone else on the board. */
  readonly others = computed(() => this.participants().filter((p) => p.connectionId !== this.connectionId));

  constructor() {
    inject(DestroyRef).onDestroy(() => this.disconnect());
  }

  get connectionId(): string | null {
    return this.connection?.connectionId ?? null;
  }

  async connect(
    boardId: string,
    identity: Identity,
    handlers: { onOps: (message: OpsMessage) => void; onResync: () => void },
  ): Promise<void> {
    this.boardId = boardId;
    this.identity = identity;
    this.handlers = handlers;

    const connection = this.createConnection();
    this.connection = connection;

    connection.on('OpsApplied', (message: OpsMessage) => this.handlers?.onOps(message));
    connection.on('ParticipantJoined', (p: Participant) =>
      this.participants.update((list) => [...list.filter((x) => x.connectionId !== p.connectionId), p]),
    );
    connection.on('ParticipantLeft', (connectionId: string) => {
      this.participants.update((list) => list.filter((p) => p.connectionId !== connectionId));
      this.cursorPositions.update((map) => without(map, connectionId));
    });
    connection.on('CursorMoved', (c: CursorMessage) =>
      this.cursorPositions.update((map) => new Map(map).set(c.connectionId, { x: c.x, y: c.y })),
    );
    connection.onreconnecting(() => this.status.set('reconnecting'));
    connection.onreconnected(async () => {
      // A new connection id, and possibly missed changes: join again, then reload the board.
      this.cursorPositions.set(new Map());
      await this.join();
      this.handlers?.onResync();
    });
    connection.onclose(() => this.status.set('offline'));

    try {
      await connection.start();
      await this.join();
    } catch {
      // The board still works without live updates; edits keep saving over HTTP.
      this.status.set('offline');
    }
  }

  /** Shares this user's cursor (world coordinates), throttled. */
  moveCursor(x: number, y: number): void {
    this.pendingCursor = { x, y };
    if (this.cursorTimer !== null) {
      return;
    }

    this.flushCursor();
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = null;
      if (this.pendingCursor) {
        this.moveCursor(this.pendingCursor.x, this.pendingCursor.y);
      }
    }, CURSOR_INTERVAL_MS);
  }

  private flushCursor(): void {
    const cursor = this.pendingCursor;
    this.pendingCursor = null;
    if (cursor && this.status() === 'live') {
      // Fire-and-forget: a lost cursor update is replaced by the next one.
      this.connection?.send('MoveCursor', this.boardId, cursor.x, cursor.y).catch(() => undefined);
    }
  }

  private async join(): Promise<void> {
    const result = await this.connection!.invoke<{ version: number; participants: Participant[] }>(
      'JoinBoard',
      this.boardId,
      this.identity!.name,
      this.identity!.color,
    );
    this.participants.set(result.participants);
    this.status.set('live');
  }

  private disconnect(): void {
    if (this.cursorTimer !== null) {
      clearTimeout(this.cursorTimer);
    }

    this.handlers = null;
    this.connection?.stop().catch(() => undefined);
    this.connection = null;
  }
}

function without<V>(map: ReadonlyMap<string, V>, key: string): ReadonlyMap<string, V> {
  const next = new Map(map);
  next.delete(key);
  return next;
}
