import { Matrix4, Quaternion, Vector3 } from 'three'
import type { FormulaStep, Turn } from './formula'
import { PIECE_SIZE, turnsAtStep } from './snake'
import type { PieceTransform } from './snake'

export interface CollisionPair {
  pieces: [number, number]
}

export interface CollisionIssue extends CollisionPair {
  step: number
  kind: 'pose'
}

export interface LatticePiece {
  piece: number
  cell: [number, number, number]
  /** Missing-edge encoding: edge axis * 4 + the other two fixed coordinate bits. */
  type: number
  /** Right-angle corner on the negative extrusion end. */
  origin: [number, number, number]
  /** Oriented unit-cell axes for the two triangle legs and extrusion. */
  basis: [[number, number, number], [number, number, number], [number, number, number]]
}

const latticeX = new Vector3(Math.SQRT1_2, -Math.SQRT1_2, 0)
// X × Y = Z: keep the lattice basis right-handed so integer cross products
// have exactly the same rotation convention as Three.js.
const latticeY = new Vector3(Math.SQRT1_2, Math.SQRT1_2, 0)
const latticeZ = new Vector3(0, 0, 1)

type Int3 = [number, number, number]

interface ExactPieceState {
  /** Twice the right-angle corner, keeping square-face pivots integral. */
  origin2: Int3
  a: Int3
  b: Int3
  c: Int3
}

const add = (a: Int3, b: Int3): Int3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const subtract = (a: Int3, b: Int3): Int3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (value: Int3, factor: number): Int3 => [value[0] * factor, value[1] * factor, value[2] * factor]
const dot = (a: Int3, b: Int3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Int3, b: Int3): Int3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

function rotateQuarter(value: Int3, axis: Int3, quarterTurns: number): Int3 {
  const turn = ((quarterTurns % 4) + 4) % 4
  const parallel = scale(axis, dot(axis, value))
  if (turn === 0) return [...value]
  if (turn === 1) return add(cross(axis, value), parallel)
  if (turn === 2) return add(scale(value, -1), scale(parallel, 2))
  return add(scale(cross(axis, value), -1), parallel)
}

function nextExactState(state: ExactPieceState, index: number, formulaTurn: number): ExactPieceState {
  const even = index % 2 === 0
  const faceSpan = even ? state.a : state.b
  const axis = scale(even ? state.b : state.a, -1)
  const pivot2 = add(state.origin2, add(faceSpan, state.c))
  const unrotatedOrigin2 = add(state.origin2, scale(faceSpan, 2))
  // Formula clockwise is the negative right-hand angle, matching rendering.
  const turn = -formulaTurn
  return {
    origin2: add(pivot2, rotateQuarter(subtract(unrotatedOrigin2, pivot2), axis, turn)),
    a: rotateQuarter(scale(state.a, -1), axis, turn),
    b: rotateQuarter(scale(state.b, -1), axis, turn),
    c: rotateQuarter(state.c, axis, turn),
  }
}

function cornerCode(point: [number, number, number], cell: [number, number, number]) {
  const x = point[0] - cell[0]
  const y = point[1] - cell[1]
  const z = point[2] - cell[2]
  return x | (y << 1) | (z << 2)
}

function latticeVector(value: [number, number, number]) {
  return latticeX.clone().multiplyScalar(value[0])
    .addScaledVector(latticeY, value[1])
    .addScaledVector(latticeZ, value[2])
}

function typeFromCorners(corners: number[]) {
  const occupied = new Set(corners)
  const missing = Array.from({ length: 8 }, (_, corner) => corner).filter((corner) => !occupied.has(corner))
  if (missing.length !== 2) throw new Error('魔尺方块没有落在一个有效的半立方格中')
  const difference = missing[0] ^ missing[1]
  const edgeAxis = difference === 1 ? 0 : difference === 2 ? 1 : difference === 4 ? 2 : -1
  if (edgeAxis < 0) throw new Error('半立方格缺失的两个角没有组成一条边')
  const otherAxes = [0, 1, 2].filter((axis) => axis !== edgeAxis)
  const fixedBits = ((missing[0] >> otherAxes[0]) & 1) | (((missing[0] >> otherAxes[1]) & 1) << 1)
  return edgeAxis * 4 + fixedBits
}

/** The other half of the same diagonally divided unit cube. */
export function complementaryType(type: number) {
  return Math.floor(type / 4) * 4 + ((type % 4) ^ 0b11)
}

/**
 * Generates final poses directly in the snake's integer lattice. All state
 * transitions use integer addition, dot products and cross products only.
 */
