import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  RotateCw,
  Share2,
  SkipBack,
  SkipForward,
  Undo2,
} from 'lucide-react'
import { SnakeScene } from './components/SnakeScene'
import { analyzeCollisions, appendTurn } from './domain/collision'
import { formatFormula, parseFormula } from './domain/formula'
import type { FormulaNotation, Turn } from './domain/formula'
import { DEFAULT_FORMULA, SHAPE_PRESETS } from './domain/presets'

const LENGTHS = [24, 36, 48, 72] as const
const STORAGE_KEY = 'magic-snake:workspace:v2'

function loadInitialState() {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  const query = new URLSearchParams(window.location.search)
  const queryLength = Number(hash.get('length') ?? query.get('length'))
  const queryFormula = hash.get('formula') ?? query.get('formula')
  if (LENGTHS.includes(queryLength as typeof LENGTHS[number]) && queryFormula !== null) {
    return { pieceCount: queryLength, formula: queryFormula }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')
    if (LENGTHS.includes(saved.pieceCount) && typeof saved.formula === 'string') return saved
  } catch { /* Use the bundled example when saved data is damaged. */ }
  return { pieceCount: 24, formula: DEFAULT_FORMULA }
}

function writeShapeToHash(pieceCount: number, formula: string) {
  const hash = new URLSearchParams({ length: String(pieceCount), formula })
  history.replaceState(null, '', `${window.location.pathname}#${hash}`)
}

