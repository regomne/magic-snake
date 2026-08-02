import { describe, expect, it } from 'vitest'
import { analyzeCollisions } from './collision'
import { parseFormula } from './formula'
import { SHAPE_PRESETS } from './presets'

describe('shape presets', () => {
  it('contains formulas that parse for their declared snake length', () => {
    SHAPE_PRESETS.forEach((preset) => {
      const result = parseFormula(preset.formula, preset.pieceCount)
      expect(result.errors, preset.name).toEqual([])
      expect(result.notation, preset.name).toBe(preset.id === 'ball-24' ? 'speed' : 'digits')
    })
  })

  it('uses the ordered speed solution to build the ball without intermediate overlaps', () => {
    const ball = SHAPE_PRESETS.find((preset) => preset.id === 'ball-24')!
    const steps = parseFormula(ball.formula, ball.pieceCount).steps
    expect(analyzeCollisions(steps, ball.pieceCount)).toEqual([])
  })

  it('contains physically valid final poses', () => {
    const invalid = SHAPE_PRESETS.flatMap((preset) => {
      const steps = parseFormula(preset.formula, preset.pieceCount).steps
      const finalIssues = analyzeCollisions(steps, preset.pieceCount)
        .filter((issue) => issue.step === steps.length)
      return finalIssues.length ? [{ name: preset.name, finalIssues }] : []
    })
    expect(invalid).toEqual([])
  })
})
