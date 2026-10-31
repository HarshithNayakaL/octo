/** Audio helpers shared by the Live and turn voice modes. */

/** Average-downsample float samples to a lower rate (e.g. 48 kHz mic to 16 kHz for Gemini Live). */
export function downsample(
  input: Float32Array,
  fromRate: number,
  toRate = 16000,
) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** Float samples in [-1, 1] to 16-bit little-endian PCM bytes. */
export function floatToPcm16(samples: Float32Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

/** 16-bit little-endian PCM bytes to float samples. */
export function pcm16ToFloat(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let i = 0; i < out.length; i++)
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

export function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function base64ToBytes(data: string) {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Root-mean-square loudness of a block, for the level meter and silence detection. */
export function rms(samples: Float32Array) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

/** Sample rate from a mime type such as "audio/pcm;rate=24000". */
export const rateOf = (mimeType: string, fallback = 24000) =>
  Number(/rate=(\d+)/.exec(mimeType)?.[1]) || fallback;

/**
 * Plays streamed audio chunks back to back without gaps, and can stop at once
 * when the person interrupts.
 */
export class ChunkPlayer {
  private context: AudioContext;
  private next = 0;
  private sources = new Set<AudioBufferSourceNode>();
  readonly analyser: AnalyserNode;
  onIdle?: () => void;
  constructor(context?: AudioContext) {
    this.context = context ?? new AudioContext();
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 512;
    this.analyser.connect(this.context.destination);
  }
  get playing() {
    return this.sources.size > 0;
  }
  async resume() {
    if (this.context.state === "suspended") await this.context.resume();
  }
  /** Queue raw 16-bit PCM. */
  pcm(bytes: Uint8Array, sampleRate: number) {
    const samples = pcm16ToFloat(bytes);
    if (!samples.length) return;
    const buffer = this.context.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    this.schedule(buffer);
  }
  /** Queue an encoded file such as WAV or MP3. */
  async encoded(bytes: Uint8Array) {
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    this.schedule(await this.context.decodeAudioData(copy as ArrayBuffer));
  }
  private schedule(buffer: AudioBuffer) {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    const start = Math.max(this.context.currentTime + 0.02, this.next);
    source.start(start);
    this.next = start + buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (!this.sources.size) this.onIdle?.();
    };
  }
  /** Stop everything now (barge-in). */
  stop() {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    }
    this.sources.clear();
    this.next = 0;
  }
  level() {
    const data = new Uint8Array(this.analyser.fftSize);
    this.analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += ((v - 128) / 128) ** 2;
    return Math.sqrt(sum / data.length);
  }
  async close() {
    this.stop();
    await this.context.close().catch(() => undefined);
  }
}
