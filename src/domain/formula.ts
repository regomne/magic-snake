export type Turn = -1 | 1 | 2
export type FormulaNotation = 'joint' | 'speed'

export interface FormulaStep {
  joint: number
  turn: Turn
  source: string
}

export interface ParseResult {
  steps: FormulaStep[]
  errors: string[]
  notation?: FormulaNotation
}

const ITEM = /^(\d+)\s*\(\s*(-?\d+)\s*\)$/
const SPEED_ITEM = /^(\d+)\s*([+\-xX×])$/
const POWER_ITEM = /^(\d+)\s*\^?\s*([⁻¹²³0-9-]+)$/

function normalizePower(value: string) {
  return value.replaceAll('⁻', '-').replaceAll('¹', '1').replaceAll('²', '2').replaceAll('³', '3')
}

export function parseFormula(input: string, pieceCount: number): ParseResult {
  if (!input.trim()) return { steps: [], errors: [], notation: undefined }
  const primaryNotation = input.includes('(')
  const chunks = input.split(primaryNotation ? /[,，;；\n]+/ : /[,，;；\s]+/).map((item) => item.trim()).filter(Boolean)
  const steps: FormulaStep[] = []
  const errors: string[] = []

  chunks.forEach((source, index) => {
    const match = source.match(ITEM)
    const speedMatch = primaryNotation ? null : source.match(SPEED_ITEM)
    const powerMatch = primaryNotation ? null : source.match(POWER_ITEM)
    if (!match && !speedMatch && !powerMatch) {
      errors.push(`第 ${index + 1} 项“${source}”格式不正确，应写成 3(-1) 或 4-`)
      return
    }

    const segmentNotation = speedMatch ?? powerMatch
    // Both public notations address pieces. Piece n rotates at the connection
    // to piece n-1, which is joint n-1 in the internal model.
    const piece = Number(segmentNotation ? segmentNotation[1] : match![1])
    const joint = piece - 1
    const speedTurn = speedMatch?.[2]
    const rawTurn = speedTurn
      ? speedTurn === '+' ? 1 : speedTurn === '-' ? -1 : 2
      : Number(powerMatch ? normalizePower(powerMatch[2]) : match![2])
    // Parenthesized formulas found in the wild sometimes include explicit
    // no-ops or use -2 for the same half-turn as 2. Accept both as input
    // tolerance, while keeping the canonical output compact.
    const turn = match && rawTurn === -2 ? 2 : rawTurn
    if (piece < 1 || piece > pieceCount) {
      errors.push(`方块 ${piece} 超出范围（当前可用 1–${pieceCount}）`)
      return
    }
    if (match && rawTurn === 0) return
    if (turn !== -1 && turn !== 1 && turn !== 2) {
      errors.push(`方块 ${piece} 的旋转只能是 1、-1 或 2`)
      return
    }
    // Piece 1 has no preceding joint, so its turn is a harmless no-op.
    if (piece === 1) return
    steps.push({ joint, turn, source })
  })

  return { steps, errors, notation: primaryNotation ? 'joint' : 'speed' }
}

export function formatFormula(steps: FormulaStep[], notation: FormulaNotation = 'joint') {
  if (notation === 'speed') {
    return steps.map(({ joint, turn }) => `${joint + 1}${turn === 1 ? '+' : turn === -1 ? '-' : 'x'}`).join(' ')
  }
  return steps.map(({ joint, turn }) => `${joint + 1}(${turn})`).join(', ')
}
