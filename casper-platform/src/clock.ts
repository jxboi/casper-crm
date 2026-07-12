/**
 * Clock abstraction so tests can freeze/advance time (the records "neglected"
 * activity operators and event timestamps depend on `now()`).
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

let current: Clock = systemClock;

export function setClock(clock: Clock): void {
  current = clock;
}

export function now(): Date {
  return current.now();
}

/** A controllable clock for tests. */
export class FakeClock implements Clock {
  private t: Date;
  constructor(start: Date | string = "2026-01-01T00:00:00.000Z") {
    this.t = new Date(start);
  }
  now(): Date {
    return new Date(this.t);
  }
  set(t: Date | string): void {
    this.t = new Date(t);
  }
  advance(ms: number): void {
    this.t = new Date(this.t.getTime() + ms);
  }
}
