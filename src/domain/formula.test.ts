import { describe, expect, it } from 'vitest'
import { formatFormula, parseFormula } from './formula'
import { calculateTransforms, turnsAtStep } from './snake'

describe('parseFormula', () => {
  it('parses parenthesized piece notation and ignores piece one', () => {
    expect(parseFormula('1(1), 3(-1)，5(2)', 24).steps.map(({ joint, turn }) => [joint, turn]))
      .toEqual([[2, -1], [4, 2]])
  })

  it('reports invalid joints and turns', () => {
    expect(parseFormula('25(1), 2(3)', 24).errors).toHaveLength(2)
  })

  it('adapts common segment superscript notation to joint notation', () => {
    expect(parseFormula('2¹ 4² 10⁻¹ 24¹', 24).steps.map(({ joint, turn }) => [joint, turn]))
      .toEqual([[1, 1], [3, 2], [9, -1], [23, 1]])
  })

  it('parses standard speed-solving prism notation', () => {
    const result = parseFormula('2- 3- 4+ 6+ 24- 22x', 24)
    expect(result.notation).toBe('speed')
    expect(result.steps.map(({ joint, turn }) => [joint, turn]))
      .toEqual([[1, -1], [2, -1], [3, 1], [5, 1], [23, -1], [21, 2]])
  })

  it('formats either supported notation without changing its turns', () => {
    const steps = parseFormula('2(-1), 4(1), 6(2)', 24).steps
    expect(formatFormula(steps, 'speed')).toBe('2- 4+ 6x')
    expect(formatFormula(steps, 'joint')).toBe('2(-1), 4(1), 6(2)')
  })

  it('tolerates parenthesized no-ops and negative half-turns', () => {
    const result = parseFormula('2(0), 3(-2), 4(2)', 24)
    expect(result.errors).toEqual([])
    expect(result.steps.map(({ joint, turn }) => [joint, turn]))
      .toEqual([[2, 2], [3, 2]])
  })

  it('parses and formats fixed-width 0123 pose encoding', () => {
    const encoded = '031200000000000000000000'
    const result = parseFormula(encoded, 24)
    expect(result.notation).toBe('digits')
    expect(result.steps.map(({ joint, turn }) => [joint, turn]))
      .toEqual([[1, -1], [2, 1], [3, 2]])
    expect(formatFormula(result.steps, 'digits', 24)).toBe(encoded)
  })

  it('requires pose encoding to match the selected snake length', () => {
    expect(parseFormula('0312', 24).errors[0]).toContain('应为 24 位')
  })

  it('combines repeated turns when converting to pose encoding', () => {
    const steps = parseFormula('2(1), 2(2), 4(-1)', 24).steps
    expect(formatFormula(steps, 'digits', 24)).toBe(`0303${'0'.repeat(20)}`)
  })

  it('accumulates repeated joint turns at a selected step', () => {
    const steps = parseFormula('2(1), 3(-1), 2(1)', 24).steps
    expect(turnsAtStep(steps, 2, 24).slice(0, 2)).toEqual([1, -1])
    expect(turnsAtStep(steps, 3, 24).slice(0, 2)).toEqual([2, -1])
  })

  it('lays the zero state out as one straight alternating bar', () => {
    const pieces = calculateTransforms(4, [0, 0, 0])
    expect(pieces[1].position.x - pieces[0].position.x).toBeCloseTo(Math.SQRT2 / 2)
    expect(pieces.every((piece) => Math.abs(piece.position.y) < 0.00001)).toBe(true)
  })
})
