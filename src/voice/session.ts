import type { VoiceAction } from "../../shared/types";
import { api } from "../api";
import {
  ChunkPlayer,
  base64ToBytes,
  bytesToBase64,
  downsample,
  floatToPcm16,
  rateOf,
  rms,
} from "./pcm";

export type VoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";
export type VoiceMode = "live" | "turn";
export interface VoiceLine {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}
export interface VoiceEvents {
  state(state: VoiceState, detail?: string): void;
  line(line: VoiceLine): void;
  action(action: VoiceAction): void;
  level(level: number): void;
  notice(message: string): void;
}
export interface VoiceContext {
  runId?: string;
  page?: string;
}
interface LiveToken {
  token: string;
  model: string;
  websocketUrl: string;
  setup: Record<string, unknown>;
}

const id = () => Math.random().toString(36).slice(2);
/** Ends a Live session after this long without speech either way, to save free-tier minutes. */
const IDLE_MS = 90_000;
const MAX_SESSION_MS = 9 * 60_000;

/** Microphone capture through an AudioWorklet; emits raw float blocks at the device rate. */
class Microphone {
  private context?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  sampleRate = 48000;
  muted = false;
  onBlock?: (samples: Float32Array) => void;
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    this.context = new AudioContext();
    this.sampleRate = this.context.sampleRate;
    await this.context.audioWorklet.addModule("/voice-capture-worklet.js");
    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, "voice-capture");
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.muted) this.onBlock?.(e.data);
    };
    source.connect(this.node);
  }
  async stop() {
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.context?.close().catch(() => undefined);
    this.context = undefined;
  }
}

/** Shared lifecycle for both modes. */
abstract class Session {
  state: VoiceState = "idle";
  protected player = new ChunkPlayer();
  protected mic = new Microphone();
  protected history: { role: "user" | "assistant"; text: string }[] = [];
  private meter?: number;
  constructor(
    protected events: VoiceEvents,
    protected context: () => VoiceContext,
  ) {}
  protected set(state: VoiceState, detail?: string) {
    this.state = state;
    this.events.state(state, detail);
  }
  protected startMeter(input: () => number) {
    const tick = () => {
      this.events.level(this.player.playing ? this.player.level() : input());
      this.meter = requestAnimationFrame(tick);
    };
    this.meter = requestAnimationFrame(tick);
  }
  setMuted(muted: boolean) {
    this.mic.muted = muted;
  }
  abstract start(): Promise<void>;
  abstract sendText(text: string): Promise<void>;
  async stop() {
    if (this.meter) cancelAnimationFrame(this.meter);
    await this.mic.stop();
    await this.player.close();
    this.set("idle");
  }
}

/**
 * Gemini Live: speech in, speech out over one WebSocket, with transcripts and
 * barge-in. The server mints a single-use token; the key never reaches the browser.
 */
