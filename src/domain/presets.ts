// Digit sequences adapted from Øistein Holen's Rubik's Snake pattern library.
// In that notation 0/1/2/3 mean 0/+90/180/-90 degrees for each piece.
// https://www.oisteinholen.no/rubik/snake.html
function fromPositionDigits(digits: string) {
  return [...digits].flatMap((digit, index) => {
    if (digit === '0') return []
    const turn = digit === '3' ? -1 : Number(digit)
    return [`${index + 1}(${turn})`]
  }).join(', ')
}

export const DEFAULT_FORMULA = '2(1), 4(-1), 6(2), 8(1), 10(-1), 12(1), 14(2), 16(-1), 18(1), 20(2), 22(-1), 24(1)'

export const SHAPE_PRESETS = [
  {
    id: 'ball-24',
    name: '24 段 · 球形',
    pieceCount: 24,
    formula: '2- 3- 4+ 6+ 7+ 5- 8- 9+ 11- 10- 12+ 14+ 15+ 13- 16- 17+ 19- 20+ 21- 18- 23+ 24- 22+',
  },
  { id: 'basket-24', name: '24 段 · 篮子', pieceCount: 24, formula: fromPositionDigits('032002101101200232120021') },
  { id: 'bird-24', name: '24 段 · 小鸟', pieceCount: 24, formula: fromPositionDigits('020220001112310132111200') },
  { id: 'cat-24', name: '24 段 · 猫', pieceCount: 24, formula: fromPositionDigits('002202201022022022000000') },
  { id: 'cobra-24', name: '24 段 · 眼镜蛇', pieceCount: 24, formula: fromPositionDigits('003031233213010000200002') },
  { id: 'dog-24', name: '24 段 · 小狗', pieceCount: 24, formula: fromPositionDigits('000002202002022000202202') },
  { id: 'duck-24', name: '24 段 · 鸭子', pieceCount: 24, formula: fromPositionDigits('022000101003210012300101') },
  { id: 'elephant-24', name: '24 段 · 大象', pieceCount: 24, formula: fromPositionDigits('001013211231010220220220') },
  { id: 'penguin-24', name: '24 段 · 企鹅', pieceCount: 24, formula: fromPositionDigits('002202203233313113133102') },
  { id: 'swan-24', name: '24 段 · 天鹅', pieceCount: 24, formula: fromPositionDigits('022021301230303032103122') },
  { id: 'turtle-24', name: '24 段 · 乌龟', pieceCount: 24, formula: fromPositionDigits('003100312331311211131333') },
  { id: 'zigzag-36', name: '36 段 · 螺旋折线', pieceCount: 36, formula: fromPositionDigits('001001001001001001001001001001001001') },
  {
    id: 'hammer-72',
    name: '72 段 · 锤子',
    pieceCount: 72,
    formula: fromPositionDigits('032331311313313112310132110130312331133131131332300000000000220000000000'),
  },
] as const
