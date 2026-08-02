import { describe, expect, it } from 'vitest'
import { analyzeCollisions, detectCollisions } from './collision'
import { parseFormula } from './formula'

describe('collision detection', () => {
  it('does not report the straight pose', () => {
    expect(detectCollisions(8, Array(7).fill(0))).toEqual([])
  })

  it('detects a folded pose where non-neighbouring shells overlap', () => {
    expect(detectCollisions(6, [2, 2, 2, 2, 2]).length).toBeGreaterThan(0)
  })

  it('allows the valid 1(1), 3(2), 4(2) rotation sequence', () => {
    const steps = parseFormula('1(1), 3(2), 4(2)', 24).steps
    expect(analyzeCollisions(steps, 24)).toEqual([])
  })
})
