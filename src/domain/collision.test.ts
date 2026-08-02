import { describe, expect, it } from 'vitest'
import { analyzeCollisions, calculateLatticePieces, calculateSnappedTransforms, complementaryType, detectCollisions } from './collision'
import { parseFormula } from './formula'
import { calculateTransforms } from './snake'

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

  it('encodes every final piece as an integer cell and one of 12 half-cube types', () => {
    const pieces = calculateLatticePieces(8, [1, -1, 2, 1, 0, -1, 2])
    expect(pieces.every((piece) => piece.cell.every(Number.isInteger))).toBe(true)
    expect(pieces.every((piece) => piece.type >= 0 && piece.type < 12)).toBe(true)
    expect(pieces.every((piece) => complementaryType(complementaryType(piece.type)) === piece.type)).toBe(true)
  })

  it('snaps final rendering transforms without changing the intended pose', () => {
    const turns = [1, -1, 2, 1, 0, -1, 2]
    const floating = calculateTransforms(8, turns)
    const snapped = calculateSnappedTransforms(8, turns)
    snapped.forEach((piece, index) => {
      expect(piece.position.distanceTo(floating[index].position)).toBeLessThan(1e-10)
      expect(Math.abs(piece.quaternion.dot(floating[index].quaternion))).toBeCloseTo(1, 10)
    })
  })

  it('matches matrix kinematics across long deterministic 48-piece formulas', () => {
    let seed = 0x5eed1234
    const randomTurn = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return [-1, 0, 1, 2][seed % 4]
    }
    for (let sample = 0; sample < 20; sample += 1) {
      const turns = Array.from({ length: 47 }, randomTurn)
      const floating = calculateTransforms(48, turns)
      const snapped = calculateSnappedTransforms(48, turns)
      snapped.forEach((piece, index) => {
        expect(piece.position.distanceTo(floating[index].position)).toBeLessThan(1e-9)
        expect(Math.abs(piece.quaternion.dot(floating[index].quaternion))).toBeCloseTo(1, 9)
      })
    }
  })
})
