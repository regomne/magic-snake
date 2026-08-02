import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CircleHelp, Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react'
import { SnakeScene } from './components/SnakeScene'
import { parseFormula } from './domain/formula'
import { PIECE_SIZE_MM } from './domain/snake'

const LENGTHS = [24, 36, 48, 72] as const
const EXAMPLE = '1(1), 3(-1), 5(2), 7(1), 9(-1), 11(1), 13(2), 15(-1), 17(1), 19(2), 21(-1), 23(1)'

function App() {
  const [pieceCount, setPieceCount] = useState<number>(24)
  const [formula, setFormula] = useState(EXAMPLE)
  const [currentStep, setCurrentStep] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [pauseMs, setPauseMs] = useState(350)
  const [showHelp, setShowHelp] = useState(false)
  const [resetSignal, setResetSignal] = useState(0)

  const parsed = useMemo(() => parseFormula(formula, pieceCount), [formula, pieceCount])
  const steps = parsed.steps
  const animationDuration = 0.55 / speed

  useEffect(() => {
    setCurrentStep((step) => Math.min(step, steps.length))
    if (parsed.errors.length) setPlaying(false)
  }, [steps.length, parsed.errors.length])

  useEffect(() => {
    if (!playing) return
    if (currentStep >= steps.length) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(
      () => setCurrentStep((step) => Math.min(step + 1, steps.length)),
      animationDuration * 1000 + pauseMs,
    )
    return () => window.clearTimeout(timer)
  }, [playing, currentStep, steps.length, animationDuration, pauseMs])

  function togglePlaying() {
    if (!steps.length || parsed.errors.length) return
    if (!playing && currentStep === steps.length) setCurrentStep(0)
    setPlaying((value) => !value)
  }

  const active = currentStep > 0 ? steps[currentStep - 1] : undefined

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div><h1>魔尺</h1><p>公式模拟器</p></div>
        </div>
        <div className="top-actions">
          <button className="ghost-button" onClick={() => setResetSignal((v) => v + 1)}><RotateCcw size={17} /> 重置视角</button>
          <button className="icon-button" aria-label="使用说明" onClick={() => setShowHelp(true)}><CircleHelp size={20} /></button>
        </div>
      </header>

      <section className="workspace">
        <aside className="editor-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">FORMULA</span><h2>公式编辑器</h2></div>
            <select value={pieceCount} onChange={(event) => { setPieceCount(Number(event.target.value)); setCurrentStep(0); setPlaying(false) }}>
              {LENGTHS.map((length) => <option key={length} value={length}>{length} 段</option>)}
            </select>
          </div>

          <label className="formula-label" htmlFor="formula">每项表示“关节编号（旋转）”</label>
          <textarea
            id="formula"
            value={formula}
            spellCheck={false}
            onChange={(event) => { setFormula(event.target.value); setCurrentStep(0); setPlaying(false) }}
            placeholder="例如：1(1), 3(-1), 5(2)"
          />
          <div className="legend"><span><i className="cw" />1 顺时针</span><span><i className="ccw" />−1 逆时针</span><span><i className="half" />2 旋转 180°</span></div>
          {parsed.errors.length > 0 && <div className="error-box">{parsed.errors.map((error) => <p key={error}>{error}</p>)}</div>}

          <div className="step-list-heading"><span>拆解步骤</span><b>{steps.length} 步</b></div>
          <div className="step-list">
            {steps.map((step, index) => (
              <button
                key={`${step.source}-${index}`}
                className={currentStep === index + 1 ? 'step active' : currentStep > index + 1 ? 'step done' : 'step'}
                onClick={() => { setCurrentStep(index + 1); setPlaying(false) }}
              >
                <span className="step-number">{index + 1}</span>
                <span><strong>关节 {step.joint}</strong><small>{step.turn === 1 ? '顺时针 90°' : step.turn === -1 ? '逆时针 90°' : '旋转 180°'}</small></span>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        </aside>

        <section className="viewer-panel">
          <div className="viewer-badge">{pieceCount} 段 · {PIECE_SIZE_MM} mm 标准块</div>
          <SnakeScene pieceCount={pieceCount} steps={steps} currentStep={currentStep} animationDuration={animationDuration} resetSignal={resetSignal} />
          <div className="viewer-hint">拖动旋转 · 滚轮缩放 · 右键平移</div>
        </section>
      </section>

      <footer className="player">
        <div className="transport">
          <button aria-label="回到开头" onClick={() => { setCurrentStep(0); setPlaying(false) }}><SkipBack size={19} /></button>
          <button aria-label="上一步" onClick={() => { setCurrentStep((v) => Math.max(0, v - 1)); setPlaying(false) }}><ChevronLeft size={22} /></button>
          <button className="play-button" aria-label={playing ? '暂停' : '播放'} onClick={togglePlaying}>{playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
          <button aria-label="下一步" onClick={() => { setCurrentStep((v) => Math.min(steps.length, v + 1)); setPlaying(false) }}><ChevronRight size={22} /></button>
          <button aria-label="跳到结尾" onClick={() => { setCurrentStep(steps.length); setPlaying(false) }}><SkipForward size={19} /></button>
        </div>
        <div className="timeline">
          <input type="range" min={0} max={Math.max(steps.length, 1)} value={currentStep} onChange={(e) => { setCurrentStep(Number(e.target.value)); setPlaying(false) }} style={{ '--progress': `${steps.length ? currentStep / steps.length * 100 : 0}%` } as React.CSSProperties} />
          <div className="timeline-copy"><span>{active ? `第 ${currentStep} 步 · 关节 ${active.joint}` : '初始状态'}</span><b>{currentStep} / {steps.length}</b></div>
        </div>
        <div className="play-settings">
          <label>速度<select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}><option value={0.5}>0.5×</option><option value={1}>1×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label>
          <label>停顿<select value={pauseMs} onChange={(e) => setPauseMs(Number(e.target.value))}><option value={0}>无</option><option value={350}>0.35s</option><option value={700}>0.7s</option><option value={1200}>1.2s</option></select></label>
        </div>
      </footer>

      {showHelp && <div className="modal-backdrop" onMouseDown={() => setShowHelp(false)}><article className="help-modal" onMouseDown={(e) => e.stopPropagation()}><button className="modal-close" onClick={() => setShowHelp(false)}>×</button><span className="eyebrow">SPECIFICATION</span><h2>公式与方向约定</h2><p>每个块是直角边与厚度均为 30 mm 的等腰直角三棱柱。关节 1 位于第 1、2 块之间，因此 N 段魔尺共有 N−1 个关节。</p><div className="help-code">1(1), 3(-1), 5(2)</div><ul><li><b>1</b>：面对它依附的上一块矩形面时，顺时针 90°</li><li><b>−1</b>：同一观察方向下，逆时针 90°</li><li><b>2</b>：旋转 180°，方向等价</li></ul><p>重复写同一关节会累积旋转。逗号、中文逗号、分号或换行均可分隔步骤。</p></article></div>}
    </main>
  )
}

export default App
