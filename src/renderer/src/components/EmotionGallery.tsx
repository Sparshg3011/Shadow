import { Sunny, type SunnyEmotion } from './Sunny'

const ALL: SunnyEmotion[] = [
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
          <Sunny emotion={e} />
          <span className="gallery-label">{e}</span>
        </div>
      ))}
    </div>
  )
}
