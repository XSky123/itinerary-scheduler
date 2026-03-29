export const ROW_COLORS = [
  '#3b82f6', '#f59e0b', '#22c55e', '#ef4444',
  '#a855f7', '#06b6d4', '#ec4899', '#84cc16',
]

export const getRowColor = (index: number): string =>
  index >= 0 ? ROW_COLORS[index % ROW_COLORS.length] : '#9ca3af'

export function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
