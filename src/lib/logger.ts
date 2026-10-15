type Level = 'debug' | 'info' | 'warn' | 'error'

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function currentLevel(): Level {
  const raw = (process.env['LOG_LEVEL'] ?? 'info').toLowerCase()
  return raw in ORDER ? (raw as Level) : 'info'
}

function stamp(): string {
  return new Date().toISOString().slice(11, 23)
}

function emit(level: Level, scope: string, message: string, extra?: unknown): void {
  if (ORDER[level] < ORDER[currentLevel()]) return
  const line = `${stamp()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`
  const stream = level === 'error' || level === 'warn' ? console.error : console.log
  if (extra === undefined) stream(line)
  else stream(line, extra)
}

export interface Logger {
  debug(message: string, extra?: unknown): void
  info(message: string, extra?: unknown): void
  warn(message: string, extra?: unknown): void
  error(message: string, extra?: unknown): void
}

export function createLogger(scope: string): Logger {
  return {
    debug: (m, e) => emit('debug', scope, m, e),
    info: (m, e) => emit('info', scope, m, e),
    warn: (m, e) => emit('warn', scope, m, e),
    error: (m, e) => emit('error', scope, m, e),
  }
}

/** Formatea una duracion en milisegundos como texto corto legible. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)} s`
  const m = Math.floor(s / 60)
  const rest = Math.round(s % 60)
  return `${m} min ${rest} s`
}
