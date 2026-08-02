// Digit sequences adapted from Øistein Holen's Rubik's Snake pattern library.
// In this notation 0/1/2/3 mean 0/+90/180/-90 degrees for each piece.
// https://www.oisteinholen.no/rubik/snake.html
export const DEFAULT_FORMULA = '010302010301020301020301'

export const SHAPE_PRESETS = [
  {
    id: 'ball-24',
    name: '24 段 · 球形',
    nameEn: '24-piece · Ball',
    pieceCount: 24,
    formula: '033131131331311313313113',
  },
  { id: 'basket-24', name: '24 段 · 篮子', nameEn: '24-piece · Basket', pieceCount: 24, formula: '032002101101200232120021' },
  { id: 'bird-24', name: '24 段 · 小鸟', nameEn: '24-piece · Bird', pieceCount: 24, formula: '020220001112310132111200' },
  { id: 'cat-24', name: '24 段 · 猫', nameEn: '24-piece · Cat', pieceCount: 24, formula: '002202201022022022000000' },
  { id: 'cobra-24', name: '24 段 · 眼镜蛇', nameEn: '24-piece · Cobra', pieceCount: 24, formula: '003031233213010000200002' },
  { id: 'dog-24', name: '24 段 · 小狗', nameEn: '24-piece · Dog', pieceCount: 24, formula: '000002202002022000202202' },
  { id: 'duck-24', name: '24 段 · 鸭子', nameEn: '24-piece · Duck', pieceCount: 24, formula: '022000101003210012300101' },
  { id: 'elephant-24', name: '24 段 · 大象', nameEn: '24-piece · Elephant', pieceCount: 24, formula: '001013211231010220220220' },
  { id: 'penguin-24', name: '24 段 · 企鹅', nameEn: '24-piece · Penguin', pieceCount: 24, formula: '002202203233313113133102' },
  { id: 'swan-24', name: '24 段 · 天鹅', nameEn: '24-piece · Swan', pieceCount: 24, formula: '022021301230303032103122' },
  { id: 'turtle-24', name: '24 段 · 乌龟', nameEn: '24-piece · Turtle', pieceCount: 24, formula: '003100312331311211131333' },
  { id: 'zigzag-36', name: '36 段 · 螺旋折线', nameEn: '36-piece · Spiral zigzag', pieceCount: 36, formula: '001001001001001001001001001001001001' },
  {
    id: 'hammer-72',
    name: '72 段 · 锤子',
    nameEn: '72-piece · Hammer',
    pieceCount: 72,
    formula: '032331311313313112310132110130312331133131131332300000000000220000000000',
  },
] as const
