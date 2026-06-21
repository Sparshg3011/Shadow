import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { DeepgramCredential } from '../ipc'

// Deepgram endpoints. STT streams over a WebSocket; TTS is a one-shot REST call
// (responses are short, so we trade a little latency for much simpler playback).
const STT_URL =
  'wss://api.deepgram.com/v1/listen?' +
  new URLSearchParams({
    model: 'nova-3',
    language: 'en-US',
    smart_format: 'true',
    interim_results: 'true',
    utterance_end_ms: '1200', // seniors pause mid-sentence — wait before finalizing
    vad_events: 'true', // SpeechStarted events drive barge-in
    endpointing: '300'
  }).toString()

const TTS_URL = 'https://api.deepgram.com/v1/speak?model=aura-2-cora-en&encoding=mp3'

function authHeader(cred: DeepgramCredential): string {
  return cred.mode === 'key' ? `Token ${cred.token}` : `Bearer ${cred.token}`
}

export interface Voice {
  enabled: boolean
  toggle: () => void
  listening: boolean // mic open and streaming
  speaking: boolean // Sunny is talking
  caption: string // live partial transcript of the user
  amplitudeRef: MutableRefObject<number> // 0..1 mouth openness for lip-sync
  speak: (text: string) => Promise<void>
  stopSpeaking: () => void
}

/** Voice loop: mic → Nova-3 → onTranscript; and speak() → Aura-2 → speakers. */
export function useVoice(onTranscript: (text: string) => void): Voice {
  const [enabled, setEnabled] = useState(false)
  const [listening, setListening] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [caption, setCaption] = useState('')
  const amplitudeRef = useRef(0)

  // Keep the latest callback without restarting the mic on every render.
  const onTranscriptRef = useRef(onTranscript)
  onTranscriptRef.current = onTranscript

  // STT plumbing.
  const wsRef = useRef<WebSocket | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // TTS plumbing.
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const speakingRef = useRef(false)

  const stopSpeaking = useCallback(() => {
    try {
      sourceRef.current?.stop()
    } catch {
      // already stopped
    }
    sourceRef.current = null
    speakingRef.current = false
    amplitudeRef.current = 0
    setSpeaking(false)
  }, [])

  const speak = useCallback(async (text: string) => {
    const clean = text.trim()
    if (!clean) return
    stopSpeaking()

    const cred = await window.shadow.mintDeepgramToken()
    if (!cred) return

    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { Authorization: authHeader(cred), 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: clean })
    })
    if (!res.ok) return
    const bytes = await res.arrayBuffer()

    const ctx = ctxRef.current ?? new AudioContext()
    ctxRef.current = ctx
    if (ctx.state === 'suspended') await ctx.resume()

    const buffer = await ctx.decodeAudioData(bytes)
    const source = ctx.createBufferSource()
    source.buffer = buffer

    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyserRef.current = analyser
    source.connect(analyser)
    analyser.connect(ctx.destination)

    sourceRef.current = source
    speakingRef.current = true
    setSpeaking(true)

    // Drive mouth openness from the live waveform amplitude (RMS).
    const data = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      if (!speakingRef.current) return
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (const v of data) {
        const x = (v - 128) / 128
        sum += x * x
      }
      amplitudeRef.current = Math.min(1, Math.sqrt(sum / data.length) * 3.2)
      requestAnimationFrame(tick)
    }

    source.onended = () => {
      if (sourceRef.current === source) stopSpeaking()
    }
    source.start()
    requestAnimationFrame(tick)
  }, [stopSpeaking])

  // Start / stop the microphone + STT socket whenever the toggle changes.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let finalBuffer = ''

    const flush = () => {
      const phrase = finalBuffer.trim()
      finalBuffer = ''
      setCaption('')
      if (phrase) onTranscriptRef.current(phrase)
    }

    ;(async () => {
      const cred = await window.shadow.mintDeepgramToken()
      if (!cred || cancelled) return

      // Unlock audio output under the toggle gesture so speak() can play later.
      try {
        const ctx = ctxRef.current ?? new AudioContext()
        ctxRef.current = ctx
        if (ctx.state === 'suspended') await ctx.resume()
      } catch {
        // audio output may be unavailable; STT still works
      }

      let stream: MediaStream
      try {
        // echoCancellation keeps Sunny's own voice out of the mic (no self-transcribe).
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        })
      } catch {
        if (!cancelled) setEnabled(false)
        return
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream

      const proto = cred.mode === 'key' ? ['token', cred.token] : ['bearer', cred.token]
      const ws = new WebSocket(STT_URL, proto)
      wsRef.current = ws

      ws.onopen = () => {
        if (cancelled) return
        setListening(true)
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
        recorderRef.current = recorder
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data)
        }
        recorder.start(250)
      }

      ws.onmessage = (ev) => {
        let msg: {
          type?: string
          is_final?: boolean
          speech_final?: boolean
          channel?: { alternatives?: { transcript?: string }[] }
        }
        try {
          msg = JSON.parse(ev.data)
        } catch {
          return
        }

        if (msg.type === 'SpeechStarted') {
          // User spoke while Sunny was talking → stop and let them take over.
          if (speakingRef.current) stopSpeaking()
          return
        }
        // Ignore transcripts captured while Sunny is speaking (residual echo).
        if (speakingRef.current) return

        if (msg.type === 'UtteranceEnd') {
          flush()
        } else if (msg.type === 'Results') {
          const text = msg.channel?.alternatives?.[0]?.transcript || ''
          if (!text) return
          if (msg.is_final) finalBuffer += (finalBuffer ? ' ' : '') + text
          setCaption((finalBuffer + (msg.is_final ? '' : ' ' + text)).trim())
          if (msg.speech_final) flush()
        }
      }

      ws.onclose = () => setListening(false)
      ws.onerror = () => setListening(false)
    })()

    return () => {
      cancelled = true
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
      recorderRef.current = null
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      wsRef.current?.close()
      wsRef.current = null
      stopSpeaking()
      setListening(false)
      setCaption('')
    }
  }, [enabled, stopSpeaking])

  const toggle = useCallback(() => setEnabled((e) => !e), [])

  return { enabled, toggle, listening, speaking, caption, amplitudeRef, speak, stopSpeaking }
}
