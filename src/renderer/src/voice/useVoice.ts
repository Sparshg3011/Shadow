import { useCallback, useEffect, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { DeepgramCredential } from '../ipc'

// Deepgram endpoints. STT streams over a WebSocket; TTS is a one-shot REST call
// (replies are short, so we trade a little latency for much simpler playback).
const STT_URL =
  'wss://api.deepgram.com/v1/listen?' +
  new URLSearchParams({
    model: 'nova-3',
    language: 'en-US',
    smart_format: 'true',
    interim_results: 'true', // required for utterance_end_ms
    utterance_end_ms: '1200', // people pause mid-sentence — wait before finalizing
    vad_events: 'true', // SpeechStarted events drive barge-in
    endpointing: '300'
  }).toString()

// aura-2-cora-en: a warm, caring Aura-2 voice (verified valid). Always pass an
// explicit model — with none, Deepgram falls back to an Aura-1 voice.
const TTS_URL = 'https://api.deepgram.com/v1/speak?model=aura-2-cora-en&encoding=mp3'

// Send a KeepAlive this often so a brief silence never trips Deepgram's ~10s
// NET-0001 idle timeout and silently drops the socket.
const KEEPALIVE_MS = 5000

function authHeader(cred: DeepgramCredential): string {
  return cred.mode === 'key' ? `Token ${cred.token}` : `Bearer ${cred.token}`
}

// Browser WS auth carries the credential in the Sec-WebSocket-Protocol subprotocol:
// a raw API key uses ['token', key]; an ephemeral JWT uses ['bearer', jwt].
function wsProtocols(cred: DeepgramCredential): string[] {
  return cred.mode === 'key' ? ['token', cred.token] : ['bearer', cred.token]
}

export interface Voice {
  enabled: boolean
  toggle: () => void
  listening: boolean // mic open and streaming
  speaking: boolean // Sunny is talking
  caption: string // live partial transcript of the user
  error: string | null // last voice failure, for a gentle UI hint
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
  const [error, setError] = useState<string | null>(null)
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
  const speakingRef = useRef(false)

  // Cache the Deepgram credential so we don't mint one per utterance.
  const credRef = useRef<{ cred: DeepgramCredential; expires: number } | null>(null)
  const getCred = useCallback(async (): Promise<DeepgramCredential | null> => {
    const cached = credRef.current
    if (cached && cached.expires > Date.now()) return cached.cred
    const cred = (await window.shadow?.mintDeepgramToken?.()) ?? null
    if (!cred) return null
    // Raw keys don't expire; ephemeral access tokens are short-lived (~30s).
    const ttl = cred.mode === 'key' ? 60 * 60 * 1000 : 20 * 1000
    credRef.current = { cred, expires: Date.now() + ttl }
    return cred
  }, [])

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

  const speak = useCallback(
    async (text: string) => {
      const clean = text.trim()
      if (!clean) return
      stopSpeaking()

      const cred = await getCred()
      if (!cred) {
        setError('Voice is unavailable — check the Deepgram key.')
        return
      }

      let bytes: ArrayBuffer
      try {
        const res = await fetch(TTS_URL, {
          method: 'POST',
          headers: { Authorization: authHeader(cred), 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: clean })
        })
        if (!res.ok) {
          console.warn('[voice] TTS failed', res.status, await res.text().catch(() => ''))
          setError("Sunny couldn't speak just now.")
          return
        }
        bytes = await res.arrayBuffer()
      } catch (err) {
        console.warn('[voice] TTS request error', err)
        setError("Sunny couldn't speak just now.")
        return
      }

      try {
        const ctx = ctxRef.current ?? new AudioContext()
        ctxRef.current = ctx
        if (ctx.state === 'suspended') await ctx.resume()

        const buffer = await ctx.decodeAudioData(bytes)
        const source = ctx.createBufferSource()
        source.buffer = buffer

        const analyser = ctx.createAnalyser()
        analyser.fftSize = 256
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
      } catch (err) {
        console.warn('[voice] playback error', err)
        stopSpeaking()
      }
    },
    [getCred, stopSpeaking]
  )

  // Start / stop the microphone + STT socket whenever the toggle changes.
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let keepAlive: ReturnType<typeof setInterval> | null = null
    let reconnect: ReturnType<typeof setTimeout> | null = null
    let attempts = 0 // reconnect attempts since the last clean open
    let finalBuffer = ''

    const flush = () => {
      const phrase = finalBuffer.trim()
      finalBuffer = ''
      setCaption('')
      if (phrase) onTranscriptRef.current(phrase)
    }

    const teardown = () => {
      if (keepAlive) clearInterval(keepAlive)
      keepAlive = null
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
      recorderRef.current = null
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      const ws = wsRef.current
      wsRef.current = null
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'CloseStream' }))
        } catch {
          // socket already gone
        }
      }
      ws?.close()
    }

    const connect = async () => {
      // Drop any previous mic/recorder before (re)connecting so we never leave a
      // second stream running or echo into a stale socket.
      if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop()
      recorderRef.current = null
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null

      const cred = await getCred()
      if (!cred || cancelled) {
        if (!cred && !cancelled) {
          setError('Voice is unavailable — check the Deepgram key.')
          setEnabled(false)
        }
        return
      }

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
      } catch (err) {
        console.warn('[voice] mic permission denied', err)
        if (!cancelled) {
          setError('I need microphone access to listen.')
          setEnabled(false)
        }
        return
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      streamRef.current = stream

      const ws = new WebSocket(STT_URL, wsProtocols(cred))
      wsRef.current = ws

      ws.onopen = () => {
        if (cancelled) return
        setError(null)
        attempts = 0 // a clean open resets the reconnect budget
        setListening(true)
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
        recorderRef.current = recorder
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0 && ws.readyState === WebSocket.OPEN) ws.send(e.data)
        }
        recorder.start(250)
        // Idle-timeout insurance even though audio normally flows continuously.
        keepAlive = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }))
        }, KEEPALIVE_MS)
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
          // User spoke while Sunny was talking → stop and let them take over (barge-in).
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

      ws.onerror = (e) => {
        console.warn('[voice] STT socket error', e)
      }
      ws.onclose = (e) => {
        if (keepAlive) clearInterval(keepAlive)
        keepAlive = null
        setListening(false)
        if (cancelled || !enabled) return
        if (wsRef.current === ws) wsRef.current = null
        // Unexpected drop while still enabled — reconnect with a small budget so a
        // persistent failure (e.g. bad credentials) can't loop forever.
        console.warn('[voice] STT socket closed', e.code, e.reason)
        if (attempts >= 3) {
          setError('Voice keeps disconnecting — tap the microphone to retry.')
          setEnabled(false)
          return
        }
        attempts += 1
        reconnect = setTimeout(() => {
          if (!cancelled) connect()
        }, 600)
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnect) clearTimeout(reconnect)
      teardown()
      stopSpeaking()
      setListening(false)
      setCaption('')
    }
  }, [enabled, getCred, stopSpeaking])

  const toggle = useCallback(() => setEnabled((e) => !e), [])

  return { enabled, toggle, listening, speaking, caption, error, amplitudeRef, speak, stopSpeaking }
}
