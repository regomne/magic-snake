import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import {
  ACESFilmicToneMapping,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Matrix4,
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

function SnakeModel({ pieceCount, steps, currentStep, animationDuration }: Omit<SnakeSceneProps, 'resetSignal'>) {
  const groups = useRef<Array<Group | null>>([])
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
    // targets represents the zero/current pose at mount; pieceCount remounts the set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceCount, initialTransforms])

  // In demand-driven mode a React state change schedules the first frame, then
  // the animation explicitly asks for more frames only until every joint settles.
  useEffect(() => invalidate(), [targetTurns, invalidate])

  useFrame((_, delta) => {
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
    if (isAnimating) invalidate()
  })

  return (
    <group rotation={[-0.18, 0.18, 0]}>
      {initialTransforms.map((_, index) => {
        const color = index % 2 === 0 ? '#1d5da7' : '#f1efe8'
        const joint = jointFrames[index]
        return (
          <group
            key={index}
            ref={(node) => { groups.current[index] = node }}
          >
            <mesh geometry={geometries[index % 2]} castShadow receiveShadow>
              <meshPhysicalMaterial
                color={color}
                roughness={0.58}
                metalness={0}
                envMapIntensity={0.48}
                clearcoat={0.04}
                clearcoatRoughness={0.72}
                ior={1.46}
              />
            </mesh>
            {joint && (
              <mesh
                geometry={seamGeometry}
                position={[(3 * Math.SQRT2 * PIECE_SIZE) / 4, (Math.SQRT2 * PIECE_SIZE) / 4, 0]}
                quaternion={joint.quaternion}
                renderOrder={-1}
                receiveShadow
              >
                <meshStandardMaterial color="#263039" roughness={0.72} metalness={0} side={DoubleSide} />
              </mesh>
            )}
          </group>
        )
      })}
    </group>
  )
}

function CameraRig({ resetSignal, pieceCount }: { resetSignal: number; pieceCount: number }) {
  const controls = useRef<any>(null)
  const { camera } = useThree()
  useEffect(() => {
    const straightSpan = pieceCount * Math.SQRT2 / 2
    const distance = Math.max(14, straightSpan * 1.6)
    camera.position.set(distance * 0.16, distance * 0.42, distance)
    camera.lookAt(0, 0, 0)
    camera.updateProjectionMatrix()
    if (controls.current) {
      controls.current.target.set(0, 0, 0)
      controls.current.update()
    }
  }, [camera, resetSignal, pieceCount])
  return <OrbitControls ref={controls} makeDefault enableDamping minDistance={2} maxDistance={200} />
}

export function SnakeScene(props: SnakeSceneProps) {
  const shadowExtent = Math.max(14, props.pieceCount * 0.56)
  return (
    <Canvas
      shadows="soft"
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ position: [5, 6, 9], fov: 38 }}
      gl={{ antialias: true, toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace }}
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
      <SnakeModel {...props} />
      <ContactShadows
        position={[0, -0.14, 0]}
        opacity={0.3}
        scale={shadowExtent * 2.8}
        blur={2.1}
        far={3.5}
        resolution={256}
        color="#52605a"
      />
      <CameraRig resetSignal={props.resetSignal} pieceCount={props.pieceCount} />
    </Canvas>
  )
}