function App() {
  const [initial] = useState(loadInitialState)
  const [language, setLanguage] = useState<'zh' | 'en'>(() => localStorage.getItem('magic-snake:language') === 'en' ? 'en' : 'zh')
  const en = language === 'en'
  const [pieceCount, setPieceCount] = useState<number>(initial.pieceCount)
  const [formula, setFormula] = useState(initial.formula)
  const [formulaNotation, setFormulaNotation] = useState<FormulaNotation>(
    () => parseFormula(initial.formula, initial.pieceCount, language).notation ?? 'joint',
  )
  const [currentStep, setCurrentStep] = useState(() => parseFormula(initial.formula, initial.pieceCount, language).steps.length)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [pauseMs, setPauseMs] = useState(350)
  const [autoViewport, setAutoViewport] = useState(true)
  const [viewportFitSignal, setViewportFitSignal] = useState(0)
  const [axisRotation, setAxisRotation] = useState<'x+' | 'x-' | 'y+' | 'y-' | 'z+' | 'z-' | undefined>()
  const [preparingPlayback, setPreparingPlayback] = useState(false)
  const [fittingPreset, setFittingPreset] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [resetSignal, setResetSignal] = useState(0)
  const [viewInteracting, setViewInteracting] = useState(false)
  const [selectedPiece, setSelectedPiece] = useState<number | undefined>()
  const [undoStack, setUndoStack] = useState<string[]>([])
  const [redoStack, setRedoStack] = useState<string[]>([])
  const [preventCollision, setPreventCollision] = useState(true)
  const [notice, setNotice] = useState('')
  const textStart = useRef(formula)
  const stepRefs = useRef<Array<HTMLButtonElement | null>>([])
  const stepListRef = useRef<HTMLDivElement | null>(null)
  const resumePlaybackAfterView = useRef(false)
  const scheduledPlaybackDueAt = useRef(0)
  const pausedPlaybackDueAt = useRef(0)
  const resumeDelayAfterView = useRef<number | undefined>(undefined)

  const parsed = useMemo(() => parseFormula(formula, pieceCount, language), [formula, pieceCount, language])
  const steps = parsed.steps
  const animationDuration = 0.55 / speed
  const collisionIssues = useMemo(
    () => parsed.errors.length ? [] : analyzeCollisions(steps, pieceCount),
    [steps, pieceCount, parsed.errors.length],
  )
  const currentIssues = collisionIssues.filter((issue) => issue.step === currentStep)
  const finalCollisionIssues = collisionIssues.filter((issue) => issue.step === steps.length)
  const hasIntermediateCollisions = collisionIssues.some((issue) => issue.step < steps.length)
  const collisionPieces = [...new Set(currentIssues.flatMap((issue) => issue.pieces))]
  const selectedJoint = selectedPiece !== undefined && selectedPiece > 1 ? selectedPiece - 1 : undefined

  useEffect(() => {
    setCurrentStep((step) => Math.min(step, steps.length))
    if (parsed.errors.length) setPlaying(false)
  }, [steps.length, parsed.errors.length])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, pieceCount, formula }))
  }, [pieceCount, formula])

  useEffect(() => { localStorage.setItem('magic-snake:language', language) }, [language])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2400)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!playing) return
    if (currentStep >= steps.length) { setPlaying(false); return }
    const delay = resumeDelayAfterView.current ?? animationDuration * 1000 + pauseMs
    resumeDelayAfterView.current = undefined
    scheduledPlaybackDueAt.current = performance.now() + delay
    const timer = window.setTimeout(
      () => setCurrentStep((step) => {
        const next = Math.min(step + 1, steps.length)
        setSelectedPiece(steps[next - 1] ? steps[next - 1].joint + 1 : undefined)
        return next
      }),
      delay,
    )
    return () => window.clearTimeout(timer)
  }, [playing, currentStep, steps, animationDuration, pauseMs])

  useEffect(() => {
    if (currentStep <= 0) return
    const list = stepListRef.current
    const item = stepRefs.current[currentStep - 1]
    if (!list || !item) return
    const listRect = list.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    if (itemRect.top < listRect.top) {
      list.scrollTo({ top: list.scrollTop + itemRect.top - listRect.top - 8, behavior: 'smooth' })
    } else if (itemRect.bottom > listRect.bottom) {
      list.scrollTo({ top: list.scrollTop + itemRect.bottom - listRect.bottom + 8, behavior: 'smooth' })
    }
  }, [currentStep])

  function goToStep(step: number) {
    const next = Math.max(0, Math.min(step, steps.length))
    setCurrentStep(next)
    setSelectedPiece(next > 0 ? steps[next - 1].joint + 1 : undefined)
    setPlaying(false)
  }

  function startViewControl() {
    resumePlaybackAfterView.current = playing
    pausedPlaybackDueAt.current = scheduledPlaybackDueAt.current || performance.now() + animationDuration * 1000 + pauseMs
    setViewInteracting(true)
    if (playing) setPlaying(false)
  }

  function endViewControl() {
    setViewInteracting(false)
    if (resumePlaybackAfterView.current) {
      // The current joint animation keeps running while the camera is being
      // handled. Only preserve whatever remains of its original pause window.
      resumeDelayAfterView.current = Math.max(0, pausedPlaybackDueAt.current - performance.now())
      setPlaying(true)
    }
    resumePlaybackAfterView.current = false
  }

  function setFinishedFormula(next: string) {
    setFormula(next)
    const nextParsed = parseFormula(next, pieceCount, language)
    if (nextParsed.notation) setFormulaNotation(nextParsed.notation)
    setCurrentStep(nextParsed.steps.length)
    setPlaying(false)
  }

  function commitFormula(next: string) {
    if (next === formula) return
    setUndoStack((stack) => [...stack.slice(-99), formula])
    setRedoStack([])
    setFinishedFormula(next)
  }

  function undo() {
    const previous = undoStack.at(-1)
    if (previous === undefined) return
    setUndoStack((stack) => stack.slice(0, -1))
    setRedoStack((stack) => [...stack, formula])
    setFinishedFormula(previous)
  }

  function redo() {
    const next = redoStack.at(-1)
    if (next === undefined) return
    setRedoStack((stack) => stack.slice(0, -1))
    setUndoStack((stack) => [...stack, formula])
    setFinishedFormula(next)
  }

  function rotateSelected(turn: Turn) {
    if (parsed.errors.length) { setNotice(en ? 'Fix the formula errors first' : '请先修正公式错误'); return }
    if (selectedJoint === undefined) { setNotice(en ? 'Select piece 2 or later first' : '请先选择第 2 块或之后的方块'); return }
    const nextSteps = appendTurn(steps, selectedJoint, turn)
    if (preventCollision) {
      const issue = analyzeCollisions(nextSteps, pieceCount).find((item) => item.step === nextSteps.length)
      if (issue) {
        setNotice(en ? `Blocked: pieces ${issue.pieces[0]} and ${issue.pieces[1]} overlap` : `已阻止：第 ${issue.pieces[0]}、${issue.pieces[1]} 块最终位置重叠`)
        return
      }
    }
    commitFormula(formatFormula(nextSteps, formulaNotation, pieceCount))
  }

  function togglePlaying() {
    if (!steps.length || parsed.errors.length) return
    if (preparingPlayback) {
      setPreparingPlayback(false)
      return
    }
    if (playing) { setPlaying(false); return }
    if (!playing && currentStep === steps.length) {
      setCurrentStep(0)
      setSelectedPiece(undefined)
    }
    if (autoViewport) {
      setPreparingPlayback(true)
      setViewportFitSignal((value) => value + 1)
    } else {
      setPlaying(true)
    }
  }

  function changeAutoViewport(enabled: boolean) {
    setAutoViewport(enabled)
    if (enabled && playing) setViewportFitSignal((value) => value + 1)
  }

  function startAxisRotation(axis: Exclude<typeof axisRotation, undefined>) {
    setPlaying(false)
    setPreparingPlayback(false)
    setAxisRotation(axis)
  }

  function changeFormulaNotation(notation: FormulaNotation) {
    setFormulaNotation(notation)
    if (!parsed.errors.length) setFormula(formatFormula(parsed.steps, notation, pieceCount))
  }

  function applyPreset(id: string) {
    const preset = SHAPE_PRESETS.find((item) => item.id === id)
    if (!preset) return
    const nextParsed = parseFormula(preset.formula, preset.pieceCount, language)
    setUndoStack((stack) => [...stack.slice(-99), formula])
    setRedoStack([])
    setPieceCount(preset.pieceCount)
    setFormula(preset.formula)
    if (nextParsed.notation) setFormulaNotation(nextParsed.notation)
    setCurrentStep(nextParsed.steps.length)
    setSelectedPiece(undefined)
    setPlaying(false)
    setPreparingPlayback(false)
    setFittingPreset(true)
    setViewportFitSignal((value) => value + 1)
    writeShapeToHash(preset.pieceCount, preset.formula)
  }

  async function share() {
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = new URLSearchParams({ length: String(pieceCount), formula }).toString()
    history.replaceState(null, '', url)
    try { await navigator.clipboard.writeText(url.toString()); setNotice(en ? 'Share link copied' : '分享链接已复制') }
    catch { setNotice(en ? 'Link written to the address bar' : '链接已写入地址栏') }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement
      if (editing) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return }
      if (event.key === '1') rotateSelected(1)
      if (event.key === '-') rotateSelected(-1)
      if (event.key === '2') rotateSelected(2)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const active = currentStep > 0 ? steps[currentStep - 1] : undefined

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark" aria-hidden="true"><span /><span /><span /></div><div><h1>{en ? 'MAGIC SNAKE' : '魔尺'}</h1><p>{en ? 'SHAPE WORKBENCH' : '造型工作台'}</p></div></div>
        <div className="top-actions">
          <button className="icon-button" aria-label={en ? 'Undo' : '撤销'} title={en ? 'Undo Ctrl/⌘ Z' : '撤销 Ctrl/⌘ Z'} disabled={!undoStack.length} onClick={undo}><Undo2 size={18} /></button>
          <button className="icon-button" aria-label={en ? 'Redo' : '重做'} title={en ? 'Redo Ctrl/⌘ Shift Z' : '重做 Ctrl/⌘ Shift Z'} disabled={!redoStack.length} onClick={redo}><Redo2 size={18} /></button>
          <button className="ghost-button" onClick={share}><Share2 size={17} /> {en ? 'Share' : '分享'}</button>
          <button className="ghost-button" onClick={() => setResetSignal((value) => value + 1)}><RotateCcw size={17} /> {en ? 'Reset view' : '重置视角'}</button>
          <select className="language-select" aria-label="Language" value={language} onChange={(event) => setLanguage(event.target.value as 'zh' | 'en')}><option value="zh">中文</option><option value="en">English</option></select>
          <button className="icon-button" aria-label={en ? 'Help' : '使用说明'} onClick={() => setShowHelp(true)}><CircleHelp size={20} /></button>
        </div>
      </header>

      <section className="workspace">
        <aside className="editor-panel">
          <div className="preset-row">
            <label htmlFor="preset">{en ? 'Preset shape' : '预置形状'}</label>
            <select id="preset" defaultValue="" onChange={(event) => { applyPreset(event.target.value); event.target.value = '' }}>
              <option value="" disabled>{en ? 'Choose a shape…' : '选择预置造型…'}</option>
              {SHAPE_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{en ? preset.nameEn : preset.name}</option>)}
            </select>
          </div>

          <div className="length-row">
            <label htmlFor="piece-count">{en ? 'Snake length' : '魔尺段数'}</label>
            <select id="piece-count" value={pieceCount} onChange={(event) => { const length = Number(event.target.value); setPieceCount(length); setCurrentStep(parseFormula(formula, length, language).steps.length); setPlaying(false); setSelectedPiece(undefined) }}>
              {LENGTHS.map((length) => <option key={length} value={length}>{length} {en ? 'pieces' : '段'}</option>)}
            </select>
          </div>

          <div className="formula-heading">
            <label className="formula-label" htmlFor="formula">{en ? 'Formula' : '公式'}</label>
            <select aria-label="公式格式" value={formulaNotation} onChange={(event) => changeFormulaNotation(event.target.value as FormulaNotation)}>
              <option value="digits">{en ? '0123 pose encoding' : '0123 姿态编码'}</option>
              <option value="speed">{en ? 'Speed notation' : '标准速拧格式'}</option>
              <option value="joint">{en ? 'Parenthesized notation' : '括号格式'}</option>
            </select>
          </div>
          <textarea
            id="formula"
            className={parsed.errors.length ? 'formula-error' : undefined}
            value={formula}
            spellCheck={false}
            onFocus={() => { textStart.current = formula }}
            onBlur={() => { if (textStart.current !== formula) { setUndoStack((stack) => [...stack, textStart.current]); setRedoStack([]) } }}
            onChange={(event) => { const next = event.target.value; const result = parseFormula(next, pieceCount, language); setFormula(next); if (result.notation && !result.errors.length) setFormulaNotation(result.notation); setCurrentStep(result.steps.length); setPlaying(false) }}
            placeholder={formulaNotation === 'joint' ? (en ? 'e.g. 2(1), 4(-1), 6(2)' : '例如：2(1), 4(-1), 6(2)') : formulaNotation === 'speed' ? (en ? 'e.g. 2+ 4- 6x' : '例如：2+ 4- 6x') : (en ? `${pieceCount}-digit 0123 pose encoding` : `${pieceCount} 位 0123 姿态编码`)}
          />
          <div className="legend">
            {formulaNotation === 'speed' ? <>
              <span><i className="cw" />+ {en ? 'clockwise' : '顺时针'}</span><span><i className="ccw" />− {en ? 'counter-clockwise' : '逆时针'}</span><span><i className="half" />x {en ? '180°' : '旋转 180°'}</span>
            </> : formulaNotation === 'joint' ? <>
              <span><i className="cw" />1 {en ? 'clockwise' : '顺时针'}</span><span><i className="ccw" />−1 {en ? 'counter-clockwise' : '逆时针'}</span><span><i className="half" />2 {en ? '180°' : '旋转 180°'}</span>
            </> : <>
              <span><i />0 {en ? 'none' : '不动'}</span><span><i className="cw" />1 {en ? 'clockwise' : '顺时针'}</span><span><i className="half" />2 {en ? '180°' : '旋转 180°'}</span><span><i className="ccw" />3 {en ? 'counter-clockwise' : '逆时针'}</span>
            </>}
          </div>
          {parsed.errors.length > 0 && <div className="error-box">{parsed.errors.map((error) => <p key={error}>{error}</p>)}</div>}
          {finalCollisionIssues.length > 0 && <div className="collision-box"><b>{en ? `Final-pose check: ${finalCollisionIssues.length} overlap(s)` : `最终姿态检查：发现 ${finalCollisionIssues.length} 项重叠`}</b><p>{finalCollisionIssues.slice(0, 3).map((issue) => en ? `Pieces ${issue.pieces.join(' / ')} overlap` : `方块 ${issue.pieces.join(' / ')} 占据重叠空间`).join(en ? '; ' : '；')}</p></div>}
          {!finalCollisionIssues.length && hasIntermediateCollisions && <div className="collision-box intermediate"><b>{en ? 'Some intermediate steps contain overlapping pieces. Reorder the steps as needed; the final shape has no overlaps.' : '中间步骤中存在重叠方块，请自行调整前后顺序，最终造型不存在重叠。'}</b></div>}

          <h3 className="manual-heading">{en ? 'Manual edit' : '手动编辑'}</h3>
          <section className="joint-editor" aria-label={en ? 'Manual edit' : '手动编辑'}>
            <div className="joint-editor-title"><span>{en ? 'Piece number' : '方块编号'}</span><b>{selectedPiece ?? '—'}</b></div>
            <input aria-label="选择方块" type="range" min={2} max={pieceCount} value={selectedPiece ?? 2} onChange={(event) => setSelectedPiece(Number(event.target.value))} />
            <div className="joint-actions">
              <button disabled={selectedJoint === undefined} onClick={() => rotateSelected(-1)} title={en ? 'Shortcut -' : '快捷键 -'}><RotateCcw size={17} />{en ? 'CCW' : '逆时针'}</button>
              <button disabled={selectedJoint === undefined} onClick={() => rotateSelected(2)} title="快捷键 2">180°</button>
              <button disabled={selectedJoint === undefined} onClick={() => rotateSelected(1)} title={en ? 'Shortcut 1' : '快捷键 1'}><RotateCw size={17} />{en ? 'CW' : '顺时针'}</button>
            </div>
            <div className="edit-options">
              <label><input type="checkbox" checked={preventCollision} onChange={(event) => setPreventCollision(event.target.checked)} /> {en ? 'Prevent overlap' : '阻止最终位置重叠'}</label>
              <button onClick={() => commitFormula('')}>{en ? 'Straighten' : '一键拉直'}</button>
            </div>
          </section>
        </aside>

        <section className="viewer-panel">
          <div className="viewer-badge">{pieceCount} {en ? 'pieces' : '段'}{selectedPiece ? ` · ${en ? 'Piece' : '方块'} ${selectedPiece}${selectedJoint ? ` / ${en ? 'Joint' : '关节'} ${selectedJoint}` : ''}` : ''}</div>
          <SnakeScene
            pieceCount={pieceCount}
            steps={steps}
            currentStep={currentStep}
            animationDuration={animationDuration}
            animationPaused={false}
            autoPlaying={autoViewport && playing}
            viewportFitSignal={viewportFitSignal}
            viewportFitActive={fittingPreset || preparingPlayback || (autoViewport && playing)}
            viewportFitPadding={fittingPreset ? 0.94 : 1.08}
            axisRotation={axisRotation}
            viewportLocked={autoViewport && (playing || preparingPlayback || (viewInteracting && resumePlaybackAfterView.current))}
            onViewportFitComplete={() => {
              if (fittingPreset) setFittingPreset(false)
              if (!preparingPlayback) return
              setPreparingPlayback(false)
              setPlaying(true)
            }}
            onBlockedZoom={() => setNotice(en ? 'Zoom and right-button pan are disabled during auto framing' : '播放中无法缩放大小或右键平移，请取消“自动调整视口”后再试')}
            resetSignal={resetSignal}
            selectedPiece={selectedPiece}
            collisionPieces={collisionPieces}
            onSelectPiece={(piece) => { setSelectedPiece(piece); setPlaying(false) }}
            onViewControlStart={startViewControl}
            onViewControlEnd={endViewControl}
          />
          <div className="axis-controls" aria-label={en ? 'Axis views' : '六轴视角'}>
            {(['x', 'y', 'z'] as const).map((axis) => (
              <div className="axis-control-group" key={axis}>
                <span>{axis.toUpperCase()}</span>
                <button type="button" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startAxisRotation(`${axis}+`) }} onPointerUp={() => setAxisRotation(undefined)} onPointerCancel={() => setAxisRotation(undefined)} title={`${axis.toUpperCase()}+`}>+</button>
                <button type="button" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); startAxisRotation(`${axis}-`) }} onPointerUp={() => setAxisRotation(undefined)} onPointerCancel={() => setAxisRotation(undefined)} title={`${axis.toUpperCase()}-`}>−</button>
              </div>
            ))}
          </div>
          <div className="viewer-hint">{en ? 'Click to select · Drag to orbit · Wheel to zoom' : '点击选择方块 · 拖动旋转视角 · 滚轮缩放'}</div>
        </section>

        <aside className="teaching-panel">
          <div className="teaching-heading"><div><span className="eyebrow">STEPS</span><h2>{en ? 'Steps' : '步骤'}</h2></div><b>{steps.length} {en ? 'steps' : '步'}</b></div>
          <button className={currentStep === 0 ? 'initial-step active' : 'initial-step'} onClick={() => goToStep(0)}>{en ? 'Initial straight state' : '初始直尺状态'}</button>
          <div className="step-list" ref={stepListRef}>{steps.map((step, index) => (
            <button
              ref={(node) => { stepRefs.current[index] = node }}
              key={`${step.source}-${index}`}
              className={`${currentStep === index + 1 ? 'step active' : currentStep > index + 1 ? 'step done' : 'step'} ${collisionIssues.some((issue) => issue.step === index + 1) ? 'collision' : ''}`}
              onClick={() => goToStep(index + 1)}
            >
              <span className="step-number">{index + 1}</span><span><strong>{en ? 'Piece' : '方块'} {step.joint + 1}</strong><small>{step.turn === 1 ? (en ? 'Clockwise 90°' : '顺时针 90°') : step.turn === -1 ? (en ? 'Counter-clockwise 90°' : '逆时针 90°') : (en ? 'Rotate 180°' : '旋转 180°')}</small></span><ChevronRight size={16} />
            </button>
          ))}</div>
        </aside>
      </section>

      <footer className="player">
        <div className="transport">
          <button aria-label={en ? 'Go to start' : '回到开头'} onClick={() => goToStep(0)}><SkipBack size={19} /></button>
          <button aria-label={en ? 'Previous step' : '上一步'} onClick={() => goToStep(currentStep - 1)}><ChevronLeft size={22} /></button>
          <button className="play-button" aria-label={playing || preparingPlayback ? (en ? 'Pause' : '暂停') : (en ? 'Play' : '播放')} onClick={togglePlaying}>{playing || preparingPlayback ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
          <button aria-label={en ? 'Next step' : '下一步'} onClick={() => goToStep(currentStep + 1)}><ChevronRight size={22} /></button>
          <button aria-label={en ? 'Go to end' : '跳到结尾'} onClick={() => goToStep(steps.length)}><SkipForward size={19} /></button>
        </div>
        <div className="timeline"><input type="range" min={0} max={Math.max(steps.length, 1)} value={currentStep} onChange={(event) => goToStep(Number(event.target.value))} style={{ '--progress': `${steps.length ? currentStep / steps.length * 100 : 0}%` } as React.CSSProperties} /><div className="timeline-copy"><span>{active ? (en ? `Step ${currentStep} · Piece ${active.joint + 1}` : `第 ${currentStep} 步 · 方块 ${active.joint + 1}`) : (en ? 'Initial state' : '初始状态')}</span><b>{currentStep} / {steps.length}</b></div></div>
        <div className="play-settings"><label>{en ? 'Speed' : '速度'}<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label><label>{en ? 'Pause' : '停顿'}<select value={pauseMs} onChange={(event) => setPauseMs(Number(event.target.value))}><option value={0}>{en ? 'None' : '无'}</option><option value={350}>0.35s</option><option value={700}>0.7s</option><option value={1200}>1.2s</option></select></label><label className="auto-viewport"><span>{en ? 'Playback view' : '播放视口'}</span><span><input type="checkbox" checked={autoViewport} onChange={(event) => changeAutoViewport(event.target.checked)} /> {en ? 'Auto frame' : '自动调整'}</span></label></div>
      </footer>

      {notice && <div className="toast" role="status">{notice}</div>}
      {showHelp && <div className="modal-backdrop" onMouseDown={() => setShowHelp(false)}><article className="help-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowHelp(false)}>×</button><span className="eyebrow">WORKBENCH</span><h2>{en ? 'Design a Magic Snake' : '直接设计魔尺'}</h2><p>{en ? 'Select a piece, then use the rotation controls. The model, formula, and step list stay in sync.' : '点击任意方块选择它的上一个关节，再使用旋转按钮。模型、公式和右侧步骤会自动同步。'}</p><ul><li><b>Ctrl/⌘ Z</b> {en ? 'Undo' : '撤销'}, <b>Ctrl/⌘ Shift Z</b> {en ? 'Redo' : '重做'}</li><li>{en ? 'Exact lattice checks validate every final pose' : '整数晶格检查每一步完成后的最终空间占位'}</li></ul><p>{en ? 'Your current work is restored automatically and can be shared through the URL.' : '工作内容会自动保存在浏览器中，也可以通过 URL 分享。'}</p></article></div>}
    </main>
  )
}

export default App
