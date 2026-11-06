import { HybridClock, format, parse } from './clock';

describe('HybridClock', () => {
  it('issues increasing timestamps even when the wall clock stands still or goes back', () => {
    let now = 1000;
    const clock = new HybridClock('a', () => now);

    const first = clock.tick();
    const second = clock.tick();
    now = 500;
    const third = clock.tick();

    expect(first < second).toBeTrue();
    expect(second < third).toBeTrue();
  });

  it('moves past timestamps it observes', () => {
    const clock = new HybridClock('a', () => 1000);
    const remote = format(5000, 3, 'b');

    clock.observe(remote);

    expect(clock.tick() > remote).toBeTrue();
  });

  it('ignores malformed timestamps', () => {
    const clock = new HybridClock('a', () => 1000);
    clock.observe('garbage');
    expect(parse(clock.tick())).toEqual({ wall: 1000, counter: 0, clientId: 'a' });
  });

  it('orders by time first, then counter, then client', () => {
    expect(format(1, 9, 'z') < format(2, 0, 'a')).toBeTrue();
    expect(format(2, 1, 'z') < format(2, 2, 'a')).toBeTrue();
    expect(format(2, 2, 'a') < format(2, 2, 'b')).toBeTrue();
  });
});