export class LiveSession extends Session {
  private ws?: WebSocket;
  private userLine?: VoiceLine;
  private botLine?: VoiceLine;
  private lastActivity = Date.now();
  private watchdog?: number;
  private inputLevel = 0;
  private ready = false;
  /** Rejects when Live fails before it is usable, so the caller can fall back. */
  async start() {
    this.set("connecting", "Starting Gemini Live…");
    const token = await api<LiveToken>("/voice/token", {
      method: "POST",
      body: JSON.stringify(this.context()),
    });
    await this.player.resume();
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(
        `${token.websocketUrl}?access_token=${encodeURIComponent(token.token)}`,
      );
      this.ws = ws;
      const fail = (message: string) => {
        if (!this.ready) reject(new Error(message));
        else this.events.notice(message);
      };
      ws.onopen = () => ws.send(JSON.stringify({ setup: token.setup }));
      ws.onerror = () => fail("Could not reach Gemini Live.");
      ws.onclose = (e) => {
        if (!this.ready) fail(e.reason || `Gemini Live closed (${e.code}).`);
        else if (this.state !== "idle") {
          this.events.notice(
            e.reason
              ? `Live session ended: ${e.reason}`
              : "Live session ended.",
          );
          void this.stop();
        }
      };
      ws.onmessage = async (e) => {
        const text =
          typeof e.data === "string" ? e.data : await (e.data as Blob).text();
        let message: any;
        try {
          message = JSON.parse(text);
        } catch {
          return;
        }
        if (message.setupComplete !== undefined && !this.ready) {
          this.ready = true;
          try {
            await this.startMic();
            resolve();
          } catch (err) {
            reject(err);
          }
          return;
        }
        this.handle(message);
      };
    });
    this.watchdog = window.setInterval(() => {
      if (Date.now() - this.lastActivity > IDLE_MS) {
        this.events.notice(
          "Ended after 90 seconds of quiet to save free-tier minutes.",
        );
        void this.stop();
      }
    }, 5000);
    window.setTimeout(() => {
      if (this.state !== "idle") {
        this.events.notice(
          "Live sessions end after 9 minutes. Tap the mic to start a new one.",
        );
        void this.stop();
      }
    }, MAX_SESSION_MS);
  }
  private async startMic() {
    this.mic.onBlock = (samples) => {
      this.inputLevel = rms(samples);
      if (this.inputLevel > 0.02) this.lastActivity = Date.now();
      if (this.ws?.readyState !== WebSocket.OPEN) return;
      const pcm = floatToPcm16(downsample(samples, this.mic.sampleRate, 16000));
      this.ws.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: bytesToBase64(pcm),
              mimeType: "audio/pcm;rate=16000",
            },
          },
        }),
      );
    };
    await this.mic.start();
    this.player.onIdle = () => {
      if (this.state === "speaking") this.set("listening", "Listening…");
    };
    this.startMeter(() => this.inputLevel);
    this.set("listening", "Listening… just talk");
  }
  private line(role: "user" | "assistant", text: string) {
    const current = role === "user" ? this.userLine : this.botLine;
    const next: VoiceLine =
      current && !current.final
        ? { ...current, text: current.text + text }
        : { id: id(), role, text, final: false };
    if (role === "user") this.userLine = next;
    else this.botLine = next;
    this.events.line(next);
  }
  private finish(role: "user" | "assistant") {
    const current = role === "user" ? this.userLine : this.botLine;
    if (!current || current.final) return;
    const done = { ...current, text: current.text.trim(), final: true };
    if (done.text) this.history.push({ role, text: done.text });
    this.events.line(done);
    if (role === "user") this.userLine = done;
    else this.botLine = done;
  }
  private handle(message: any) {
    const content = message.serverContent;
    if (content) {
      this.lastActivity = Date.now();
      if (content.inputTranscription?.text) {
        this.finish("assistant");
        this.line("user", content.inputTranscription.text);
      }
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          this.finish("user");
          if (this.state !== "speaking") this.set("speaking", "Speaking…");
          this.player.pcm(
            base64ToBytes(part.inlineData.data),
            rateOf(part.inlineData.mimeType ?? ""),
          );
        }
      }
      if (content.outputTranscription?.text) {
        this.finish("user");
        this.line("assistant", content.outputTranscription.text);
      }
      if (content.interrupted) {
        this.player.stop();
        this.finish("assistant");
        this.set("listening", "Listening…");
      }
      if (content.turnComplete) {
        this.finish("user");
        this.finish("assistant");
        if (!this.player.playing) this.set("listening", "Listening…");
      }
    }
    if (message.toolCall?.functionCalls?.length) {
      const responses = message.toolCall.functionCalls.map((call: any) => {
        if (
          call.name === "prepare_research" &&
          call.args?.title &&
          call.args?.brief
        ) {
          this.events.action({
            type: "prepare_research",
            title: String(call.args.title).slice(0, 140),
            brief: String(call.args.brief).slice(0, 4000),
            workflow: ["general", "market", "sales", "monitor"].includes(
              call.args.workflow,
            )
              ? call.args.workflow
              : "general",
          });
          return {
            id: call.id,
            name: call.name,
            response: {
              result:
                "The research form is now open with this title and brief. The person reviews it and presses Continue to start; research has not started yet.",
            },
          };
        }
        return {
          id: call.id,
          name: call.name,
          response: { error: "Unknown tool." },
        };
      });
      this.ws?.send(
        JSON.stringify({ toolResponse: { functionResponses: responses } }),
      );
    }
    if (message.goAway)
      this.events.notice("Gemini Live will end this session shortly.");
  }
  async sendText(text: string) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.lastActivity = Date.now();
    this.finish("assistant");
    const line: VoiceLine = { id: id(), role: "user", text, final: true };
    this.userLine = line;
    this.history.push({ role: "user", text });
    this.events.line(line);
    this.ws.send(JSON.stringify({ realtimeInput: { text } }));
  }
  async stop() {
    if (this.watchdog) clearInterval(this.watchdog);
    const ws = this.ws;
    this.ws = undefined;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, "Ended by user");
    await super.stop();
  }
}

/**
 * Fallback when Live is unavailable: record one question (auto-stops after a
 * pause), get the answer from a fast Gemini model, and play Gemini TTS, or the
 * browser's own voice if TTS is at its free-tier limit.
 */
