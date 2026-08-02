import { describe, expect, it } from 'vitest'
import { analyzeCollisions } from './collision'
import { parseFormula } from './formula'
import { SHAPE_PRESETS } from './presets'

describe('shape presets', () => {
  it('contains formulas that parse for their declared snake length', () => {
    SHAPE_PRESETS.forEach((preset) => {
      const result = parseFormula(preset.formula, preset.pieceCount)
      expect(result.errors, preset.name).toEqual([])
      expect(result.notation, preset.name).toBe('digits')
    })
  })

  it('contains physically valid final poses', () => {
    SHAPE_PRESETS.forEach((preset) => {
      const steps = parseFormula(preset.formula, preset.pieceCount).steps
      const finalIssues = analyzeCollisions(steps, preset.pieceCount)
        .filter((issue) => issue.step === steps.length)
      expect(finalIssues, preset.name).toEqual([])
    })
  })
})
