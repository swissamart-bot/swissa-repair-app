/**
 * Browser webcam capture modal (web only).
 * Uses navigator.mediaDevices.getUserMedia — not used on Android/native.
 */
import React, { useCallback, useEffect, useRef, useState, createElement } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  StyleSheet,
  ActivityIndicator,
  Image,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../constants';

type Props = {
  visible: boolean;
  onCapture: (uri: string) => void;
  onCancel: () => void;
  /** Called when webcam cannot start — parent should fall back to file picker. */
  onUnavailable: () => void;
};

const DomVideo = React.forwardRef<HTMLVideoElement, Record<string, unknown>>(function DomVideo(props, ref) {
  return createElement('video', { ...props, ref });
});

const DomCanvas = React.forwardRef<HTMLCanvasElement, Record<string, unknown>>(function DomCanvas(props, ref) {
  return createElement('canvas', { ...props, ref });
});

export default function WebWebcamCapture({
  visible,
  onCapture,
  onCancel,
  onUnavailable,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capturedUri, setCapturedUri] = useState<string | null>(null);

  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {
        /* ignore */
      }
    }
  }, []);

  const startCamera = useCallback(
    async (deviceId?: string) => {
      if (Platform.OS !== 'web') return;
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        onUnavailable();
        return;
      }

      setStarting(true);
      setError(null);
      stopStream();

      try {
        const constraints: MediaStreamConstraints = {
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
            : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          // Retry with simpler constraints (some laptops reject facingMode/exact deviceId).
          stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          video.muted = true;
          video.playsInline = true;
          await video.play().catch(() => {});
        }

        // Labels appear after permission — refresh device list.
        const all = await navigator.mediaDevices.enumerateDevices();
        const cams = all.filter(d => d.kind === 'videoinput');
        setDevices(cams);
        if (deviceId && cams.length) {
          const idx = cams.findIndex(d => d.deviceId === deviceId);
          if (idx >= 0) setDeviceIndex(idx);
        }
      } catch (e: any) {
        const msg = e?.name === 'NotAllowedError' || e?.name === 'PermissionDeniedError'
          ? 'Camera permission denied'
          : e?.message || 'Camera unavailable';
        setError(msg);
        stopStream();
        // Auto-fallback for the parent (file picker).
        onUnavailable();
      } finally {
        setStarting(false);
      }
    },
    [onUnavailable, stopStream],
  );

  useEffect(() => {
    if (!visible) {
      stopStream();
      setCapturedUri(null);
      setError(null);
      return;
    }
    setCapturedUri(null);
    void startCamera();
    return () => {
      stopStream();
    };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleCancel() {
    stopStream();
    setCapturedUri(null);
    onCancel();
  }

  function handleCapture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    if (!w || !h) {
      setError('Camera not ready yet');
      return;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    // Prefer blob: URL (same style as Gallery on web) — short path, works with existing save/upload.
    canvas.toBlob(
      blob => {
        if (!blob) {
          setError('Could not capture photo');
          return;
        }
        const uri = URL.createObjectURL(blob);
        setCapturedUri(uri);
        video.pause();
      },
      'image/jpeg',
      0.75,
    );
  }

  function handleRetake() {
    setCapturedUri(null);
    const video = videoRef.current;
    if (video && streamRef.current) {
      video.srcObject = streamRef.current;
      void video.play().catch(() => {});
    } else {
      void startCamera(devices[deviceIndex]?.deviceId);
    }
  }

  function handleUsePhoto() {
    if (!capturedUri) return;
    stopStream();
    onCapture(capturedUri);
    setCapturedUri(null);
  }

  async function handleSwitchCamera() {
    if (devices.length < 2) return;
    const next = (deviceIndex + 1) % devices.length;
    setDeviceIndex(next);
    setCapturedUri(null);
    await startCamera(devices[next].deviceId);
  }

  if (Platform.OS !== 'web') return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleCancel}>
      <View style={styles.overlay}>
        <View style={styles.box} testID="webcam-modal">
          <View style={styles.header}>
            <Text style={styles.title}>Take Photo</Text>
            <TouchableOpacity onPress={handleCancel} testID="webcam-cancel-x" hitSlop={8}>
              <Ionicons name="close" size={24} color={C.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.previewWrap}>
            {starting ? (
              <View style={styles.center}>
                <ActivityIndicator color={C.primary} />
                <Text style={styles.hint}>Starting camera…</Text>
              </View>
            ) : null}

            {capturedUri ? (
              <Image source={{ uri: capturedUri }} style={styles.previewImg} resizeMode="contain" />
            ) : (
              <DomVideo
                ref={videoRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  backgroundColor: '#0A0A0A',
                  display: starting ? 'none' : 'block',
                }}
              />
            )}

            {/* Off-screen canvas for capture */}
            <DomCanvas ref={canvasRef} style={{ display: 'none' }} />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            {!capturedUri ? (
              <>
                {devices.length > 1 ? (
                  <TouchableOpacity
                    testID="webcam-switch"
                    style={styles.secondaryBtn}
                    onPress={handleSwitchCamera}
                    disabled={starting}
                  >
                    <Ionicons name="camera-reverse-outline" size={20} color={C.primary} />
                    <Text style={styles.secondaryText}>Switch camera</Text>
                  </TouchableOpacity>
                ) : (
                  <View style={{ flex: 1 }} />
                )}
                <TouchableOpacity
                  testID="webcam-capture"
                  style={styles.primaryBtn}
                  onPress={handleCapture}
                  disabled={starting}
                >
                  <Ionicons name="camera" size={20} color={C.primaryFg} />
                  <Text style={styles.primaryText}>Capture Photo</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <TouchableOpacity testID="webcam-retake" style={styles.secondaryBtn} onPress={handleRetake}>
                  <Ionicons name="refresh-outline" size={20} color={C.primary} />
                  <Text style={styles.secondaryText}>Retake</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="webcam-use" style={styles.primaryBtn} onPress={handleUsePhoto}>
                  <Ionicons name="checkmark-circle" size={20} color={C.primaryFg} />
                  <Text style={styles.primaryText}>Use Photo</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          <TouchableOpacity testID="webcam-cancel" style={styles.cancelBtn} onPress={handleCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  box: {
    width: '100%',
    maxWidth: 720,
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '800', color: C.primary },
  previewWrap: {
    width: '100%',
    height: 360,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0A0A0A',
    position: 'relative',
  },
  previewImg: { width: '100%', height: '100%' },
  center: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  hint: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  error: { color: C.red, fontSize: 13, fontWeight: '600', marginTop: 8 },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
    alignItems: 'center',
  },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 10,
    paddingVertical: 12,
  },
  primaryText: { color: C.primaryFg, fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 12,
  },
  secondaryText: { color: C.primary, fontSize: 14, fontWeight: '700' },
  cancelBtn: { alignItems: 'center', paddingVertical: 12, marginTop: 4 },
  cancelText: { fontSize: 14, fontWeight: '700', color: C.textMuted },
});
