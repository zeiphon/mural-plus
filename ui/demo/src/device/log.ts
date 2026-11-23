// The firmware's event log (src/plus/logger.cpp): lines stamped with the time
// since boot, kept in an 8 KB ring that survives a software restart but not a
// power-on.

const CAPACITY = 8192

export class EventLog {
  private text = ''
  private clock: () => number

  constructor(clock: () => number) {
    this.clock = clock
  }

  /** At boot. A power-on starts a new log; other restarts keep it, with a marker. */
  begin(reason: string, keep: boolean) {
    if (!keep) this.text = ''
    else this.append(`===== Restarted: ${reason} =====\n`)
  }

  print(message: string) {
    const ms = this.clock()
    const seconds = Math.floor(ms / 1000)
      .toString()
      .padStart(6, ' ')
    const millis = Math.floor(ms % 1000)
      .toString()
      .padStart(3, '0')
    this.append(`[${seconds}.${millis}] ${message}\n`)
  }

  dump(): string {
    return this.text
  }

  clear() {
    this.text = ''
  }

  private append(s: string) {
    this.text += s
    if (this.text.length > CAPACITY) {
      // Drop whole lines from the start, as the reader would see after the ring wraps
      const cut = this.text.indexOf('\n', this.text.length - CAPACITY)
      this.text = this.text.slice(cut + 1)
    }
  }
}
