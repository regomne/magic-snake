import { Matrix4, Quaternion, Vector3 } from 'three'
import type { FormulaStep } from './formula'

export const PIECE_SIZE_MM = 30
export const PIECE_SIZE = 1

export interface PieceTransform {
  position: Vector3
  quaternion: Quaternion
}

const unitScale = new Vector3(1, 1, 1)
const rootTwo = Math.sqrt(2) * PIECE_SIZE
const localJointCenter = new Vector3((3 * rootTwo) / 4, rootTwo / 4, 0)

export function turnsAtStep(steps: FormulaStep[], stepIndex: number, pieceCount: number) {
  const turns = Array.from({ length: pieceCount - 1 }, () => 0)
  for (let index = 0; index < Math.min(stepIndex, steps.length); index += 1) {
    const step = steps[index]
    // Keep the accumulated value instead of normalizing it. Besides preserving
    // formula intent, this makes a repeated +1 animate forward through 360°
    // rather than suddenly taking the shortest path backward to zero.
    turns[step.joint - 1] += step.turn
  }
  return turns
}

export function calculateTransforms(pieceCount: number, turns: number[]): PieceTransform[] {
  // In the zero state, alternating half-cubes form one straight rectangular bar.
  const matrices = Array.from({ length: pieceCount }, (_, piece) =>
    new Matrix4().makeTranslation((rootTwo / 2) * piece, 0, 0),
  )

  for (let joint = 0; joint < pieceCount - 1; joint += 1) {
    const quarterTurns = turns[joint] ?? 0
    if (quarterTurns === 0) continue

    const previousMatrix = matrices[joint]
    const pivot = localJointCenter.clone().applyMatrix4(previousMatrix)
    const localAxis = joint % 2 === 0
      ? new Vector3(rootTwo / 2, rootTwo / 2, 0)
      : new Vector3(rootTwo / 2, -rootTwo / 2, 0)
    const axis = localAxis.transformDirection(previousMatrix).normalize()
    // Axis points from the supporting piece into the attached piece. Viewed back
    // toward the supporting rectangular face, positive right-hand rotation is clockwise.
    const rotate = new Matrix4().makeRotationAxis(axis, quarterTurns * Math.PI / 2)
    const aroundPivot = new Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z)
      .multiply(rotate)
      .multiply(new Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
    for (let piece = joint + 1; piece < pieceCount; piece += 1) {
      matrices[piece].premultiply(aroundPivot)
    }
  }

  // Use the zero-state midpoint as a permanent world anchor. Re-centering from
  // the animated bounds would make the whole snake drift and feel like the
  // camera is moving while a joint turns.
  const center = new Vector3((rootTwo * (pieceCount - 1)) / 4, 0, 0)
  return matrices.map((matrix) => {
    const position = new Vector3()
    const quaternion = new Quaternion()
    matrix.decompose(position, quaternion, unitScale.clone())
    return { position: position.sub(center), quaternion }
  })
}
