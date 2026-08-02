import { CameraControls, CameraControlsImpl, ContactShadows, Environment, Lightformer } from '@react-three/drei'
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
  MeshPhysicalMaterial,
  PlaneGeometry,
  Quaternion,
  Shape,
  SRGBColorSpace,
  Vector3,
} from 'three'
import type { FormulaStep } from '../domain/formula'
import { calculateTransforms, PIECE_SIZE, turnsAtStep } from '../domain/snake'

interface SnakeSceneProps {
  pieceCount: number
  steps: FormulaStep[]
  currentStep: number
  animationDuration: number
  resetSignal: number
  selectedPiece?: number
  collisionPieces?: number[]
  onSelectPiece?: (piece?: number) => void
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
  selectedPiece,
  collisionPieces = [],
  onSelectPiece,
  focusTarget,
}: Omit<SnakeSceneProps, 'resetSignal'> & { focusTarget: MutableRefObject<Vector3> }) {
  const groups = useRef<Array<Group | null>>([])
  const materials = useRef<Array<MeshPhysicalMaterial | null>>([])
  const blinkTimer = useRef<number | undefined>(undefined)
  const invalidate = useThree((state) => state.invalidate)
  const geometries = useMemo(() => [createPrismGeometry(false), createPrismGeometry(true)], [])
  const seamGeometry = useMemo(() => new PlaneGeometry(PIECE_SIZE * 0.965, PIECE_SIZE * 0.965), [])
  const jointFrames = useMemo(() => Array.from({ length: pieceCount - 1 }, (_, index) => jointFrame(index)), [pieceCount])
  const targetTurns = useMemo(() => turnsAtStep(steps, currentStep, pieceCount), [steps, currentStep, pieceCount])
  const animatedTurns = useRef([...targetTurns])
  const initialTransforms = useMemo(
    () => calculateTransforms(pieceCount, targetTurns),
    // A length change remounts/reinitializes the chain; step changes animate below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pieceCount],
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
            bounds.expandByPoint(new Vector3(x, y, z)
              .applyQuaternion(transform.quaternion)
              .add(transform.position)
              .applyQuaternion(rootRotation))
          }
        }
      }
    })
    if (selectedPiece === undefined && !bounds.isEmpty()) bounds.getCenter(focusTarget.current)
  }

  useEffect(() => () => {
    geometries.forEach((geometry) => geometry.dispose())
    seamGeometry.dispose()
    if (blinkTimer.current !== undefined) window.clearTimeout(blinkTimer.current)
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

  // In demand-driven mode a React state change schedules the first frame, then
  // the animation explicitly asks for more frames only until every joint settles.
  useEffect(() => invalidate(), [targetTurns, selectedPiece, invalidate])

  useFrame(({ clock }, rawDelta) => {
    // With frameloop="demand", the first frame after a long idle can report the
    // whole idle interval as delta. Cap it so a new joint turn cannot snap to
    // its target in that single frame.
    const delta = Math.min(rawDelta, 1 / 30)
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
    const frameTransforms = calculateTransforms(pieceCount, currentTurns)
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
        material.emissive.set('#d66a24')
        material.emissiveIntensity = 0.1 + (Math.sin(clock.elapsedTime * 2.4) + 1) * 0.1
      } else {
        material.emissive.set('#000000')
        material.emissiveIntensity = 0
      }
    })
    if (isAnimating) invalidate()
    else if (selectedPiece !== undefined && blinkTimer.current === undefined) {
      // A slow highlight does not need a 60 fps render loop. Updating at 20 fps
      // keeps the pulse smooth while preserving the low idle cost of the scene.
      blinkTimer.current = window.setTimeout(() => {
        blinkTimer.current = undefined
        invalidate()
      }, 50)
    }
  })

  return (
    <group rotation={[-0.18, 0.18, 0]}>
      {initialTransforms.map((_, index) => {
        const color = index % 2 === 0 ? '#1d5da7' : '#f1efe8'
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
              onClick={(event) => { event.stopPropagation(); onSelectPiece?.(pieceNumber) }}
              onPointerOver={(event) => { event.stopPropagation(); document.body.style.cursor = onSelectPiece ? 'pointer' : '' }}
              onPointerOut={() => { document.body.style.cursor = '' }}
            >
              <meshPhysicalMaterial
                ref={(material) => { materials.current[index] = material }}
                color={color}
                roughness={0.58}
                metalness={0}
                envMapIntensity={0.48}
                clearcoat={0.04}
                clearcoatRoughness={0.72}
                ior={1.46}
                emissive={colliding ? '#a8160b' : '#000000'}
                emissiveIntensity={colliding ? 0.65 : 0}
              />
            </mesh>
            {joint && (
              <mesh
                geometry={seamGeometry}
                position={[(3 * Math.SQRT2 * PIECE_SIZE) / 4, (Math.SQRT2 * PIECE_SIZE) / 4, 0]}
                quaternion={joint.quaternion}
                renderOrder={-1}
                receiveShadow
                onClick={(event) => { event.stopPropagation(); onSelectPiece?.(pieceNumber) }}
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

function CameraRig({ resetSignal, pieceCount, focusTarget }: { resetSignal: number; pieceCount: number; focusTarget: MutableRefObject<Vector3> }) {
  const controls = useRef<any>(null)
  const appliedFocus = useRef(new Vector3(Number.NaN, Number.NaN, Number.NaN))
  const { camera } = useThree()
  useEffect(() => {
    if (controls.current) controls.current.mouseButtons.right = CameraControlsImpl.ACTION.OFFSET
  }, [])
  useEffect(() => {
    const straightSpan = pieceCount * Math.SQRT2 / 2
    const distance = Math.max(14, straightSpan * 1.6)
    const target = focusTarget.current
    const position = new Vector3(target.x + distance * 0.16, target.y + distance * 0.42, target.z + distance)
    controls.current?.setLookAt(position.x, position.y, position.z, target.x, target.y, target.z, false)
    controls.current?.setFocalOffset(0, 0, 0, false)
    appliedFocus.current.copy(target)
  }, [camera, resetSignal, pieceCount, focusTarget])
  useFrame(() => {
    const controlsInstance = controls.current
    if (!controlsInstance || appliedFocus.current.distanceToSquared(focusTarget.current) < 0.000001) return
    const target = focusTarget.current
    // CameraControls keeps the current camera transform and uses a focal offset,
    // so an off-centre block can become the real orbit pivot without jumping to
    // the middle of the screen. User trucking/panning remains untouched.
    controlsInstance.setOrbitPoint(target.x, target.y, target.z)
    appliedFocus.current.copy(target)
  })
  return <CameraControls ref={controls} makeDefault minDistance={2} maxDistance={200} smoothTime={0.18} />
}

export function SnakeScene(props: SnakeSceneProps) {
  const shadowExtent = Math.max(14, props.pieceCount * 0.56)
  const focusTarget = useRef(new Vector3())
  return (
    <Canvas
      shadows="soft"
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [5, 6, 9], fov: 38 }}
      gl={{ antialias: true, preserveDrawingBuffer: true, toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}
      onPointerMissed={() => props.onSelectPiece?.(undefined)}
    >
      <color attach="background" args={['#e9eeeb']} />
      <hemisphereLight args={['#f8fbff', '#aab3ad', 0.72]} />
      <directionalLight
        position={[9, 14, 11]}
        intensity={2.15}
        color="#fff8ec"
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
      <directionalLight position={[-8, 7, -10]} intensity={0.48} color="#cbdcff" />
      <Environment resolution={128} environmentIntensity={0.62}>
        <Lightformer form="rect" intensity={4.2} color="#fff8ed" position={[0, 8, 9]} scale={[8, 4, 1]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={2.2} color="#d9e8ff" position={[-7, 3, -4]} scale={[5, 5, 1]} target={[0, 1, 0]} />
        <Lightformer form="rect" intensity={1.5} color="#ffffff" position={[8, -1, -2]} scale={[3, 3, 1]} target={[0, 0, 0]} />
      </Environment>
      <SnakeModel {...props} focusTarget={focusTarget} />
      <ContactShadows
        position={[0, -0.14, 0]}
        opacity={0.3}
        scale={shadowExtent * 2.8}
        blur={2.1}
        far={3.5}
        resolution={256}
        color="#52605a"
      />
      <CameraRig resetSignal={props.resetSignal} pieceCount={props.pieceCount} focusTarget={focusTarget} />
    </Canvas>
  )
}
