/**
 * Audio Recording Hook
 *
 * Provides audio recording functionality using the MediaRecorder API.
 * Includes audio level visualization for feedback.
 *
 * @module domains/chat/hooks/useAudioRecording
 */

import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Audio recording state
 */
export interface AudioRecordingState {
  /** Whether currently recording */
  isRecording: boolean;
  /** Audio level for visualization (0-100) */
  audioLevel: number;
  /** Duration of current recording in seconds */
  duration: number;
  /** Error message if recording failed */
  error: string | null;
  /** Whether the browser supports audio recording */
  isSupported: boolean;
}

/**
 * Audio recording hook result
 */
export interface UseAudioRecordingResult extends AudioRecordingState {
  /** Start recording audio */
  startRecording: () => Promise<void>;
  /** Stop recording and get the audio blob */
  stopRecording: () => Promise<Blob | null>;
  /** Cancel recording without returning data */
  cancelRecording: () => void;
}

/**
 * Check if audio recording is supported in the browser
 */
function isAudioRecordingSupported(): boolean {
  return typeof window !== 'undefined' &&
    'MediaRecorder' in window &&
    'navigator' in window &&
    'mediaDevices' in navigator &&
    'getUserMedia' in navigator.mediaDevices;
}

/**
 * Hook for audio recording with level visualization
 *
 * @example
 * ```tsx
 * const { isRecording, audioLevel, startRecording, stopRecording } = useAudioRecording();
 *
 * const handleMicClick = async () => {
 *   if (isRecording) {
 *     const blob = await stopRecording();
 *     if (blob) {
 *       // Send blob to transcription API
 *     }
 *   } else {
 *     await startRecording();
 *   }
 * };
 * ```
 */
export function useAudioRecording(): UseAudioRecordingResult {
  const [isRecording, setIsRecording] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [duration, setDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startTimeRef = useRef<number>(0);

  const isSupported = isAudioRecordingSupported();

  /**
   * Update audio level from analyser using animation frame loop.
   * Uses useEffect to manage the animation frame lifecycle based on isRecording state.
   */
  useEffect(() => {
    if (!isRecording) return;

    const updateLevel = () => {
      if (!analyserRef.current) return;

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
      analyserRef.current.getByteFrequencyData(dataArray);

      // Calculate average level
      const sum = dataArray.reduce((a, b) => a + b, 0);
      const average = sum / dataArray.length;

      // Scale to 0-100 and add some amplification
      const level = Math.min(100, Math.round(average * 1.5));
      setAudioLevel(level);

      // Continue animation loop
      animationFrameRef.current = requestAnimationFrame(updateLevel);
    };

    // Start the animation loop
    animationFrameRef.current = requestAnimationFrame(updateLevel);

    // Cleanup on unmount or when recording stops
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isRecording]);

  /**
   * Update recording duration
   */
  const updateDuration = useCallback(() => {
    const elapsed = (Date.now() - startTimeRef.current) / 1000;
    setDuration(Math.floor(elapsed));
  }, []);

  /**
   * Start audio recording
   */
  const startRecording = useCallback(async () => {
    if (!isSupported) {
      setError('Audio recording is not supported in this browser');
      return;
    }

    setError(null);
    chunksRef.current = [];

    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      // Set up audio analyser for level visualization
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Create MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      // Start recording
      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
      startTimeRef.current = Date.now();

      // Audio level updates are handled by useEffect when isRecording changes

      // Start duration timer
      durationIntervalRef.current = setInterval(updateDuration, 100);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start recording';
      setError(message);
      console.error('Failed to start recording:', err);
    }
  }, [isSupported, updateDuration]);

  /**
   * Clean up recording resources
   */
  const cleanup = useCallback(() => {
    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop duration interval
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }

    // Stop media stream tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    setAudioLevel(0);
    setDuration(0);
  }, []);

  /**
   * Stop recording and return the audio blob
   */
  const stopRecording = useCallback(async (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
        cleanup();
        setIsRecording(false);
        resolve(null);
        return;
      }

      mediaRecorderRef.current.onstop = () => {
        const mimeType = mediaRecorderRef.current?.mimeType ?? 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: mimeType });
        chunksRef.current = [];
        mediaRecorderRef.current = null;

        cleanup();
        setIsRecording(false);
        resolve(blob);
      };

      mediaRecorderRef.current.stop();
    });
  }, [cleanup]);

  /**
   * Cancel recording without returning data
   */
  const cancelRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];

    cleanup();
    setIsRecording(false);
    setError(null);
  }, [cleanup]);

  return {
    isRecording,
    audioLevel,
    duration,
    error,
    isSupported,
    startRecording,
    stopRecording,
    cancelRecording,
  };
}
