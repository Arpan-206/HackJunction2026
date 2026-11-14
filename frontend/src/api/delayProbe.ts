/**
 * Delay probe for the live hand (hand-root lane). Off unless localStorage `apprentice.delayProbe` is set: "1" for the
 * core on this page's host at port 8765, or the core's base URL (for example "http://192.168.1.20:8765").
 *
 * The core times its own stages and serves them at GET /debug/delay with the wall clock of GloveFrame t = 0. The probe
 * adds the two viewer stages: tick to received (bridge, backend and network; the two clocks must agree, so trust it
 * only on the core's machine or with synced clocks) and received to drawn (the wait for the next animation frame).
 * Read `window.__handDelay.report()` in the console; a line is also logged every 5 s.
 */
type Stat = { p50: number; p95: number; max: number; n: number };

const KEEP = 900;
const key = 'apprentice.delayProbe';

function stat(a: number[]): Stat | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const q = (p: number) => Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10;
  return { p50: q(0.5), p95: q(0.95), max: q(1), n: s.length };
}

class DelayProbe {
  readonly on: boolean;
  private readonly coreBase: string | null = null;
  private t0Wall: number | null = null;
  private core: unknown = null;
  private pending: { t: number; recv: number } | null = null;
  private readonly tickToRecv: number[] = [];
  private readonly recvToDraw: number[] = [];

  constructor() {
    let v: string | null = null;
    try {
      v = typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    } catch {
      v = null;
    }
    this.on = !!v && v !== '0' && typeof window !== 'undefined';
    if (!this.on || !v) return;
    this.coreBase = v.startsWith('http') ? v.replace(/\/$/, '') : `http://${window.location.hostname}:8765`;
    void this.poll();
    window.setInterval(() => void this.poll(), 5000);
    (window as unknown as { __handDelay: DelayProbe }).__handDelay = this;
  }

  private now(): number {
    return performance.timeOrigin + performance.now();
  }

  private async poll(): Promise<void> {
    try {
      const r = await fetch(`${this.coreBase}/debug/delay`);
      const j = (await r.json()) as { t0_wall_s: number | null };
      this.core = j;
      this.t0Wall = j.t0_wall_s;
    } catch {
      this.core = null;
    }
    if (this.recvToDraw.length) console.info('[hand delay]', JSON.stringify(this.report()));
  }

  /** A GloveFrame arrived on a socket; `t` is its time in seconds since the core's stream start. */
  received(t: number): void {
    if (!this.on) return;
    const recv = this.now();
    this.pending = { t, recv };
    if (this.t0Wall !== null) {
      this.tickToRecv.push(recv - (this.t0Wall + t) * 1000);
      if (this.tickToRecv.length > KEEP) this.tickToRecv.shift();
    }
  }

  /** The 3D hand was posed for this animation frame; counts the newest received frame once. */
  drawn(): void {
    if (!this.on || !this.pending) return;
    this.recvToDraw.push(this.now() - this.pending.recv);
    if (this.recvToDraw.length > KEEP) this.recvToDraw.shift();
    this.pending = null;
  }

  report(): Record<string, unknown> {
    const host = typeof window === 'undefined' ? '' : window.location.hostname;
    const sameMachine = !!this.coreBase && this.coreBase.includes(`//${host}:`) && ['localhost', '127.0.0.1'].includes(host);
    return {
      core: this.core,
      viewer_ms: { tick_to_received: stat(this.tickToRecv), received_to_drawn: stat(this.recvToDraw) },
      viewer_on_core_machine: sameMachine,
    };
  }
}

export const delayProbe = new DelayProbe();
