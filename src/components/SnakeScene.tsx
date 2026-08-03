import { CameraControls, CameraControlsImpl, ContactShadows, Edges, Environment, Lightformer } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import type { MutableRefObject } from 'react'
import {
  ACESFilmicToneMapping,
  Box3,
  DoubleSide,
  Euler,
  ExtrudeGeometry,
  Group,
  Matrix4,
  MeshStandardMaterial,
  PlaneGeometry,
  PerspectiveCamera,
  Quaternion,
  Shape,
  Sphere,
  SRGBColorSpace,
  Vector3,
} from 'three'
import type { FormulaStep } from '../domain/formula'
import { calculateSnappedTransforms } from '../domain/collision'
import { calculateTransforms, PIECE_SIZE, turnsAtStep } from '../domain/snake'

interface SnakeSceneProps {
  pieceCount: number
  steps: FormulaStep[]
  currentStep: number
  animationDuration: number
  resetSignal: number
  animationPaused?: boolean
  autoPlaying?: boolean
  viewportFitSignal?: number
  viewportFitActive?: boolean
  viewportFitPadding?: number
  viewportLocked?: boolean
  freeOrbit?: boolean
  onViewportFitComplete?: () => void
  onBlockedZoom?: () => void
  selectedPiece?: number
  collisionPieces?: number[]
  pieceColors?: string[]
  onSelectPiece?: (piece?: number) => void
  onViewControlStart?: () => void
  onViewControlEnd?: () => void
}

function createPrismGeometry(upper: boolean) {
  const s = PIECE_SIZE
  const width = Math.sqrt(2) * s
  // Injection-moulded snakes have a small but visible radius along every shell
  // edge. Keeping this geometric (instead of faking it in the material) also
  // gives the joints a convincing highlight when they turn.
  const bevel = 0.024 // about 0.72 mm on a nominal 30 mm block
  const shape = new Shape()
  if (upper) {
    shape.moveTo(0, width / 2)
    shape.lineTo(width / 2, 0)
    shape.lineTo(width, width / 2)
  } else {
    shape.moveTo(0, 0)
    shape.lineTo(width, 0)
    shape.lineTo(width / 2, width / 2)
  }
  shape.closePath()
  const depth = s - bevel * 2
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 4,
    bevelSize: bevel,
    bevelThickness: bevel,
    // ExtrudeGeometry otherwise grows the bevel outside the authored triangle.
    // On a mating face that made two adjacent shells overlap by about 1.27 mm.
    // Starting the bevel inward keeps the rounded shell inside its nominal part.
    bevelOffset: -bevel,
    curveSegments: 1,
  })
  // Leave clearance between the plastic shells while keeping the hinge axes on
  // the nominal full-size geometry. The dark joint liner below occupies this
  // clearance, so the join reads as an assembled mechanism rather than a crack.
  const shellScale = 0.992
  const centerX = width / 2
  const centerY = upper ? width / 3 : width / 6
  geometry.translate(-centerX, -centerY, -depth / 2)
  geometry.scale(shellScale, shellScale, shellScale)
  geometry.translate(centerX, centerY, 0)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

function jointFrame(index: number) {
  const diagonal = Math.SQRT1_2
  const sign = index % 2 === 0 ? 1 : -1
  const normal = new Vector3(diagonal, sign * diagonal, 0)
  const tangent = new Vector3(-sign * diagonal, diagonal, 0)
  const quaternion = new Quaternion().setFromRotationMatrix(
    new Matrix4().makeBasis(tangent, new Vector3(0, 0, 1), normal),
  )
  return { normal, quaternion }
}