export class TurnSession extends Session {
  private recorder?: MediaRecorder;
  private chunks: Blob[] = [];
  private stream?: MediaStream;
  private analyser?: AnalyserNode;
  private context2?: AudioContext;
  private silenceTimer?: number;
  private closed = false;
  async start() {
    await this.player.resume();
    this.player.onIdle = () => {
      if (this.state === "speaking")
        this.set("idle", "Tap the mic to ask again");
    };
    this.set("idle", "Tap the mic and ask your question");
  }
  get recording() {
    return this.recorder?.state === "recording";
  }
  /** Start recording; stops by itself after 1.4 s of silence or 45 s. */
  async record() {
    if (this.recording) return this.finishRecording();
    this.player.stop();
    window.speechSynthesis?.cancel();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
    const type = [
      "audio/webm;codecs=opus",
      "audio/ogg;codecs=opus",
      "audio/mp4",
    ].find(
      (t) =>
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(t),
    );
    this.recorder = new MediaRecorder(
      this.stream,
      type ? { mimeType: type, audioBitsPerSecond: 32000 } : undefined,
    );
    this.chunks = [];
    this.recorder.ondataavailable = (e) =>
      e.data.size && this.chunks.push(e.data);
    this.recorder.onstop = () => void this.submit();
    this.recorder.start(250);
    this.context2 = new AudioContext();
    const source = this.context2.createMediaStreamSource(this.stream);
    this.analyser = this.context2.createAnalyser();
    this.analyser.fftSize = 1024;
    source.connect(this.analyser);
    let heard = false;
    let quietSince = Date.now();
    const started = Date.now();
    const data = new Float32Array(this.analyser.fftSize);
    this.startMeter(() => {
      if (!this.analyser) return 0;
      this.analyser.getFloatTimeDomainData(data);
      return rms(data);
    });
    this.silenceTimer = window.setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getFloatTimeDomainData(data);
      const level = rms(data);
      if (level > 0.025) {
        heard = true;
        quietSince = Date.now();
      }
      if (
        (heard && Date.now() - quietSince > 1400) ||
        Date.now() - started > 45_000
      )
        this.finishRecording();
    }, 100);
    this.set("listening", "Listening… I'll stop when you pause");
  }
  finishRecording() {
    if (this.silenceTimer) clearInterval(this.silenceTimer);
    if (this.recorder?.state === "recording") this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.context2?.close().catch(() => undefined);
    this.analyser = undefined;
  }
  private async submit() {
    if (this.closed) return;
    const blob = new Blob(this.chunks, {
      type: this.recorder?.mimeType || "audio/webm",
    });
    if (blob.size < 2000) {
      this.set("idle", "I didn't catch that. Tap the mic and try again.");
      return;
    }
    const data = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
    await this.ask({ audio: { data, mimeType: blob.type.split(";")[0] } });
  }
  async sendText(text: string) {
    this.events.line({ id: id(), role: "user", text, final: true });
    await this.ask({ text }, text);
  }
  private async ask(input: Record<string, unknown>, typed?: string) {
    this.set("thinking", "Thinking…");
    try {
      const result = await api<{
        transcript: string;
        reply: string;
        action?: VoiceAction;
        audio?: { data: string; mimeType: string };
        ttsError?: string;
      }>("/voice/turn", {
        method: "POST",
        body: JSON.stringify({
          ...input,
          ...this.context(),
          history: this.history.slice(-8),
        }),
      });
      const said = typed ?? result.transcript;
      if (!typed && said)
        this.events.line({ id: id(), role: "user", text: said, final: true });
      this.history.push(
        { role: "user", text: said },
        { role: "assistant", text: result.reply },
      );
      this.events.line({
        id: id(),
        role: "assistant",
        text: result.reply,
        final: true,
      });
      if (result.action) this.events.action(result.action);
      this.set("speaking", "Speaking…");
      if (result.audio) {
        await this.player.encoded(base64ToBytes(result.audio.data));
      } else {
        if (result.ttsError) this.events.notice(result.ttsError);
        this.browserSpeak(result.reply);
      }
    } catch (err) {
      this.set("error", (err as Error).message);
    }
  }
  private browserSpeak(text: string) {
    const synth = window.speechSynthesis;
    if (!synth) {
      this.set("idle", "Tap the mic to ask again");
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => this.set("idle", "Tap the mic to ask again");
    synth.speak(utterance);
  }
  async stop() {
    this.closed = true;
    this.finishRecording();
    window.speechSynthesis?.cancel();
    await super.stop();
  }
}
