import { describe, expect, it } from 'vitest'
import { parseFormula } from './formula'
import { calculateTransforms, turnsAtStep } from './snake'

describe('parseFormula', () => {
  it('parses the primary sparse joint notation', () => {
    expect(parseFormula('1(1), 3(-1)，5(2)', 24).steps.map(({ joint, turn }) => [joint, turn]))
      .toEqual([[1, 1], [3, -1], [5, 2]])
  })

  it('reports invalid joints and turns', () => {
    expect(parseFormula('24(1), 2(3)', 24).errors).toHaveLength(2)
  })

  it('adapts common segment superscript notation to joint notation', () => {
    expect(parseFormula('2¹ 4² 10⁻¹ 24¹', 24).steps.map(({ joint, turn }) => [joint, turn]))
      .toEqual([[1, 1], [3, 2], [9, -1], [23, 1]])
  })

  it('accumulates repeated joint turns at a selected step', () => {
    const steps = parseFormula('1(1), 2(-1), 1(1)', 24).steps
    expect(turnsAtStep(steps, 2, 24).slice(0, 2)).toEqual([1, -1])
    expect(turnsAtStep(steps, 3, 24).slice(0, 2)).toEqual([2, -1])
  })

  it('lays the zero state out as one straight alternating bar', () => {
    const pieces = calculateTransforms(4, [0, 0, 0])
    expect(pieces[1].position.x - pieces[0].position.x).toBeCloseTo(Math.SQRT2 / 2)
    expect(pieces.every((piece) => Math.abs(piece.position.y) < 0.00001)).toBe(true)
  })
})