export function calculateLatticePieces(pieceCount: number, turns: number[]): LatticePiece[] {
  const pieces: LatticePiece[] = []
  let state: ExactPieceState = { origin2: [0, 0, 0], a: [1, 0, 0], b: [0, -1, 0], c: [0, 0, 1] }
  for (let index = 0; index < pieceCount; index += 1) {
    if (state.origin2.some((coordinate) => coordinate % 2 !== 0)) {
      throw new Error('魔尺整数晶格状态落在了半格位置')
    }
    const origin = state.origin2.map((coordinate) => coordinate / 2) as Int3
    const latticeVertices: Int3[] = [
      origin,
      add(origin, state.a),
      add(origin, state.b),
      add(origin, state.c),
      add(add(origin, state.a), state.c),
      add(add(origin, state.b), state.c),
    ]
    const cell: [number, number, number] = [
      Math.min(...latticeVertices.map((vertex) => vertex[0])),
      Math.min(...latticeVertices.map((vertex) => vertex[1])),
      Math.min(...latticeVertices.map((vertex) => vertex[2])),
    ]
    pieces.push({
      piece: index + 1,
      cell,
      type: typeFromCorners(latticeVertices.map((vertex) => cornerCode(vertex, cell))),
      origin,
      basis: [state.a, state.b, state.c],
    })
    if (index < pieceCount - 1) state = nextExactState(state, index, turns[index] ?? 0)
  }
  return pieces
}

/** Converts a discrete lattice pose back into drift-free Three.js transforms. */
export function calculateSnappedTransforms(pieceCount: number, turns: number[]): PieceTransform[] {
  const pieces = calculateLatticePieces(pieceCount, turns)
  const width = Math.SQRT2 * PIECE_SIZE
  const worldOrigin = new Vector3(
    Math.SQRT1_2 * PIECE_SIZE - (width * (pieceCount - 1)) / 4,
    Math.SQRT1_2 * PIECE_SIZE,
    -PIECE_SIZE / 2,
  )
  return pieces.map((piece, index) => {
    const upper = index % 2 === 1
    const localOrigin = new Vector3(width / 2, upper ? 0 : width / 2, -PIECE_SIZE / 2)
    const localA = upper ? latticeX.clone().negate() : latticeX.clone()
    const localB = upper ? latticeY.clone() : latticeY.clone().negate()
    const localBasis = new Matrix4().makeBasis(localA, localB, latticeZ).transpose()
    const worldBasis = new Matrix4().makeBasis(
      latticeVector(piece.basis[0]),
      latticeVector(piece.basis[1]),
      latticeVector(piece.basis[2]),
    )
    const rotation = worldBasis.multiply(localBasis)
    const quaternion = new Quaternion().setFromRotationMatrix(rotation)
    const snappedOrigin = worldOrigin.clone()
      .addScaledVector(latticeX, piece.origin[0])
      .addScaledVector(latticeY, piece.origin[1])
      .addScaledVector(latticeZ, piece.origin[2])
    const position = snappedOrigin.sub(localOrigin.applyQuaternion(quaternion))
    return { position, quaternion }
  })
}

export function detectCollisions(pieceCount: number, turns: number[]): CollisionPair[] {
  const occupied = new Map<string, LatticePiece[]>()
  const collisions: CollisionPair[] = []
  calculateLatticePieces(pieceCount, turns).forEach((piece) => {
    const key = piece.cell.join(',')
    const cell = occupied.get(key) ?? []
    cell.forEach((other) => {
      // In one unit cube, two half-cubes have disjoint interiors if and only if
      // they are the complementary halves of the same diagonal cut.
      if (piece.type !== complementaryType(other.type)) collisions.push({ pieces: [other.piece, piece.piece] })
    })
    cell.push(piece)
    occupied.set(key, cell)
  })
  return collisions
}

/** Checks only the exact final pose after each step; swept paths are intentionally out of scope. */
export function analyzeCollisions(steps: FormulaStep[], pieceCount: number): CollisionIssue[] {
  const issues: CollisionIssue[] = []
  for (let step = 1; step <= steps.length; step += 1) {
    detectCollisions(pieceCount, turnsAtStep(steps, step, pieceCount)).forEach((collision) => {
      issues.push({ ...collision, step, kind: 'pose' })
    })
  }
  return issues
}

export function appendTurn(steps: FormulaStep[], joint: number, turn: Turn) {
  const previous = steps.at(-1)
  if (!previous || previous.joint !== joint) {
    return [...steps, { joint, turn, source: `${joint + 1}(${turn})` }]
  }

  const quarterTurns = ((previous.turn + turn) % 4 + 4) % 4
  if (quarterTurns === 0) return steps.slice(0, -1)
  const mergedTurn: Turn = quarterTurns === 1 ? 1 : quarterTurns === 2 ? 2 : -1
  return [
    ...steps.slice(0, -1),
    { joint, turn: mergedTurn, source: `${joint + 1}(${mergedTurn})` },
  ]
}
