import { Matrix4, Vector3 } from 'three'
import type { FormulaStep, Turn } from './formula'
import { calculateTransforms, PIECE_SIZE, turnsAtStep } from './snake'

export interface CollisionPair {
  pieces: [number, number]
}

export interface CollisionIssue extends CollisionPair {
  step: number
  kind: 'pose' | 'path'
}

const EDGE_INDICES: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 0], [3, 4], [4, 5], [5, 3], [0, 3], [1, 4], [2, 5],
]
const FACE_INDICES: Array<[number, number, number]> = [
  [0, 1, 2], [3, 5, 4], [0, 3, 4], [0, 4, 1], [1, 4, 5], [1, 5, 2], [2, 5, 3], [2, 3, 0],
]

function pieceVertices(index: number, matrix: Matrix4) {
  const width = Math.SQRT2 * PIECE_SIZE
  const upper = index % 2 === 1
  const points = upper
    ? [[0, width / 2], [width / 2, 0], [width, width / 2]]
    : [[0, 0], [width, 0], [width / 2, width / 2]]
  const centerX = width / 2
  const centerY = upper ? width / 3 : width / 6
  const shell = 0.982
  return [-0.491, 0.491].flatMap((z) => points.map(([x, y]) => new Vector3(
    centerX + (x - centerX) * shell,
    centerY + (y - centerY) * shell,
    z,
  ).applyMatrix4(matrix)))
}

function axesFor(vertices: Vector3[]) {
  const axes: Vector3[] = []
  FACE_INDICES.forEach(([a, b, c]) => {
    const axis = vertices[b].clone().sub(vertices[a]).cross(vertices[c].clone().sub(vertices[a]))
    if (axis.lengthSq() > 1e-10) axes.push(axis.normalize())
  })
  return axes
}

function edgeDirections(vertices: Vector3[]) {
  return EDGE_INDICES.map(([a, b]) => vertices[b].clone().sub(vertices[a]).normalize())
}

function separated(a: Vector3[], b: Vector3[], axis: Vector3) {
  let aMin = Infinity; let aMax = -Infinity; let bMin = Infinity; let bMax = -Infinity
  a.forEach((point) => { const value = point.dot(axis); aMin = Math.min(aMin, value); aMax = Math.max(aMax, value) })
  b.forEach((point) => { const value = point.dot(axis); bMin = Math.min(bMin, value); bMax = Math.max(bMax, value) })
  return aMax <= bMin + 1e-5 || bMax <= aMin + 1e-5
}

function intersects(a: Vector3[], b: Vector3[]) {
  const axes = [...axesFor(a), ...axesFor(b)]
  const aEdges = edgeDirections(a)
  const bEdges = edgeDirections(b)
  aEdges.forEach((edgeA) => bEdges.forEach((edgeB) => {
    const axis = edgeA.clone().cross(edgeB)
    if (axis.lengthSq() > 1e-10) axes.push(axis.normalize())
  }))
  return !axes.some((axis) => separated(a, b, axis))
}

export function detectCollisions(pieceCount: number, turns: number[]): CollisionPair[] {
  const transforms = calculateTransforms(pieceCount, turns)
  const vertices = transforms.map((transform, index) => {
    const matrix = new Matrix4().compose(transform.position, transform.quaternion, new Vector3(1, 1, 1))
    return pieceVertices(index, matrix)
  })
  const centers = vertices.map((points) => points.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / points.length))
  const radii = vertices.map((points, index) => Math.max(...points.map((point) => point.distanceTo(centers[index]))))
  const collisions: CollisionPair[] = []
  for (let first = 0; first < pieceCount; first += 1) {
    // Neighbours intentionally share a hinge, so only test non-adjacent shells.
    for (let second = first + 2; second < pieceCount; second += 1) {
      if (centers[first].distanceToSquared(centers[second]) > (radii[first] + radii[second]) ** 2) continue
      if (intersects(vertices[first], vertices[second])) collisions.push({ pieces: [first + 1, second + 1] })
    }
  }
  return collisions
}

export function analyzeCollisions(steps: FormulaStep[], pieceCount: number): CollisionIssue[] {
  const issues: CollisionIssue[] = []
  for (let step = 1; step <= steps.length; step += 1) {
    const previousTurns = turnsAtStep(steps, step - 1, pieceCount)
    const action = steps[step - 1]
    const samples = Math.abs(action.turn) === 2 ? 12 : 6
    // The compact notation does not preserve which semicircle was used for a
    // 180° turn, nor the small spring-joint pull-out used on the physical toy.
    // Its swept path is therefore under-specified; still validate its final
    // pose, but reserve path validation for turns with an explicit direction.
    const directions = action.turn === 2 ? [] : [action.turn]
    const pathCollisions = directions.map((direction) => {
      for (let sample = 1; sample < samples; sample += 1) {
        const turns = [...previousTurns]
        turns[action.joint - 1] += direction * (sample / samples)
        const collision = detectCollisions(pieceCount, turns)[0]
        if (collision) return collision
      }
      return undefined
    })
    if (pathCollisions.length > 0 && pathCollisions.every(Boolean)) {
      issues.push({ ...pathCollisions[0]!, step, kind: 'path' })
    }
    detectCollisions(pieceCount, turnsAtStep(steps, step, pieceCount)).forEach((collision) => {
      issues.push({ ...collision, step, kind: 'pose' })
    })
  }
  return issues
}

export function appendTurn(steps: FormulaStep[], joint: number, turn: Turn) {
  return [...steps, { joint, turn, source: `${joint}(${turn})` }]
}
