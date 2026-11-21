// The "task done" sound, generated live with the Web Audio API
// (no audio file to download). A single wooden "tock".

const KEY = 'todo.sound'

export function soundEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function setSoundEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Still applies for this visit via the caller's state.
  }
}

let ctx: AudioContext | null = null

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext()
    // Browsers start audio paused until the user interacts; a click counts.
    if (ctx.state === 'suspended') void ctx.resume()
    return ctx
  } catch {
    return null // very old browser, or audio blocked
  }
}

/** A tone that drops in pitch and dies away fast: the "tock" of a click. */
function blip(ac: AudioContext, start: number, from: number, to: number, length: number, volume: number) {
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(from, start)
  osc.frequency.exponentialRampToValueAtTime(to, start + length)
  gain.gain.setValueAtTime(volume, start) // no fade-in: instant attack = crisp
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length)
  osc.connect(gain).connect(ac.destination)
  osc.start(start)
  osc.stop(start + length + 0.01)
}

/** A few milliseconds of bright noise: the sharp "tick" edge. */
function snap(ac: AudioContext, start: number, volume: number) {
  const length = Math.floor(ac.sampleRate * 0.006)
  const buffer = ac.createBuffer(1, length, ac.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3

  const src = ac.createBufferSource()
  const filter = ac.createBiquadFilter()
  const gain = ac.createGain()
  src.buffer = buffer
  filter.type = 'highpass'
  filter.frequency.value = 2500
  gain.gain.value = volume
  src.connect(filter).connect(gain).connect(ac.destination)
  src.start(start)
}

/**
 * A single wooden "tock", like tapping a wood block: a hollow mid tone
 * that drops in pitch, a soft edge so it starts crisply, and a low
 * thump underneath for weight.
 */
export function playCheck() {
  if (!soundEnabled()) return
  const ac = audio()
  if (!ac) return
  const t = ac.currentTime + 0.005
  snap(ac, t, 0.18) // soft edge, so it starts crisply
  blip(ac, t, 1250, 700, 0.045, 0.32) // the tock
  blip(ac, t, 210, 100, 0.06, 0.28) // thump you "feel"
}