function SnakeModel({
  pieceCount,
  steps,
  currentStep,
  animationDuration,
  animationPaused = false,
  selectedPiece,
  collisionPieces = [],
  pieceColors = ['#286fbd', '#fffdf8'],
  onSelectPiece,
  focusTarget,
  modelBounds,
  foldedBounds,
  foldedPieceCount,
}: Omit<SnakeSceneProps, 'resetSignal' | 'autoPlaying' | 'viewportFitSignal' | 'viewportFitActive' | 'viewportLocked' | 'onViewportFitComplete' | 'onBlockedZoom' | 'onViewControlStart' | 'onViewControlEnd'> & {
  focusTarget: MutableRefObject<Vector3>
  modelBounds: MutableRefObject<Box3>
  foldedBounds: MutableRefObject<Box3>
  foldedPieceCount: number
}) {
  const groups = useRef<Array<Group | null>>([])
  const materials = useRef<Array<MeshStandardMaterial | null>>([])
  const invalidate = useThree((state) => state.invalidate)
  const geometries = useMemo(() => [createPrismGeometry(false), createPrismGeometry(true)], [])
  const seamGeometry = useMemo(() => new PlaneGeometry(PIECE_SIZE * 0.965, PIECE_SIZE * 0.965), [])
  const jointFrames = useMemo(() => Array.from({ length: pieceCount - 1 }, (_, index) => jointFrame(index)), [pieceCount])
  const targetTurns = useMemo(() => turnsAtStep(steps, currentStep, pieceCount), [steps, currentStep, pieceCount])
  const animatedTurns = useRef([...targetTurns])
  const initialTransforms = useMemo(
    () => calculateSnappedTransforms(pieceCount, targetTurns),
    // A length change remounts/reinitializes the chain; step changes animate below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pieceCount],
  )
  const targetFitTransforms = useMemo(
    () => calculateSnappedTransforms(pieceCount, targetTurns),
    [pieceCount, targetTurns],
  )

  function updateFocusTarget(transforms: ReturnType<typeof calculateTransforms>) {
    const rootRotation = new Quaternion().setFromEuler(new Euler(-0.18, 0.18, 0))
    const bounds = new Box3()
    transforms.forEach((transform, index) => {
      const localBounds = geometries[index % 2].boundingBox
      if (!localBounds) return
      const center = localBounds.getCenter(new Vector3())
        .applyQuaternion(transform.quaternion)
        .add(transform.position)
        .applyQuaternion(rootRotation)
      if (selectedPiece === index + 1) focusTarget.current.copy(center)
      for (const x of [localBounds.min.x, localBounds.max.x]) {
        for (const y of [localBounds.min.y, localBounds.max.y]) {
          for (const z of [localBounds.min.z, localBounds.max.z]) {
            const worldPoint = new Vector3(x, y, z)
              .applyQuaternion(transform.quaternion)
              .add(transform.position)
              .applyQuaternion(rootRotation)
            bounds.expandByPoint(worldPoint)
          }
        }
      }
    })
    modelBounds.current.copy(bounds)
    if (selectedPiece === undefined && !bounds.isEmpty()) bounds.getCenter(focusTarget.current)
  }

  function updateFoldedBounds(transforms: ReturnType<typeof calculateTransforms>) {
    const rootRotation = new Quaternion().setFromEuler(new Euler(-0.18, 0.18, 0))
    foldedBounds.current.makeEmpty()
    transforms.slice(0, foldedPieceCount).forEach((transform, index) => {
      const localBounds = geometries[index % 2].boundingBox
      if (!localBounds) return
      for (const x of [localBounds.min.x, localBounds.max.x]) {
        for (const y of [localBounds.min.y, localBounds.max.y]) {
          for (const z of [localBounds.min.z, localBounds.max.z]) {
            foldedBounds.current.expandByPoint(new Vector3(x, y, z)
              .applyQuaternion(transform.quaternion)
              .add(transform.position)
              .applyQuaternion(rootRotation))
          }
        }
      }
    })
  }

  useEffect(() => () => {
    geometries.forEach((geometry) => geometry.dispose())
    seamGeometry.dispose()
  }, [geometries, seamGeometry])
  // Initialize newly mounted blocks before paint. Step changes deliberately do
  // not run this effect: useFrame is the only path from the old pose to the new.
  useLayoutEffect(() => {
    animatedTurns.current = [...targetTurns]
    groups.current.forEach((group, index) => {
      const target = initialTransforms[index]
      if (group && target) {
        group.position.copy(target.position)
        group.quaternion.copy(target.quaternion)
      }
    })
    updateFocusTarget(initialTransforms)
    // targets represents the zero/current pose at mount; pieceCount remounts the set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceCount, initialTransforms])

  useLayoutEffect(() => {
    updateFoldedBounds(targetFitTransforms)
    // updateFoldedBounds operates only on the values listed here and is kept
    // local so it can share the already memoized geometry collection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetFitTransforms, foldedPieceCount])

  // In demand-driven mode a React state change schedules the first frame, then
  // the animation explicitly asks for more frames only until every joint settles.
  useEffect(() => invalidate(), [targetTurns, selectedPiece, animationPaused, invalidate])

  useFrame((_, rawDelta) => {
    // With frameloop="demand", the first frame after a long idle can report the
    // whole idle interval as delta. Cap it so a new joint turn cannot snap to
    // its target in that single frame.
    const delta = animationPaused ? 0 : Math.min(rawDelta, 1 / 30)
    const lambda = animationDuration <= 0 ? 1000 : 5 / animationDuration
    const alpha = 1 - Math.exp(-lambda * delta)
    const currentTurns = animatedTurns.current
    let isAnimating = false
    for (let index = 0; index < targetTurns.length; index += 1) {
      currentTurns[index] += (targetTurns[index] - currentTurns[index]) * alpha
      if (Math.abs(targetTurns[index] - currentTurns[index]) < 0.0001) currentTurns[index] = targetTurns[index]
      else isAnimating = true
    }
    // Rebuild from fractional joint angles every frame. Every downstream block
    // therefore receives the exact same rigid rotation around the active hinge.
    const frameTransforms = isAnimating
      ? calculateTransforms(pieceCount, currentTurns)
      : calculateSnappedTransforms(pieceCount, currentTurns)
    groups.current.forEach((group, index) => {
      const target = frameTransforms[index]
      if (!group || !target) return
      group.position.copy(target.position)
      group.quaternion.copy(target.quaternion)
    })
    updateFocusTarget(frameTransforms)
    materials.current.forEach((material, index) => {
      if (!material) return
      const pieceNumber = index + 1
      if (collisionPieces.includes(pieceNumber)) {
        material.emissive.set('#a8160b')
        material.emissiveIntensity = 0.65
      } else if (selectedPiece === pieceNumber) {
        material.emissive.set('#000000')
        material.emissiveIntensity = 0
      } else {
        material.emissive.set('#000000')
        material.emissiveIntensity = 0
      }
    })
    if (isAnimating && !animationPaused) invalidate()
  })

  return (
    <group rotation={[-0.18, 0.18, 0]}>
      {initialTransforms.map((_, index) => {
        const color = pieceColors[index % pieceColors.length]
        const joint = jointFrames[index]
        const pieceNumber = index + 1
        const colliding = collisionPieces.includes(pieceNumber)
        return (
          <group
            key={index}
            ref={(node) => { groups.current[index] = node }}
          >
            <mesh
              geometry={geometries[index % 2]}
              castShadow
              receiveShadow
              onClick={(event) => {
                event.stopPropagation()
                if (event.button === 0 && event.delta <= 3) onSelectPiece?.(pieceNumber)
              }}
              onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = onSelectPiece ? 'pointer' : '' }}
              onPointerOut={() => { document.body.style.cursor = '' }}
            >
              <meshStandardMaterial
                ref={(material) => { materials.current[index] = material }}
                color={color}
                roughness={0.9}
                metalness={0}
                envMapIntensity={0.3}
                emissive={colliding ? '#a8160b' : '#000000'}
                emissiveIntensity={colliding ? 0.65 : 0}
              />
            </mesh>
            {selectedPiece === pieceNumber && (
              <>
                <Edges
                  geometry={geometries[index % 2]}
                  scale={1.026}
                  threshold={12}
                  color="#16232c"
                  lineWidth={4}
                  toneMapped={false}
                  raycast={() => null}
                />
                <Edges
                  geometry={geometries[index % 2]}
                  scale={1.032}
                  threshold={12}
                  color="#ffffff"
                  lineWidth={1.5}
                  toneMapped={false}
                  raycast={() => null}
                />
              </>
            )}
            {joint && (
              <mesh
                geometry={seamGeometry}
                position={[(3 * Math.SQRT2 * PIECE_SIZE) / 4, (Math.SQRT2 * PIECE_SIZE) / 4, 0]}
                quaternion={joint.quaternion}
                renderOrder={-1}
                receiveShadow
                onClick={(event) => {
                  event.stopPropagation()
                  if (event.button === 0 && event.delta <= 3) onSelectPiece?.(pieceNumber)
                }}
              >
                <meshStandardMaterial
                  color="#263039"
                  roughness={0.72}
                  metalness={0}
                  side={DoubleSide}
                />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}

function CameraRig({
  resetSignal,
  pieceCount,
  focusTarget,
  modelBounds,
  foldedBounds,
  currentStep,
  autoPlaying,
  viewportFitSignal,
  viewportFitActive,
  viewportFitPadding,
  viewportLocked,
  freeOrbit,
  onViewportFitComplete,
  onBlockedZoom,
  onViewControlStart,
  onViewControlEnd,
}: {
  resetSignal: number
  pieceCount: number
  focusTarget: MutableRefObject<Vector3>
  modelBounds: MutableRefObject<Box3>
  foldedBounds: MutableRefObject<Box3>
  currentStep: number
  autoPlaying: boolean
  viewportFitSignal: number
  viewportFitActive: boolean
  viewportFitPadding: number
  viewportLocked: boolean
  freeOrbit: boolean
  onViewportFitComplete?: () => void
  onBlockedZoom?: () => void
  onViewControlStart?: () => void
  onViewControlEnd?: () => void
}) {
  const controls = useRef<CameraControlsImpl | null>(null)
  const appliedFocus = useRef(new Vector3(Number.NaN, Number.NaN, Number.NaN))
  const userControlling = useRef(false)
  const lastFitStep = useRef(0)
  const observedStep = useRef(0)
  const fitSphere = useRef(new Sphere())
  const playbackCenter = useRef(new Vector3())
  const autoFitDistance = useRef<number | undefined>(undefined)
  const startFitSignal = useRef(viewportFitSignal)
  const startFitCenter = useRef<Vector3 | undefined>(undefined)
  const startFitDirection = useRef<Vector3 | undefined>(undefined)
  const orbitPointer = useRef<{
    id: number
    x: number
    y: number
    startX: number
    startY: number
    dragging: boolean
    velocityX: number
    velocityY: number
    lastMoveTime: number
    continuedInertia: boolean
  } | undefined>(undefined)
  const orbitInertia = useRef<{ yaw: number; pitch: number } | undefined>(undefined)
  const orbitContext = useRef({
    currentStep,
    viewportFitActive,
    viewportFitSignal,
    onViewportFitComplete,
    onViewControlStart,
    onViewControlEnd,
  })
  orbitContext.current = {
    currentStep,
    viewportFitActive,
    viewportFitSignal,
    onViewportFitComplete,
    onViewControlStart,
    onViewControlEnd,
  }
  const { camera, gl, invalidate } = useThree()
  const lastZoomNotice = useRef(0)
  useEffect(() => {
    if (controls.current) {
      controls.current.mouseButtons.left = freeOrbit
        ? CameraControlsImpl.ACTION.NONE
        : CameraControlsImpl.ACTION.ROTATE
      controls.current.touches.one = freeOrbit
        ? CameraControlsImpl.ACTION.NONE
        : CameraControlsImpl.ACTION.TOUCH_ROTATE
      controls.current.mouseButtons.right = viewportLocked
        ? CameraControlsImpl.ACTION.NONE
        : CameraControlsImpl.ACTION.OFFSET
    }
  }, [freeOrbit, viewportLocked])
  useEffect(() => {
    const showBlockedNotice = () => {
      const now = performance.now()
      if (now - lastZoomNotice.current > 1000) {
        lastZoomNotice.current = now
        onBlockedZoom?.()
      }
    }
    const blockZoom = (event: WheelEvent) => {
      if (!viewportLocked) return
      event.preventDefault()
      event.stopImmediatePropagation()
      showBlockedNotice()
    }
    const blockRightPan = (event: PointerEvent) => {
      if (!viewportLocked || event.button !== 2) return
      event.preventDefault()
      event.stopImmediatePropagation()
      showBlockedNotice()
    }
    gl.domElement.addEventListener('wheel', blockZoom, { capture: true, passive: false })
    gl.domElement.addEventListener('pointerdown', blockRightPan, { capture: true })
    return () => {
      gl.domElement.removeEventListener('wheel', blockZoom, { capture: true })
      gl.domElement.removeEventListener('pointerdown', blockRightPan, { capture: true })
    }
  }, [gl, viewportLocked, onBlockedZoom])
  useEffect(() => {
    if (!freeOrbit) return
    const element = gl.domElement
    const beginOrbit = (event: PointerEvent) => {
      if (event.pointerType === 'touch' && !event.isPrimary) {
        const pointer = orbitPointer.current
        if (!pointer) return
        orbitPointer.current = undefined
        if (element.hasPointerCapture(pointer.id)) element.releasePointerCapture(pointer.id)
        if (pointer.dragging || pointer.continuedInertia) {
          userControlling.current = false
          orbitContext.current.onViewControlEnd?.()
        }
        return
      }
      if (event.button !== 0 || orbitPointer.current) return
      const continuedInertia = orbitInertia.current !== undefined
      orbitInertia.current = undefined
      orbitPointer.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
        dragging: false,
        velocityX: 0,
        velocityY: 0,
        lastMoveTime: performance.now(),
        continuedInertia,
      }
      element.setPointerCapture(event.pointerId)
    }
    const moveOrbit = (event: PointerEvent) => {
      const pointer = orbitPointer.current
      const controlsInstance = controls.current
      if (!pointer || pointer.id !== event.pointerId || !controlsInstance) return
      const dx = event.clientX - pointer.x
      const dy = event.clientY - pointer.y
      pointer.x = event.clientX
      pointer.y = event.clientY
      if (!pointer.dragging) {
        if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) <= 2) return
        pointer.dragging = true
        if (!userControlling.current) {
          userControlling.current = true
          controlsInstance.stop()
          const context = orbitContext.current
          const interruptedViewportFit = context.viewportFitActive
          startFitSignal.current = context.viewportFitSignal
          startFitCenter.current = undefined
          startFitDirection.current = undefined
          autoFitDistance.current = undefined
          if (interruptedViewportFit) context.onViewportFitComplete?.()
          lastFitStep.current = context.currentStep
          observedStep.current = context.currentStep
          context.onViewControlStart?.()
        }
      }
      if (!dx && !dy) return
      const target = controlsInstance.getTarget(new Vector3())
      // camera.position includes CameraControls' screen-space focal offset.
      // Feeding that rendered position back into setLookAt would bake the
      // offset into the orbit and then apply it again on every pointer event.
      const offset = controlsInstance.getPosition(new Vector3()).sub(target)
      const up = camera.up.clone().normalize()
      const radiansPerPixel = Math.PI * 2 / Math.max(320, Math.min(element.clientWidth, element.clientHeight))
      const yaw = -dx * radiansPerPixel
      const pitch = -dy * radiansPerPixel
      const now = performance.now()
      const elapsed = Math.max(1 / 240, (now - pointer.lastMoveTime) / 1000)
      pointer.lastMoveTime = now
      const maxVelocity = 10
      const measuredYawVelocity = Math.max(-maxVelocity, Math.min(maxVelocity, yaw / elapsed))
      const measuredPitchVelocity = Math.max(-maxVelocity, Math.min(maxVelocity, pitch / elapsed))
      pointer.velocityX = pointer.velocityX * 0.55 + measuredYawVelocity * 0.45
      pointer.velocityY = pointer.velocityY * 0.55 + measuredPitchVelocity * 0.45
      offset.applyAxisAngle(up, yaw)
      const viewDirection = offset.clone().multiplyScalar(-1).normalize()
      const right = viewDirection.cross(up).normalize()
      offset.applyAxisAngle(right, pitch)
      up.applyAxisAngle(right, pitch).normalize()
      const position = target.clone().add(offset)
      camera.up.copy(up)
      controlsInstance.updateCameraUp()
      controlsInstance.setLookAt(
        position.x,
        position.y,
        position.z,
        target.x,
        target.y,
        target.z,
        false,
      )
      appliedFocus.current.copy(target)
      invalidate()
    }
    const endOrbit = (event: PointerEvent) => {
      const pointer = orbitPointer.current
      if (!pointer || pointer.id !== event.pointerId) return
      orbitPointer.current = undefined
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
      if (!pointer.dragging) {
        if (pointer.continuedInertia) {
          userControlling.current = false
          orbitContext.current.onViewControlEnd?.()
        }
        return
      }
      const releaseDelay = Math.max(0, (performance.now() - pointer.lastMoveTime) / 1000)
      const releaseDamping = Math.exp(-12 * releaseDelay)
      const yawVelocity = pointer.velocityX * releaseDamping
      const pitchVelocity = pointer.velocityY * releaseDamping
      if (Math.hypot(yawVelocity, pitchVelocity) > 0.12) {
        orbitInertia.current = { yaw: yawVelocity, pitch: pitchVelocity }
        invalidate()
      } else {
        userControlling.current = false
        orbitContext.current.onViewControlEnd?.()
      }
    }
    element.addEventListener('pointerdown', beginOrbit)
    element.addEventListener('pointermove', moveOrbit)
    element.addEventListener('pointerup', endOrbit)
    element.addEventListener('pointercancel', endOrbit)
    return () => {
      element.removeEventListener('pointerdown', beginOrbit)
      element.removeEventListener('pointermove', moveOrbit)
      element.removeEventListener('pointerup', endOrbit)
      element.removeEventListener('pointercancel', endOrbit)
    }
  }, [camera, freeOrbit, gl, invalidate])
  useEffect(() => {
    if (modelBounds.current.isEmpty()) return
    const sphere = modelBounds.current.getBoundingSphere(new Sphere())
    const perspectiveCamera = camera as PerspectiveCamera
    const verticalHalfFov = perspectiveCamera.fov * Math.PI / 360
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * perspectiveCamera.aspect)
    const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov)
    const distance = Math.max(2, sphere.radius / Math.sin(limitingHalfFov) * 1.08)
    const target = sphere.center
    const direction = new Vector3(0.16, 0.42, 1).normalize()
    const position = target.clone().addScaledVector(direction, distance)
    controls.current?.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)
    controls.current?.setFocalOffset(0, 0, 0, false)
    // Keep the current selection, but do not let its off-centre focus override
    // the whole-shape orbit point on the next frame.
    appliedFocus.current.copy(focusTarget.current)
    invalidate()
  }, [camera, resetSignal, pieceCount, focusTarget, invalidate, modelBounds])
  useFrame((_, delta) => {
    const controlsInstance = controls.current
    if (!controlsInstance) return
    const inertia = orbitInertia.current
    if (inertia) {
      const frameDelta = Math.min(delta, 1 / 30)
      const target = controlsInstance.getTarget(new Vector3())
      const offset = controlsInstance.getPosition(new Vector3()).sub(target)
      const up = camera.up.clone().normalize()
      offset.applyAxisAngle(up, inertia.yaw * frameDelta)
      const viewDirection = offset.clone().multiplyScalar(-1).normalize()
      const right = viewDirection.cross(up).normalize()
      offset.applyAxisAngle(right, inertia.pitch * frameDelta)
      up.applyAxisAngle(right, inertia.pitch * frameDelta).normalize()
      const position = target.clone().add(offset)
      camera.up.copy(up)
      controlsInstance.updateCameraUp()
      controlsInstance.setLookAt(
        position.x,
        position.y,
        position.z,
        target.x,
        target.y,
        target.z,
        false,
      )
      appliedFocus.current.copy(target)
      const damping = Math.exp(-4.2 * frameDelta)
      inertia.yaw *= damping
      inertia.pitch *= damping
      if (Math.hypot(inertia.yaw, inertia.pitch) < 0.025) {
        orbitInertia.current = undefined
        userControlling.current = false
        orbitContext.current.onViewControlEnd?.()
      } else {
        invalidate()
      }
      return
    }
    if (userControlling.current) return
    if (!viewportFitActive && !viewportLocked && startFitCenter.current) {
      startFitCenter.current = undefined
      startFitDirection.current = undefined
      autoFitDistance.current = undefined
    }
    if (!autoPlaying && !viewportFitActive && !viewportLocked) autoFitDistance.current = undefined
    if (viewportFitActive && startFitSignal.current !== viewportFitSignal) {
      startFitSignal.current = viewportFitSignal
      if (foldedBounds.current.isEmpty()) {
        onViewportFitComplete?.()
      } else {
        // setOrbitPoint preserves the picture by storing a focal offset. That
        // offset must not leak into a deliberate re-centre, otherwise the new
        // target is mathematically correct but remains pushed off-screen.
        controlsInstance.setFocalOffset(0, 0, 0, false)
        const sphere = foldedBounds.current.getBoundingSphere(fitSphere.current)
        const perspectiveCamera = camera as PerspectiveCamera
        const verticalHalfFov = perspectiveCamera.fov * Math.PI / 360
        const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * perspectiveCamera.aspect)
        const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov)
        // Keep enough room to the right of piece 1 for roughly ten straight
        // pieces. Fitting a single piece by itself made the opening shot huge.
        const previewSpan = Math.min(10, pieceCount) * Math.SQRT1_2
        const minimumPlaybackDistance = previewSpan / Math.tan(horizontalHalfFov) * 1.05
        const fittedDistance = Math.max(
          2,
          minimumPlaybackDistance,
          sphere.radius / Math.sin(limitingHalfFov) * viewportFitPadding,
        )
        // Starting a new playback may move in to the first block. Enabling the
        // option during playback follows the continuous rule: never zoom in.
        autoFitDistance.current = autoPlaying
          ? Math.max(controlsInstance.distance, fittedDistance)
          : fittedDistance
        startFitCenter.current = sphere.center.clone()
        startFitDirection.current = new Vector3(0, 0, 1)
          .applyQuaternion(camera.quaternion)
          .normalize()
        // Re-centre deterministically before animating the distance. Trying to
        // interpolate from CameraControls' orbit target allowed a prior pan's
        // internal offset to keep the piece in the same screen corner.
        const centeredPosition = sphere.center.clone()
          .addScaledVector(startFitDirection.current, controlsInstance.distance)
        controlsInstance.setLookAt(
          centeredPosition.x,
          centeredPosition.y,
          centeredPosition.z,
          sphere.center.x,
          sphere.center.y,
          sphere.center.z,
          false,
        )
        appliedFocus.current.copy(sphere.center)
      }
    }
    if (startFitCenter.current && autoFitDistance.current !== undefined) {
      controlsInstance.setFocalOffset(0, 0, 0, false)
      const currentTarget = controlsInstance.getTarget(new Vector3())
      const centerDifference = startFitCenter.current.clone().sub(currentTarget)
      const distanceDifference = autoFitDistance.current - controlsInstance.distance
      const alpha = 1 - Math.exp(-5.5 * Math.min(delta, 1 / 30))
      if (centerDifference.lengthSq() < 0.0001 && Math.abs(distanceDifference) < 0.01) {
        const center = startFitCenter.current
        const direction = startFitDirection.current ?? camera.position.clone().sub(currentTarget).normalize()
        const position = center.clone().addScaledVector(direction, autoFitDistance.current)
        controlsInstance.setLookAt(position.x, position.y, position.z, center.x, center.y, center.z, false)
        appliedFocus.current.copy(center)
        startFitCenter.current = undefined
        startFitDirection.current = undefined
        autoFitDistance.current = undefined
        onViewportFitComplete?.()
      } else {
        const nextTarget = currentTarget.addScaledVector(centerDifference, alpha)
        const nextDistance = controlsInstance.distance + distanceDifference * alpha
        const direction = startFitDirection.current ?? camera.position.clone()
          .sub(controlsInstance.getTarget(new Vector3()))
          .normalize()
        const position = nextTarget.clone().addScaledVector(direction, nextDistance)
        controlsInstance.setLookAt(position.x, position.y, position.z, nextTarget.x, nextTarget.y, nextTarget.z, false)
        invalidate()
      }
      return
    }
    if ((autoPlaying || viewportLocked) && !foldedBounds.current.isEmpty()) {
      const sphere = foldedBounds.current.getBoundingSphere(fitSphere.current)
      const target = playbackCenter.current.copy(sphere.center)
      const currentTarget = controlsInstance.getTarget(new Vector3())
      const centerDifference = target.clone().sub(currentTarget)
      // Small changes in the folded bounds should not make the camera look as
      // though it is constantly correcting itself. Once the shape leaves this
      // proportional dead zone, ease the orbit point back only until it is
      // comfortably inside it.
      const centerDeadZone = Math.max(0.18, sphere.radius * 0.1)
      if (centerDifference.lengthSq() > centerDeadZone * centerDeadZone) {
        // Selection follows the active piece during playback, but using that
        // piece as the orbit point makes an off-centre joint swing the whole
        // shape toward an edge of the screen. Auto framing eases its own target
        // toward the folded shape's centre while retaining the chosen direction
        // and distance.
        const alpha = 1 - Math.exp(-3.2 * Math.min(delta, 1 / 30))
        const direction = camera.position.clone().sub(currentTarget).normalize()
        const nextTarget = currentTarget.addScaledVector(centerDifference, alpha)
        const position = nextTarget.clone().addScaledVector(direction, controlsInstance.distance)
        controlsInstance.setFocalOffset(0, 0, 0, false)
        controlsInstance.setLookAt(
          position.x,
          position.y,
          position.z,
          nextTarget.x,
          nextTarget.y,
          nextTarget.z,
          false,
        )
        appliedFocus.current.copy(nextTarget)
        invalidate()
      } else {
        appliedFocus.current.copy(currentTarget)
      }
    } else if (appliedFocus.current.distanceToSquared(focusTarget.current) >= 0.000001) {
      const target = focusTarget.current
      // CameraControls keeps the current camera transform and uses a focal offset,
      // so an off-centre block can become the real orbit pivot without jumping to
      // the middle of the screen. User trucking/panning remains untouched.
      controlsInstance.setOrbitPoint(target.x, target.y, target.z)
      appliedFocus.current.copy(target)
    }
    if (autoPlaying && autoFitDistance.current !== undefined) {
      const currentDistance = controlsInstance.distance
      const difference = autoFitDistance.current - currentDistance
      if (Math.abs(difference) < 0.01) {
        controlsInstance.dollyTo(autoFitDistance.current, false)
        autoFitDistance.current = undefined
        startFitCenter.current = undefined
      } else {
        // Drive the transition ourselves: the canvas renders on demand, so a
        // one-shot CameraControls transition is not guaranteed to receive all
        // the frames it needs.
        const alpha = 1 - Math.exp(-5.5 * Math.min(delta, 1 / 30))
        controlsInstance.dollyTo(currentDistance + difference * alpha, false)
        invalidate()
      }
    }
    if (!autoPlaying || currentStep <= 0 || foldedBounds.current.isEmpty()) return
    if (observedStep.current === currentStep) return
    observedStep.current = currentStep
    const sphere = foldedBounds.current.getBoundingSphere(fitSphere.current)
    const perspectiveCamera = camera as PerspectiveCamera
    const verticalHalfFov = perspectiveCamera.fov * Math.PI / 360
    const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * perspectiveCamera.aspect)
    const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov)
    const offCenterAllowance = sphere.center.distanceTo(focusTarget.current)
    // The active joint is commonly near the end of the folded prefix. Adding
    // its full distance from the bounds centre effectively counted the shape
    // twice and made it look tiny. A capped 20% allowance keeps off-centre
    // compositions safe without sacrificing useful screen area.
    const effectiveRadius = sphere.radius + Math.min(offCenterAllowance, sphere.radius) * 0.2
    const previewSpan = Math.min(10, pieceCount) * Math.SQRT1_2
    const minimumPlaybackDistance = previewSpan / Math.tan(horizontalHalfFov) * 1.05
    const desiredDistance = Math.max(
      2,
      minimumPlaybackDistance,
      (effectiveRadius / Math.sin(limitingHalfFov)) * 1.03,
    )
    const currentDistance = controlsInstance.distance
    const overflowing = desiredDistance > currentDistance * 1.03
    const cadenceReached = currentStep - lastFitStep.current >= 3
    const needsMoreRoom = Math.log(desiredDistance / currentDistance) > 0.16
    if (overflowing || (cadenceReached && needsMoreRoom)) {
      autoFitDistance.current = desiredDistance
      lastFitStep.current = currentStep
      invalidate()
    }
  })
  return (
    <CameraControls
      ref={controls}
      makeDefault
      minDistance={2}
      maxDistance={200}
      smoothTime={0.18}
      onControlStart={() => {
        orbitInertia.current = undefined
        userControlling.current = true
        controls.current?.stop()
        // A model/preset change can leave an in-progress fit queued while the
        // user starts orbiting. If it survives the drag, the next frame after
        // pointer-up reapplies the fit's captured direction and snaps the view
        // back. Manual control takes ownership of the camera immediately.
        const interruptedViewportFit = viewportFitActive
        // Also consume a fit signal that React has delivered before the first
        // frame had a chance to initialize it.
        startFitSignal.current = viewportFitSignal
        startFitCenter.current = undefined
        startFitDirection.current = undefined
        autoFitDistance.current = undefined
        if (interruptedViewportFit) onViewportFitComplete?.()
        lastFitStep.current = currentStep
        observedStep.current = currentStep
        onViewControlStart?.()
      }}
      onControlEnd={() => { userControlling.current = false; onViewControlEnd?.() }}
    />
  )
}

