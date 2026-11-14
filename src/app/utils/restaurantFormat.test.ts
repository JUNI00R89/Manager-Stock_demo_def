import { describe, expect, it } from 'vitest'
import {
  formatDayMonth,
  formatElapsed,
  formatJornadaTitle,
  formatMinutesAsTime,
  formatMoney,
  formatReadyElapsed,
  formatTime,
  getInitials,
  getJornadaKey,
  jornadaDateFromKey,
  minutesSince,
  orderItemSummary,
  normalizeText,
  parseTimeToMinutes,
} from './restaurantFormat'

describe('formatMoney', () => {
  it('formatea pesos colombianos sin decimales', () => {
    expect(formatMoney(1234)).toContain('1.234')
    expect(formatMoney(1234)).toContain('$')
  })

  it('redondea y tolera valores inválidos', () => {
    expect(formatMoney(1234.56)).toContain('1.235')
    expect(formatMoney(Number.NaN)).toContain('0')
  })
})

describe('formatTime', () => {
  it('formatea horas y minutos', () => {
    expect(formatTime(new Date(2026, 0, 5, 14, 30))).toBe('14:30')
  })

  it('devuelve vacío para fechas inválidas', () => {
    expect(formatTime('no-es-fecha')).toBe('')
  })
})

describe('formatDayMonth', () => {
  it('incluye el día de la semana y la fecha', () => {
    expect(formatDayMonth(new Date(2026, 0, 5, 12, 0))).toBe('lun 05/01')
  })

  it('devuelve vacío para fechas inválidas', () => {
    expect(formatDayMonth('no-es-fecha')).toBe('')
  })
})

describe('parseTimeToMinutes', () => {
  it('convierte horas válidas a minutos', () => {
    expect(parseTimeToMinutes('06:30')).toBe(390)
    expect(parseTimeToMinutes('6:05')).toBe(365)
    expect(parseTimeToMinutes('00:00')).toBe(0)
  })

  it('recorta horas y minutos fuera de rango', () => {
    expect(parseTimeToMinutes('25:99')).toBe(23 * 60 + 59)
  })

  it('usa las 06:00 como valor por defecto', () => {
    expect(parseTimeToMinutes('')).toBe(360)
    expect(parseTimeToMinutes('abc')).toBe(360)
  })
})

describe('formatMinutesAsTime', () => {
  it('convierte minutos a HH:MM', () => {
    expect(formatMinutesAsTime(390)).toBe('06:30')
    expect(formatMinutesAsTime(1439)).toBe('23:59')
  })

  it('normaliza valores fuera del día', () => {
    expect(formatMinutesAsTime(1440)).toBe('00:00')
    expect(formatMinutesAsTime(-30)).toBe('23:30')
  })
})

describe('getJornadaKey', () => {
  it('asigna la madrugada a la jornada anterior', () => {
    expect(getJornadaKey(new Date(2026, 0, 6, 5, 30), '06:00')).toBe('2026-01-05')
  })

  it('mantiene el mismo día después del inicio de jornada', () => {
    expect(getJornadaKey(new Date(2026, 0, 6, 7, 0), '06:00')).toBe('2026-01-06')
  })
})

describe('jornadaDateFromKey', () => {
  it('reconstruye la fecha de la jornada', () => {
    const date = jornadaDateFromKey('2026-01-05')
    expect(date.getFullYear()).toBe(2026)
    expect(date.getMonth()).toBe(0)
    expect(date.getDate()).toBe(5)
  })
})

describe('formatJornadaTitle', () => {
  it('describe la jornada con su rango horario', () => {
    expect(formatJornadaTitle('2026-01-05', '06:00')).toBe(
      'Jornada del lun 05/01 · 06:00 a 05:59',
    )
  })
})

describe('minutesSince', () => {
  it('calcula los minutos transcurridos', () => {
    expect(minutesSince('2026-01-05T10:00:00', new Date('2026-01-05T10:30:00'))).toBe(30)
  })

  it('devuelve cero sin fecha o con fecha inválida', () => {
    expect(minutesSince(undefined, new Date())).toBe(0)
    expect(minutesSince('no-es-fecha', new Date())).toBe(0)
  })

  it('nunca devuelve valores negativos', () => {
    expect(minutesSince('2026-01-05T10:30:00', new Date('2026-01-05T10:00:00'))).toBe(0)
  })
})

describe('formatElapsed', () => {
  const now = new Date('2026-01-05T12:00:00')

  it('describe el tiempo transcurrido', () => {
    expect(formatElapsed(undefined, now)).toBe('')
    expect(formatElapsed('2026-01-05T11:59:45', now)).toBe('ahora')
    expect(formatElapsed('2026-01-05T11:55:00', now)).toBe('hace 5 min')
    expect(formatElapsed('2026-01-05T10:55:00', now)).toBe('hace 1 h 5 min')
    expect(formatElapsed('2026-01-05T10:00:00', now)).toBe('hace 2 h')
  })
})

describe('formatReadyElapsed', () => {
  const now = new Date('2026-01-05T12:00:00')

  it('describe cuándo estuvo listo', () => {
    expect(formatReadyElapsed(undefined, now)).toBe('Listo')
    expect(formatReadyElapsed('2026-01-05T11:59:45', now)).toBe('Listo ahora')
    expect(formatReadyElapsed('2026-01-05T11:55:00', now)).toBe('Listo hace 5 min')
    expect(formatReadyElapsed('2026-01-05T10:00:00', now)).toBe('Listo hace 2 h')
  })
})

describe('getInitials', () => {
  it('toma las iniciales de nombres y apellidos', () => {
    expect(getInitials('Ana María Pérez')).toBe('AP')
    expect(getInitials('Juan')).toBe('JU')
  })

  it('tolera nombres vacíos', () => {
    expect(getInitials('')).toBe('?')
    expect(getInitials('   ')).toBe('?')
  })
})

describe('orderItemSummary', () => {
  it('concuerda singular y plural', () => {
    expect(orderItemSummary(1)).toBe('1 producto')
    expect(orderItemSummary(0)).toBe('0 productos')
    expect(orderItemSummary(3)).toBe('3 productos')
  })
})

describe('normalizeText', () => {
  it('quita tildes y mayúsculas para buscar', () => {
    expect(normalizeText('Café con Leche ÑANDÚ')).toBe('cafe con leche nandu')
  })
})
