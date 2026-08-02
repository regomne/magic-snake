export type Turn = -1 | 1 | 2

export interface FormulaStep {
  joint: number
  turn: Turn
  source: string
}

export interface ParseResult {
  steps: FormulaStep[]
  errors: string[]
}

const ITEM = /^(\d+)\s*\(\s*(-?\d+)\s*\)$/
const POWER_ITEM = /^(\d+)\s*\^?\s*([⁻¹²³0-9-]+)$/

function normalizePower(value: string) {
  return value.replaceAll('⁻', '-').replaceAll('¹', '1').replaceAll('²', '2').replaceAll('³', '3')
}

export function parseFormula(input: string, pieceCount: number): ParseResult {
  const primaryNotation = input.includes('(')
  const chunks = input.split(primaryNotation ? /[,，;；\n]+/ : /[,，;；\s]+/).map((item) => item.trim()).filter(Boolean)
  const steps: FormulaStep[] = []
  const errors: string[] = []

  chunks.forEach((source, index) => {
    const match = source.match(ITEM)
    const powerMatch = primaryNotation ? null : source.match(POWER_ITEM)
    if (!match && !powerMatch) {
      errors.push(`第 ${index + 1} 项“${source}”格式不正确，应写成 3(-1)`)
      return
    }

    // In superscript notation nᵗ describes segment n relative to segment n-1,
    // while the workbench names that same connection joint n-1.
    const joint = powerMatch ? Number(powerMatch[1]) - 1 : Number(match![1])
    const turn = Number(powerMatch ? normalizePower(powerMatch[2]) : match![2])
    if (joint < 1 || joint >= pieceCount) {
      errors.push(`关节 ${joint} 超出范围（当前可用 1–${pieceCount - 1}）`)
      return
    }
    if (turn !== -1 && turn !== 1 && turn !== 2) {
      errors.push(`关节 ${joint} 的旋转只能是 1、-1 或 2`)
      return
    }
    steps.push({ joint, turn, source })
  })

  return { steps, errors }
}

export function formatFormula(steps: FormulaStep[]) {
  return steps.map(({ joint, turn }) => `${joint}(${turn})`).join(', ')
}
