/**
 * src/pages/Dashboard.tsx
 * =======================
 * Main dashboard view for the NeoNexus Interview Copilot.
 *
 * New Flow (Continuous Streaming):
 *   1. User clicks "Start Session" - connects to Deepgram via backend WebSocket proxy
 *   2. Audio streams continuously to Deepgram, transcript appears in real-time
 *   3. User presses Shift to get AI help (sends last N lines to /session/help)
 *   4. AI response appears in ChatPanel (user context → right, AI answer → left)
 *   5. User clicks "End Session" - generates chunked summary, saves audio
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  useStore,
  selectSessionsRemaining,
} from '../lib/store';
import { ChatPanel } from '../components/ChatPanel';
import { SessionCounter } from '../components/SessionCounter';
import type { TranscriptUpdate, StreamStatus } from '../types/electron.d';

export function Dashboard() {
  // ── Store selectors ────────────────────────────────────────────────────────
  const username = useStore((s) => s.username);
  const sessionsRemaining = useStore(selectSessionsRemaining);
  const streamingState = useStore((s) => s.streamingState);
  const sessionId = useStore((s) => s.sessionId);
  const liveTranscript = useStore((s) => s.liveTranscript);

  // ── Store actions ──────────────────────────────────────────────────────────
  const setStreamingState = useStore((s) => s.setStreamingState);
  const setSessionId = useStore((s) => s.setSessionId);
  const addTranscriptLine = useStore((s) => s.addTranscriptLine);
  const updateInterimText = useStore((s) => s.updateInterimText);
  const clearTranscript = useStore((s) => s.clearTranscript);
  const setIsRecordingAudio = useStore((s) => s.setIsRecordingAudio);
  const setAudioFilePath = useStore((s) => s.setAudioFilePath);
  const setSessionLaunchAllowed = useStore((s) => s.setSessionLaunchAllowed);
  const setStatus = useStore((s) => s.setStatus);
  const setError = useStore((s) => s.setError);
  const syncProfile = useStore((s) => s.syncProfile);
  const decrementSessionsAvailable = useStore((s) => s.decrementSessionsAvailable);

  // ── Chat message actions ───────────────────────────────────────────────────
  const addUserMessage = useStore((s) => s.addUserMessage);
  const setAssistantMessage = useStore((s) => s.setAssistantMessage);
  const clearChat = useStore((s) => s.clearChat);

  // ── Local state (transient UI only) ────────────────────────────────────────
  const [processing, setProcessing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [_debugInfo, setDebugInfo] = useState('');
  const [_audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // ── Refs ───────────────────────────────────────────────────────────────────
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const sourceAudioStreamsRef = useRef<MediaStream[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const startSessionInFlightRef = useRef(false);
  const helpHotkeyDebounceRef = useRef(false);
  const elapsedTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cleanupFnsRef = useRef<(() => void)[]>([]);

  const blurActiveElement = useCallback(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) {
      active.blur();
    }
  }, []);

  const cleanupAudioPipeline = useCallback(async () => {
    for (const stream of sourceAudioStreamsRef.current) {
      stream.getTracks().forEach((track) => track.stop());
    }
    sourceAudioStreamsRef.current = [];

    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch {
        // no-op
      }
      audioContextRef.current = null;
    }

    setAudioStream(null);
  }, []);

  const createMixedInputStream = useCallback(async (): Promise<{ stream: MediaStream; includesSystemAudio: boolean; warning?: string }> => {
    const micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 16000,
      },
      video: false,
    });

    let displayStream: MediaStream | null = null;
    let warning: string | undefined;
    let includesSystemAudio = false;

    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      });

      const systemAudioTracks = displayStream.getAudioTracks();
      if (systemAudioTracks.length > 0) {
        includesSystemAudio = true;
      } else {
        warning = 'System audio not shared; continuing with microphone only.';
        displayStream.getTracks().forEach((track) => track.stop());
        displayStream = null;
      }
    } catch {
      warning = 'System audio capture was skipped; continuing with microphone only.';
      displayStream = null;
    }

    // Video track is not needed; only audio loopback is used.
    displayStream?.getVideoTracks().forEach((track) => track.stop());

    const audioContext = new AudioContext();
    const destination = audioContext.createMediaStreamDestination();

    const mixSources = [micStream, ...(displayStream ? [displayStream] : [])];
    for (const sourceStream of mixSources) {
      if (!sourceStream.getAudioTracks().length) continue;
      const sourceNode = audioContext.createMediaStreamSource(sourceStream);
      sourceNode.connect(destination);
    }

    if (!destination.stream.getAudioTracks().length) {
      audioContext.close().catch(() => undefined);
      displayStream?.getTracks().forEach((track) => track.stop());
      micStream.getTracks().forEach((track) => track.stop());
      throw new Error('Failed to capture mixed audio stream.');
    }

    sourceAudioStreamsRef.current = [micStream, ...(displayStream ? [displayStream] : [])];
    audioContextRef.current = audioContext;

    return { stream: destination.stream, includesSystemAudio, warning };
  }, []);

  // ── Derived state ──────────────────────────────────────────────────────────
  const hasSessionsAvailable = sessionsRemaining > 0;
  const sessionActive = streamingState === 'connected' || streamingState === 'connecting';

  // ── Profile sync (poll every 5s) ───────────────────────────────────────────
  useEffect(() => {
    let alive = true;

    const refreshProfile = async () => {
      try {
        const profile = await window.electronAPI.getUserProfile();
        if (!alive) return;

        syncProfile({
          username: profile.username || 'User',
          permittedSessions: profile.permitted_sessions,
          usedSessions: profile.used_sessions,
        });

        const canStart = profile.sessions_remaining > 0;
        setSessionLaunchAllowed(canStart);
      } catch {
        if (!alive) return;
      }
    };

    refreshProfile();
    const timer = window.setInterval(refreshProfile, 5000);

    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [syncProfile, setSessionLaunchAllowed]);

  // ── Setup streaming event listeners ────────────────────────────────────────
  useEffect(() => {
    // Listen for transcript updates
    const unsubTranscript = window.electronAPI.onStreamTranscript((data: TranscriptUpdate) => {
      if (data.is_final) {
        addTranscriptLine({
          speaker: data.speaker,
          text: data.text,
          isFinal: true,
          confidence: data.confidence,
          timestamp: new Date(data.timestamp),
        });
      } else {
        updateInterimText(data.text);
      }
    });

    // Listen for connection status changes
    const unsubStatus = window.electronAPI.onStreamStatus((data: StreamStatus) => {
      console.log('[Dashboard] Stream status:', data);
      if (data.status === 'connected') {
        setStreamingState('connected');
        setStatus('Streaming - listening...');
        setDebugInfo('Connected to Deepgram. Speak to see transcript.');
      } else if (data.status === 'disconnected') {
        setStreamingState('disconnected');
        setStatus('Disconnected');
        setDebugInfo(data.message || 'Stream disconnected');
      } else if (data.status === 'error') {
        setStreamingState('error');
        setError(data.message || 'Stream error');
        setDebugInfo(`Error: ${data.message}`);
      }
    });

    cleanupFnsRef.current = [unsubTranscript, unsubStatus];

    return () => {
      cleanupFnsRef.current.forEach(fn => fn());
      cleanupFnsRef.current = [];
    };
  }, [addTranscriptLine, updateInterimText, setStreamingState, setStatus, setError]);

  // ── Start Session (connect streaming) ──────────────────────────────────────
  const startSession = useCallback(async () => {
    if (startSessionInFlightRef.current || sessionActive) {
      return;
    }
    startSessionInFlightRef.current = true;

    try {
      setIsConnecting(true);
      setStatus('Starting session...');
      setStreamingState('connecting');
      
      // First, call backend to check session permissions
      const gate = await window.electronAPI.sessionStart();

      if (!gate.allowed) {
        setSessionLaunchAllowed(false);
        setStreamingState('disconnected');
        setIsConnecting(false);
        setStatus(gate.reason || 'Session not permitted by admin.');
        setError(gate.reason || 'Session not permitted. Contact admin.');
        return;
      }

      // Capture microphone + system audio and merge into one stream.
      console.log('[Dashboard] Requesting microphone and system audio access...');
      const capture = await createMixedInputStream();
      const stream = capture.stream;
      console.log('[Dashboard] Mixed audio stream ready');
      setAudioStream(stream);

      // Connect to streaming WebSocket
      const connectResult = await window.electronAPI.streamConnect();
      if (!connectResult.success) {
        await cleanupAudioPipeline();
        setStreamingState('error');
        setIsConnecting(false);
        setError(connectResult.error || 'Failed to connect to streaming service');
        return;
      }

      setSessionId(connectResult.sessionId || null);
      
      // Start local audio recording
      const recordingResult = await window.electronAPI.startAudioRecording();
      if (recordingResult.success) {
        setIsRecordingAudio(true);
        setAudioFilePath(recordingResult.path || null);
      }

      // Setup MediaRecorder to send audio chunks with best available mime.
      const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
      const recorder = new MediaRecorder(stream, preferredMime ? { mimeType: preferredMime } : undefined);

      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          const buffer = await e.data.arrayBuffer();
          
          // Send to Deepgram via WebSocket
          window.electronAPI.streamSendAudio(buffer);
          
          // Also save locally
          window.electronAPI.writeAudioChunk(buffer);
        }
      };

      recorder.start(250); // Send chunks every 250ms
      mediaRecorderRef.current = recorder;

      // Reset UI state
      clearTranscript();
      clearChat();
      setElapsedSeconds(0);
      blurActiveElement();
      
      // Start elapsed timer
      elapsedTimerRef.current = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);

      setIsConnecting(false);
      setSessionLaunchAllowed(true);
      if (capture.includesSystemAudio) {
        setStatus('Session started - streaming mic + system audio');
        setDebugInfo('Listening to microphone and shared system audio. Press Shift for AI help.');
      } else {
        setStatus('Session started - microphone streaming');
        setDebugInfo(capture.warning || 'Listening to microphone only.');
      }
    } catch (err: unknown) {
      await cleanupAudioPipeline();
      const msg = err instanceof Error ? err.message : 'Unable to start session.';
      setError(msg);
      setStatus('Failed to start session');
      setStreamingState('disconnected');
      setIsConnecting(false);
    } finally {
      startSessionInFlightRef.current = false;
    }
  }, [
    sessionActive,
    setStatus,
    setError,
    setStreamingState,
    setSessionId,
    setSessionLaunchAllowed,
    setIsRecordingAudio,
    setAudioFilePath,
    clearTranscript,
    clearChat,
    blurActiveElement,
    createMixedInputStream,
    cleanupAudioPipeline,
  ]);

  // ── End Session ────────────────────────────────────────────────────────────
  const endSession = useCallback(async () => {
    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    // Stop and release mixed audio capture pipeline.
    await cleanupAudioPipeline();

    // Stop elapsed timer
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }

    // Stop local recording
    await window.electronAPI.stopAudioRecording();
    setIsRecordingAudio(false);

    // Disconnect streaming
    const disconnectResult = await window.electronAPI.streamDisconnect();
    console.log('[Dashboard] Disconnect result:', disconnectResult);

    setStreamingState('disconnected');
    blurActiveElement();
    setStatus('Generating summary...');
    setDebugInfo('Processing session transcript...');

    try {
      // Build full transcript from lines
      const transcriptLines = liveTranscript.map(line => line.text);
      
      // End session with chunked summarization
      const result = await window.electronAPI.sessionEnd({
        transcript: transcriptLines,
        session_id: sessionId || undefined,
      });
      
      decrementSessionsAvailable();
      setStatus('Session ended');
      setDebugInfo(`Summary generated (${result.summary?.length || 0} chars)`);
      
      // Optionally show summary in chat
      if (result.summary) {
        setAssistantMessage(`**Session Summary:**\n\n${result.summary}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to end session';
      setError(msg);
      setDebugInfo(`Error ending session: ${msg}`);
    }

    clearTranscript();
    setSessionId(null);
    setAudioFilePath(null);
  }, [
    sessionId,
    liveTranscript,
    setStreamingState,
    setIsRecordingAudio,
    setAudioFilePath,
    setSessionId,
    setStatus,
    setError,
    setAssistantMessage,
    clearTranscript,
    decrementSessionsAvailable,
    blurActiveElement,
    cleanupAudioPipeline,
  ]);

  // ── Request AI Help (Shift hotkey) ─────────────────────────────────────────
  const requestHelp = useCallback(async () => {
    if (processing) return;
    
    setProcessing(true);
    setStatus('Getting AI help...');
    
    // Get last few lines for context display
    const contextLines = liveTranscript.slice(-15);
    const contextText = contextLines.map(l => l.text).join('\n');
    
    // Show what we're sending as user message
    if (contextText.trim()) {
      addUserMessage(`[Context: Last ${contextLines.length} lines]\n${contextText}`);
    }

    try {
      const result = await window.electronAPI.sessionHelp({
        sessionId: sessionId || undefined,
        contextLines: 15,
      });

      if (result.success && result.answer) {
        setAssistantMessage(result.answer);
        setStatus('Streaming - listening...');
        setDebugInfo('AI help displayed. Continue speaking.');
      } else {
        // Fallback: use direct respond endpoint with local context when
        // transcript buffer is not yet ready for the help endpoint.
        const latest = contextLines[contextLines.length - 1]?.text?.trim() || '';
        const history = contextLines
          .slice(0, -1)
          .map((line) => line.text)
          .filter((line) => line && line.trim().length > 0)
          .slice(-10);

        if (latest) {
          const fallback = await window.electronAPI.sessionRespond({
            utterance: latest,
            history,
          });

          if (fallback.should_respond && fallback.answer) {
            setAssistantMessage(fallback.answer);
            setStatus('Streaming - listening...');
            setDebugInfo('AI help displayed via fallback path. Continue speaking.');
            return;
          }

          setStatus(fallback.reason || result.reason || 'No help available');
          setDebugInfo(fallback.reason || result.reason || 'AI could not generate help');
        } else {
          setStatus(result.reason || 'No help available');
          setDebugInfo(result.reason || 'AI could not generate help');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to get help';
      setError(msg);
      setDebugInfo(`Error: ${msg}`);
    } finally {
      setProcessing(false);
    }
  }, [
    processing,
    sessionId,
    liveTranscript,
    addUserMessage,
    setAssistantMessage,
    setStatus,
    setError,
  ]);

  // ── Shift Hotkey Handler ───────────────────────────────────────────────────
  const handleHelpHotkey = useCallback(
    (e: KeyboardEvent) => {
      const isShiftKey = e.code === 'ShiftLeft' || e.code === 'ShiftRight';
      if (!isShiftKey || !sessionActive) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      if (e.repeat || processing) {
        return;
      }

      if (helpHotkeyDebounceRef.current) return;
      helpHotkeyDebounceRef.current = true;
      setTimeout(() => {
        helpHotkeyDebounceRef.current = false;
      }, 500);

      blurActiveElement();
      requestHelp();
    },
    [sessionActive, processing, requestHelp, blurActiveElement]
  );

  const preventHelpHotkeyKeyup = useCallback(
    (e: KeyboardEvent) => {
      const isShiftKey = e.code === 'ShiftLeft' || e.code === 'ShiftRight';
      if (!isShiftKey || !sessionActive) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
    },
    [sessionActive]
  );

  // ── Attach/detach shift hotkey listener ────────────────────────────────────
  useEffect(() => {
    window.addEventListener('keydown', handleHelpHotkey, true);
    window.addEventListener('keyup', preventHelpHotkeyKeyup, true);
    return () => {
      window.removeEventListener('keydown', handleHelpHotkey, true);
      window.removeEventListener('keyup', preventHelpHotkeyKeyup, true);
    };
  }, [handleHelpHotkey, preventHelpHotkeyKeyup]);

  // ── Format elapsed time ────────────────────────────────────────────────────
  const formatElapsed = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 14px 10px',
          borderBottom: '1px solid var(--bg-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        <div>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: '9.5px',
              letterSpacing: '0.08em',
              fontWeight: 500,
            }}
          >
            SIGNED IN AS
          </p>
          <p
            style={{
              color: 'var(--text-primary)',
              fontSize: '13px',
              fontWeight: 500,
              marginTop: '1px',
            }}
          >
            {username}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {sessionActive && (
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                fontWeight: 600,
                color: 'var(--accent)',
                minWidth: '52px',
                textAlign: 'right',
              }}
            >
              {formatElapsed(elapsedSeconds)}
            </div>
          )}

          <SessionCounter />

          {!sessionActive && (
            <button
              type="button"
              onClick={startSession}
              onMouseUp={(e) => e.currentTarget.blur()}
              disabled={isConnecting || !hasSessionsAvailable}
              style={{
                padding: '7px 12px',
                borderRadius: 'var(--radius-md)',
                background: (isConnecting || !hasSessionsAvailable) ? 'var(--bg-tertiary)' : 'var(--accent)',
                border: 'none',
                color: (isConnecting || !hasSessionsAvailable) ? 'var(--text-muted)' : '#0d1210',
                fontFamily: 'var(--font-ui)',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.04em',
                cursor: (isConnecting || !hasSessionsAvailable) ? 'not-allowed' : 'pointer',
              }}
            >
              {isConnecting ? 'Connecting...' : 'Start Session'}
            </button>
          )}

          {sessionActive && (
            <button
              type="button"
              onClick={endSession}
              onMouseUp={(e) => e.currentTarget.blur()}
              style={{
                padding: '7px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'transparent',
                border: '1px solid var(--status-error)',
                color: 'var(--status-error)',
                fontFamily: 'var(--font-ui)',
                fontSize: '11px',
                fontWeight: 600,
                letterSpacing: '0.04em',
                cursor: 'pointer',
              }}
            >
              End Session
            </button>
          )}
        </div>
      </div>

      <ChatPanel />
    </div>
  );
}
