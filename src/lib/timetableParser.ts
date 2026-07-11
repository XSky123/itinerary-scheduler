import dayjs from 'dayjs'
import type { TransitOption, TransitType } from './models'

const TYPE_LABELS: Record<TransitType, string> = {
  flight: '飞机', train: '火车', bus: '巴士', shuttle: '摆渡', custom: '自定义',
}

export type TimetableParseResult = {
  transits: TransitOption[]
  errors: string[]
}

function normalizeTime(value: string): string | null {
  const match = value.replace(/：/g, ':').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

export function parseTimetableText(
  text: string,
  options: { date: string; type: TransitType; category?: string; notes?: string }
): TimetableParseResult {
  const transits: TransitOption[] = []
  const errors: string[] = []
  const seed = Date.now().toString(36)

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim()
    if (!line) return
    const match = line.match(/^(\d{1,2}[:：]\d{2})\s*(?:[-–—~～→至]\s*)?(\d{1,2}[:：]\d{2})\s*(?:[,，|\t]\s*)?(.*)$/)
    if (!match) {
      errors.push(`第 ${index + 1} 行：请写成 09:00-11:30 班次名称`)
      return
    }
    const departure = normalizeTime(match[1])
    const arrival = normalizeTime(match[2])
    if (!departure || !arrival || arrival <= departure) {
      errors.push(`第 ${index + 1} 行：起止时间不正确`)
      return
    }
    const departureTime = dayjs(`${options.date}T${departure}`).toISOString()
    const arrivalTime = dayjs(`${options.date}T${arrival}`).toISOString()
    transits.push({
      id: `import-${seed}-${index}-${Math.random().toString(36).slice(2, 6)}`,
      type: options.type,
      name: match[3].trim() || `${TYPE_LABELS[options.type]} ${departure}`,
      departureTime,
      arrivalTime,
      duration: dayjs(arrivalTime).diff(dayjs(departureTime), 'minute'),
      category: options.category || undefined,
      notes: options.notes || undefined,
    })
  })

  return { transits, errors }
}