export function SnakeScene(props: SnakeSceneProps) {
  const shadowExtent = Math.max(14, props.pieceCount * 0.56)
  const focusTarget = useRef(new Vector3())
  const modelBounds = useRef(new Box3())
  const foldedBounds = useRef(new Box3())
  const leftPointerStart = useRef<{ x: number; y: number } | undefined>(undefined)
  const foldedPieceCount = props.currentStep > 0
    ? Math.max(...props.steps.slice(0, props.currentStep).map((step) => step.joint)) + 1
    : 1
  return (
    <Canvas
      shadows="soft"
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [5, 6, 9], fov: 38 }}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}
      onPointerDownCapture={(event) => {
        if (event.button === 0) leftPointerStart.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerMissed={(event) => {
        const start = leftPointerStart.current
        const distance = start ? Math.hypot(event.clientX - start.x, event.clientY - start.y) : Number.POSITIVE_INFINITY
        if (event.button === 0 && distance <= 3) props.onSelectPiece?.(undefined)
      }}
    >
      <color attach="background" args={['#edf2ef']} />
      <hemisphereLight args={['#ffffff', '#c7d4cd', 1.18]} />
      <directionalLight
        position={[9, 14, 11]}
        intensity={1.75}
        color="#fffaf1"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-camera-near={1}
        shadow-camera-far={80}
        shadow-bias={-0.00025}
        shadow-normalBias={0.025}
      />
      <directionalLight position={[-8, 7, -10]} intensity={0.95} color="#e4edff" />
      <directionalLight position={[2, -4, 8]} intensity={0.42} color="#ffffff" />
      <Environment resolution={128} environmentIntensity={0.42}>
        <Lightformer form="rect" intensity={3.5} color="#fff8ed" position={[0, 8, 9]} scale={[8, 4, 1]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={3} color="#e5efff" position={[-7, 3, -4]} scale={[5, 5, 1]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={1.5} color="#ffffff" position={[8, -1, -2]} scale={[3, 3, 1]} target={[0, 0, 0]} />
      </Environment>
      <SnakeModel
        {...props}
        focusTarget={focusTarget}
        modelBounds={modelBounds}
        foldedBounds={foldedBounds}
        foldedPieceCount={foldedPieceCount}
      />
      <ContactShadows
        position={[0, -0.14, 0]}
        opacity={0.3}
        scale={shadowExtent * 2.8}
        blur={2.1}
        far={3.5}
        resolution={256}
        color="#52605a"
      />
      <CameraRig
        resetSignal={props.resetSignal}
        pieceCount={props.pieceCount}
        focusTarget={focusTarget}
        modelBounds={modelBounds}
        foldedBounds={foldedBounds}
        currentStep={props.currentStep}
        autoPlaying={props.autoPlaying ?? false}
        viewportFitSignal={props.viewportFitSignal ?? 0}
        viewportFitActive={props.viewportFitActive ?? false}
        viewportFitPadding={props.viewportFitPadding ?? 1.08}
        viewportLocked={props.viewportLocked ?? false}
        freeOrbit={props.freeOrbit ?? true}
        onViewportFitComplete={props.onViewportFitComplete}
        onBlockedZoom={props.onBlockedZoom}
        onViewControlStart={props.onViewControlStart}
        onViewControlEnd={props.onViewControlEnd}
      />
    </Canvas>
  )
}
