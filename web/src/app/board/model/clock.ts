/**
 * Hybrid logical clock (HLC). Each timestamp is `<wall ms>:<counter>:<client id>`, padded so that
 * comparing two timestamps as strings orders them correctly.
 *
 * - Timestamps from one client always increase, even if the system clock goes backwards.
 * - After seeing someone else's timestamp, a client's next timestamp is later than it, so an edit
 *   made after receiving another edit always wins over it (causality is respected).
 * - The client id breaks ties, so two different edits never get equal timestamps.
 */
export class HybridClock {
  private wall = 0;
  private counter = 0;

  constructor(
    readonly clientId: string,
    private readonly now: () => number = Date.now,
  ) {}

  /** A new timestamp, later than every timestamp this clock has issued or observed. */
  tick(): string {
    const physical = this.now();
    if (physical > this.wall) {
      this.wall = physical;
      this.counter = 0;
    } else if (++this.counter > 9999) {
      this.wall++; // keep the counter at four digits so timestamps still sort as strings
      this.counter = 0;
    }

    return format(this.wall, this.counter, this.clientId);
  }

  /** Moves the clock past a timestamp received from someone else. */
  observe(timestamp: string): void {
    const parsed = parse(timestamp);
    if (!parsed) {
      return;
    }

    if (parsed.wall > this.wall || (parsed.wall === this.wall && parsed.counter > this.counter)) {
      this.wall = parsed.wall;
      this.counter = parsed.counter;
    }
  }
}

export function format(wall: number, counter: number, clientId: string): string {
  return `${String(wall).padStart(13, '0')}:${String(counter).padStart(4, '0')}:${clientId}`;
}

export function parse(timestamp: string): { wall: number; counter: number; clientId: string } | null {
  const match = /^(\d{13}):(\d{4}):([a-z0-9]{1,24})$/.exec(timestamp);
  return match ? { wall: Number(match[1]), counter: Number(match[2]), clientId: match[3] } : null;
}
