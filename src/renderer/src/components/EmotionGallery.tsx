import { Clara, type ClaraEmotion } from './Clara'

const ALL: ClaraEmotion[] = [
  'idle',
  'listening',
  'thinking',
  'talking',
  'happy',
  'excited',
  'panic',
  'surprised',
  'confused',
  'proud',
  'sad',
  'mischievous'
]

/** Dev-only grid of every expression (open with /?gallery). */
export function EmotionGallery() {
  return (
    <div className="gallery">
      {ALL.map((e) => (
        <div className="gallery-cell" key={e}>
          <Clara emotion={e} />
          <span className="gallery-label">{e}</span>
        </div>
      ))}
    </div>
  )
}
