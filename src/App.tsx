import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Download,
  FileText,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Share2,
  SkipBack,
  SkipForward,
  Undo2,
  Upload,
} from 'lucide-react'
import { SnakeScene } from './components/SnakeScene'
import { analyzeCollisions, appendTurn } from './domain/collision'
import { formatFormula, parseFormula } from './domain/formula'
import type { Turn } from './domain/formula'
import { PIECE_SIZE_MM } from './domain/snake'

const LENGTHS = [24, 36, 48, 72] as const
const EXAMPLE = '1(1), 3(-1), 5(2), 7(1), 9(-1), 11(1), 13(2), 15(-1), 17(1), 19(2), 21(-1), 23(1)'
const STORAGE_KEY = 'magic-snake:workspace:v2'
const SHAPES_KEY = 'magic-snake:shapes:v1'

interface SavedShape {
  id: string
  name: string
  formula: string
  pieceCount: number
  savedAt: string
}

function loadInitialState() {
  const query = new URLSearchParams(window.location.search)
  const queryLength = Number(query.get('length'))
  const queryFormula = query.get('formula')
  if (LENGTHS.includes(queryLength as typeof LENGTHS[number]) && queryFormula !== null) {
    return { pieceCount: queryLength, formula: queryFormula }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '')
    if (LENGTHS.includes(saved.pieceCount) && typeof saved.formula === 'string') return saved
  } catch { /* Use the bundled example when saved data is damaged. */ }
  return { pieceCount: 24, formula: EXAMPLE }
}

function loadSavedShapes(): SavedShape[] {
  try {
    const value = JSON.parse(localStorage.getItem(SHAPES_KEY) ?? '[]')
    return Array.isArray(value) ? value : []
  } catch { return [] }
}

function download(name: string, content: BlobPart, type: string) {
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([content], { type }))
  link.download = name
  link.click()
  URL.revokeObjectURL(link.href)
}

function App() {
  const [initial] = useState(loadInitialState)
  const [pieceCount, setPieceCount] = useState<number>(initial.pieceCount)
  const [formula, setFormula] = useState(initial.formula)
  const [currentStep, setCurrentStep] = useState(() => parseFormula(initial.formula, initial.pieceCount).steps.length)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [pauseMs, setPauseMs] = useState(350)
  const [showHelp, setShowHelp] = useState(false)
  const [resetSignal, setResetSignal] = useState(0)
  const [selectedPiece, setSelectedPiece] = useState<number | undefined>()
  const [undoStack, setUndoStack] = useState<string[]>([])
  const [redoStack, setRedoStack] = useState<string[]>([])
  const [preventCollision, setPreventCollision] = useState(true)
  const [notice, setNotice] = useState('')
  const [savedShapes, setSavedShapes] = useState<SavedShape[]>(loadSavedShapes)
  const importRef = useRef<HTMLInputElement>(null)
  const textStart = useRef(formula)
  const stepRefs = useRef<Array<HTMLButtonElement | null>>([])

  const parsed = useMemo(() => parseFormula(formula, pieceCount), [formula, pieceCount])
  const steps = parsed.steps
  const animationDuration = 0.55 / speed
  const collisionIssues = useMemo(
    () => parsed.errors.length ? [] : analyzeCollisions(steps, pieceCount),
    [steps, pieceCount, parsed.errors.length],
  )
  const currentIssues = collisionIssues.filter((issue) => issue.step === currentStep)
  const collisionPieces = [...new Set(currentIssues.flatMap((issue) => issue.pieces))]
  const selectedJoint = selectedPiece !== undefined && selectedPiece > 1 ? selectedPiece - 1 : undefined

  useEffect(() => {
    setCurrentStep((step) => Math.min(step, steps.length))
    if (parsed.errors.length) setPlaying(false)
  }, [steps.length, parsed.errors.length])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, pieceCount, formula }))
  }, [pieceCount, formula])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 2400)
    return () => window.clearTimeout(timer)
  }, [notice])

  useEffect(() => {
    if (!playing) return
    if (currentStep >= steps.length) { setPlaying(false); return }
    const timer = window.setTimeout(
      () => setCurrentStep((step) => {
        const next = Math.min(step + 1, steps.length)
        setSelectedPiece(steps[next - 1] ? steps[next - 1].joint + 1 : undefined)
        return next
      }),
      animationDuration * 1000 + pauseMs,
    )
    return () => window.clearTimeout(timer)
  }, [playing, currentStep, steps.length, animationDuration, pauseMs])

  useEffect(() => {
    if (currentStep > 0) stepRefs.current[currentStep - 1]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [currentStep])

  function goToStep(step: number) {
    const next = Math.max(0, Math.min(step, steps.length))
    setCurrentStep(next)
    setSelectedPiece(next > 0 ? steps[next - 1].joint + 1 : undefined)
    setPlaying(false)
  }

  function setFinishedFormula(next: string) {
    setFormula(next)
    setCurrentStep(parseFormula(next, pieceCount).steps.length)
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
    if (parsed.errors.length) { setNotice('请先修正公式错误'); return }
    if (selectedJoint === undefined) { setNotice('请先选择第 2 块或之后的方块'); return }
    const nextSteps = appendTurn(steps, selectedJoint, turn)
    if (preventCollision) {
      const issue = analyzeCollisions(nextSteps, pieceCount).find((item) => item.step === nextSteps.length)
      if (issue) {
        setNotice(`已阻止：第 ${issue.pieces[0]}、${issue.pieces[1]} 块发生${issue.kind === 'path' ? '路径' : '姿态'}碰撞`)
        return
      }
    }
    commitFormula(formatFormula(nextSteps))
  }

  function togglePlaying() {
    if (!steps.length || parsed.errors.length) return
    if (!playing && currentStep === steps.length) {
      setCurrentStep(0)
      setSelectedPiece(undefined)
    }
    setPlaying((value) => !value)
  }

  async function share() {
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('length', String(pieceCount))
    url.searchParams.set('formula', formula)
    history.replaceState(null, '', url)
    try { await navigator.clipboard.writeText(url.toString()); setNotice('分享链接已复制') }
    catch { setNotice('链接已写入地址栏') }
  }

  function saveShape() {
    const name = window.prompt('给这个造型起个名字', `我的 ${pieceCount} 段造型`)
    if (!name?.trim()) return
    const shape: SavedShape = { id: crypto.randomUUID(), name: name.trim(), formula, pieceCount, savedAt: new Date().toISOString() }
    const next = [shape, ...savedShapes].slice(0, 30)
    setSavedShapes(next)
    localStorage.setItem(SHAPES_KEY, JSON.stringify(next))
    setNotice('造型已保存到本机')
  }

  function exportJson() {
    download('magic-snake.json', JSON.stringify({ version: 2, pieceCount, formula, exportedAt: new Date().toISOString() }, null, 2), 'application/json')
  }

  function exportPng() {
    const canvas = document.querySelector<HTMLCanvasElement>('.viewer-panel canvas')
    if (!canvas) return
    const link = document.createElement('a')
    link.download = 'magic-snake.png'
    link.href = canvas.toDataURL('image/png')
    link.click()
  }

  function exportGuide() {
    const lines = [
      `魔尺分步教学（${pieceCount} 段）`,
      '',
      `公式：${formula || '直尺'}`,
      '',
      ...steps.map((step, index) => `${index + 1}. 关节 ${step.joint}：${step.turn === 1 ? '顺时针旋转 90°' : step.turn === -1 ? '逆时针旋转 90°' : '旋转 180°'}`),
      '',
      collisionIssues.length ? `可行性警告：${collisionIssues.length} 项碰撞` : '可行性检查：通过',
    ]
    download('magic-snake-guide.txt', lines.join('\n'), 'text/plain;charset=utf-8')
  }

  async function importFile(file?: File) {
    if (!file) return
    try {
      const text = await file.text()
      let nextFormula = text.trim(); let nextLength = pieceCount
      if (file.name.endsWith('.json')) {
        const data = JSON.parse(text)
        nextFormula = data.formula
        nextLength = Number(data.pieceCount)
      }
      if (!LENGTHS.includes(nextLength as typeof LENGTHS[number]) || typeof nextFormula !== 'string') throw new Error()
      setPieceCount(nextLength)
      setUndoStack((stack) => [...stack, formula])
      setRedoStack([])
      setFormula(nextFormula)
      setCurrentStep(parseFormula(nextFormula, nextLength).steps.length)
      setNotice('文件已导入')
    } catch { setNotice('无法识别这个文件') }
    if (importRef.current) importRef.current.value = ''
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement
      if (editing) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return }
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
        <div className="brand"><div className="brand-mark" aria-hidden="true"><span /><span /><span /></div><div><h1>魔尺</h1><p>造型工作台</p></div></div>
        <div className="top-actions">
          <button className="icon-button" aria-label="撤销" title="撤销 Ctrl/⌘ Z" disabled={!undoStack.length} onClick={undo}><Undo2 size={18} /></button>
          <button className="icon-button" aria-label="重做" title="重做 Ctrl/⌘ Shift Z" disabled={!redoStack.length} onClick={redo}><Redo2 size={18} /></button>
          <button className="ghost-button" onClick={saveShape}><Save size={17} /> 保存</button>
          <button className="ghost-button" onClick={share}><Share2 size={17} /> 分享</button>
          <button className="ghost-button" onClick={() => setResetSignal((value) => value + 1)}><RotateCcw size={17} /> 重置视角</button>
          <button className="icon-button" aria-label="使用说明" onClick={() => setShowHelp(true)}><CircleHelp size={20} /></button>
        </div>
      </header>

      <section className="workspace">
        <aside className="editor-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">DESIGN</span><h2>造型编辑器</h2></div>
            <select value={pieceCount} onChange={(event) => { const length = Number(event.target.value); setPieceCount(length); setCurrentStep(parseFormula(formula, length).steps.length); setPlaying(false); setSelectedPiece(undefined) }}>
              {LENGTHS.map((length) => <option key={length} value={length}>{length} 段</option>)}
            </select>
          </div>

          <section className="joint-editor" aria-label="关节编辑">
            <div className="joint-editor-title"><span>{selectedPiece === undefined ? '点击模型选择方块' : `方块 ${selectedPiece} 的上一关节`}</span><b>{selectedJoint ?? '—'}</b></div>
            <input aria-label="选择关节" type="range" min={1} max={pieceCount - 1} value={selectedJoint ?? 1} onChange={(event) => setSelectedPiece(Number(event.target.value) + 1)} />
            <div className="joint-actions">
              <button disabled={selectedJoint === undefined} onClick={() => rotateSelected(-1)} title="快捷键 -"><RotateCcw size={17} />逆时针</button>
              <button disabled={selectedJoint === undefined} onClick={() => rotateSelected(2)} title="快捷键 2">180°</button>
              <button disabled={selectedJoint === undefined} onClick={() => rotateSelected(1)} title="快捷键 1"><RotateCw size={17} />顺时针</button>
            </div>
            <div className="edit-options">
              <label><input type="checkbox" checked={preventCollision} onChange={(event) => setPreventCollision(event.target.checked)} /> 阻止不可实现的旋转</label>
              <button onClick={() => commitFormula('')}>一键拉直</button>
            </div>
          </section>

          <label className="formula-label" htmlFor="formula">公式（模型操作会自动同步）</label>
          <textarea
            id="formula"
            value={formula}
            spellCheck={false}
            onFocus={() => { textStart.current = formula }}
            onBlur={() => { if (textStart.current !== formula) { setUndoStack((stack) => [...stack, textStart.current]); setRedoStack([]) } }}
            onChange={(event) => { const next = event.target.value; setFormula(next); setCurrentStep(parseFormula(next, pieceCount).steps.length); setPlaying(false) }}
            placeholder="例如：1(1), 3(-1), 5(2)"
          />
          <div className="legend"><span><i className="cw" />1 顺时针</span><span><i className="ccw" />−1 逆时针</span><span><i className="half" />2 旋转 180°</span></div>
          {parsed.errors.length > 0 && <div className="error-box">{parsed.errors.map((error) => <p key={error}>{error}</p>)}</div>}
          {collisionIssues.length > 0 && <div className="collision-box"><b>可行性检查：发现 {collisionIssues.length} 项</b><p>{collisionIssues.slice(0, 3).map((issue) => `步骤 ${issue.step}：方块 ${issue.pieces.join(' / ')} ${issue.kind === 'path' ? '旋转路径相撞' : '最终姿态相撞'}`).join('；')}</p></div>}

          <div className="file-actions">
            <button onClick={() => importRef.current?.click()}><Upload size={15} />导入</button>
            <button onClick={exportJson}><Download size={15} />JSON</button>
            <button onClick={exportPng}><Camera size={15} />PNG</button>
            <button onClick={exportGuide}><FileText size={15} />教学</button>
            <input ref={importRef} hidden type="file" accept=".json,.txt,text/plain,application/json" onChange={(event) => importFile(event.target.files?.[0])} />
          </div>
          {savedShapes.length > 0 && <select className="saved-shapes" defaultValue="" onChange={(event) => { const shape = savedShapes.find((item) => item.id === event.target.value); if (shape) { setUndoStack((stack) => [...stack, formula]); setRedoStack([]); setPieceCount(shape.pieceCount); setFormula(shape.formula); setCurrentStep(parseFormula(shape.formula, shape.pieceCount).steps.length); setPlaying(false) }; event.target.value = '' }}><option value="" disabled>打开已保存造型…</option>{savedShapes.map((shape) => <option key={shape.id} value={shape.id}>{shape.name} · {shape.pieceCount} 段</option>)}</select>}

        </aside>

        <section className="viewer-panel">
          <div className="viewer-badge">{pieceCount} 段 · {PIECE_SIZE_MM} mm{selectedPiece ? ` · 方块 ${selectedPiece}${selectedJoint ? ` / 关节 ${selectedJoint}` : ''}` : ''}</div>
          <SnakeScene pieceCount={pieceCount} steps={steps} currentStep={currentStep} animationDuration={animationDuration} resetSignal={resetSignal} selectedPiece={selectedPiece} collisionPieces={collisionPieces} onSelectPiece={(piece) => { setSelectedPiece(piece); setPlaying(false) }} />
          <div className="viewer-hint">点击选择方块 · 拖动旋转视角 · 滚轮缩放</div>
        </section>

        <aside className="teaching-panel">
          <div className="teaching-heading"><div><span className="eyebrow">TUTORIAL</span><h2>教学步骤</h2></div><b>{steps.length} 步</b></div>
          <button className={currentStep === 0 ? 'initial-step active' : 'initial-step'} onClick={() => goToStep(0)}>初始直尺状态</button>
          <div className="step-list">{steps.map((step, index) => (
            <button
              ref={(node) => { stepRefs.current[index] = node }}
              key={`${step.source}-${index}`}
              className={`${currentStep === index + 1 ? 'step active' : currentStep > index + 1 ? 'step done' : 'step'} ${collisionIssues.some((issue) => issue.step === index + 1) ? 'collision' : ''}`}
              onClick={() => goToStep(index + 1)}
            >
              <span className="step-number">{index + 1}</span><span><strong>关节 {step.joint}</strong><small>{step.turn === 1 ? '顺时针 90°' : step.turn === -1 ? '逆时针 90°' : '旋转 180°'}</small></span><ChevronRight size={16} />
            </button>
          ))}</div>
        </aside>
      </section>

      <footer className="player">
        <div className="transport">
          <button aria-label="回到开头" onClick={() => goToStep(0)}><SkipBack size={19} /></button>
          <button aria-label="上一步" onClick={() => goToStep(currentStep - 1)}><ChevronLeft size={22} /></button>
          <button className="play-button" aria-label={playing ? '暂停' : '播放'} onClick={togglePlaying}>{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
          <button aria-label="下一步" onClick={() => goToStep(currentStep + 1)}><ChevronRight size={22} /></button>
          <button aria-label="跳到结尾" onClick={() => goToStep(steps.length)}><SkipForward size={19} /></button>
        </div>
        <div className="timeline"><input type="range" min={0} max={Math.max(steps.length, 1)} value={currentStep} onChange={(event) => goToStep(Number(event.target.value))} style={{ '--progress': `${steps.length ? currentStep / steps.length * 100 : 0}%` } as React.CSSProperties} /><div className="timeline-copy"><span>{active ? `第 ${currentStep} 步 · 关节 ${active.joint}` : '初始状态'}</span><b>{currentStep} / {steps.length}</b></div></div>
        <div className="play-settings"><label>速度<select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label><label>停顿<select value={pauseMs} onChange={(event) => setPauseMs(Number(event.target.value))}><option value={0}>无</option><option value={350}>0.35s</option><option value={700}>0.7s</option><option value={1200}>1.2s</option></select></label></div>
      </footer>

      {notice && <div className="toast" role="status">{notice}</div>}
      {showHelp && <div className="modal-backdrop" onMouseDown={() => setShowHelp(false)}><article className="help-modal" onMouseDown={(event) => event.stopPropagation()}><button className="modal-close" onClick={() => setShowHelp(false)}>×</button><span className="eyebrow">WORKBENCH</span><h2>直接设计魔尺</h2><p>点击任意方块选择它的上一个关节，再使用旋转按钮。模型、公式和右侧教学步骤会自动同步。</p><div className="help-code">1：顺时针　−：逆时针　2：180°</div><ul><li><b>Ctrl/⌘ Z</b> 撤销，<b>Ctrl/⌘ Shift Z</b> 重做</li><li>碰撞检查同时检查最终姿态和旋转经过的路径</li><li>公式中关节 1 位于第 1、2 块之间</li></ul><p>工作内容会自动保存在浏览器中，也可以导出 JSON 或通过 URL 分享。</p></article></div>}
    </main>
  )
}

export default App
