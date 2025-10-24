#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
};

type ForgetOptions = {
  sigma: number;
  decay: number;
  referenced: Iterable<string> | null;
  minAccess: number;
  halfLifeSeconds?: number;
};

const LUT_SIZE = 256;
const TWO_PI = Math.PI * 2;
const INV_TWO_PI = LUT_SIZE / TWO_PI;
const COS_LUT = Array.from({ length: LUT_SIZE }, (_, i) =>
  Math.cos((i / LUT_SIZE) * TWO_PI)
);
const SIN_LUT = Array.from({ length: LUT_SIZE }, (_, i) =>
  Math.sin((i / LUT_SIZE) * TWO_PI)
);

const AMP_MIN = 16;
const AMP_MAX = 255;
const AMP_INCREMENT = 32;
const AMP_DECAY = 0.1;

const SNAPSHOT_VERSION = "0.3.2";

type SnapshotMemory = {
  dimension: number;
  alpha: number;
  items: Record<string, number[]>;
  access?: Record<string, number>;
  amplitude?: Record<string, number>;
  metadata?: Record<string, SnapshotMetadataEntry>;
};

type SnapshotPayload = {
  version: string;
  savedAt: string;
  memories: SnapshotMemory[];
};

type SnapshotMetadataEntry = {
  createdAt: string;
  updatedAt: string;
  lastAccessAt: string;
};

const SESSION_MEMORY_GUIDE = {
  title: "LoNA長期記憶セッションガイド",
  version: "2.0",
  summary:
    "位相メモリによる長期記憶管理。チャット開始時のロード、階層的検索、振幅管理、選択的忘却を体系化。",
  quickstart: [
    "一、初回: session_memory_guide を呼び本ガイドを確認する",
    "二、既存記憶がある場合: load_memory_snapshot でスナップショットを復元",
    "三、新規の場合: 目次ベクトルを作成（例: [230,210,100,80]）",
    "四、各ターン: query → 処理 → write の順で記憶を更新",
    "五、終了時: save_memory_snapshot で永続化",
  ],
  concepts: {
    alpha: {
      説明: "記憶空間を分離する周波数パラメータ。異なるalphaは完全に独立した記憶バンク。",
      推奨値: "0.8 (デフォルト)",
      使い分け: "通常は0.8を使用。異なるプロジェクトや文脈を完全分離したい場合のみ変更。",
      例: "alpha=0.8は日常記憶、alpha=0.5は実験用、alpha=0.3は一時的作業メモ",
    },
    phaseShift: {
      説明:
        "記憶の位相をシフトさせる時間的タグ。同じベクトルでも異なる時点として記録可能。",
      推奨値: "0 (デフォルト) または明示的な時系列値",
      使い分け:
        "バージョン管理や時系列データに使用。0, 0.5, 1.0, 1.5...と段階的に増やす。",
      例: "2023年版はshift=0、2024年版はshift=0.5、2025年版はshift=1.0",
    },
    weight: {
      説明: "記憶の重要度。高いほど振幅が大きくなり検索で優先される。",
      推奨値: "1.0 (通常) ～ 2.0 (重要)",
      使い分け: "重要な記憶は1.5-2.0、通常は1.0、試験的な記憶は0.5",
      注意: "同じIDへの複数回書き込みで位相ブレンディングが発生",
    },
    vector: {
      説明: "記憶の内容を表す多次元ベクトル。通常は4次元、必要に応じて拡張可能。",
      生成方法: "カテゴリ基底を足し合わせて正規化。または経験的に調整。",
      注意事項: "原点ベクトル [0,0,0,0] は検索精度が落ちるため避ける",
    },
  },
  setup: [
    "一、環境変数 LONA_MEMORY_SNAPSHOT でスナップショット保存先を指定（任意）",
    "二、既存スナップショットがある場合: load_memory_snapshot で復元",
    "三、新規の場合: 目次ベクトルを作成",
    "　　例: write_memory({id: '目次ベクトル カテゴリガイド ルート', vector: [230,210,100,80], weight: 1.5, alpha: 0.8})",
    "四、memory_stats で初期状態を確認",
  ],
  loop: [
    "零、ターン開始時: 関連する目次ベクトルを query_memory_verbose で照会",
    "　　目的: 現在の話題に関連するジャンル基底を特定",
    "　　例: query_memory_verbose({vector: [230,210,100,80], topK: 5, alpha: 0.8})",
    "　　結果: 関連する記憶のIDとスコアのリストを取得",
    "",
    "一、必要に応じてジャンル基底を照会",
    "　　例: ゲーム関連なら [214,172,109,39]、音楽関連なら [173,203,153,82]",
    "　　注意: 非零ベクトルを使用（原点検索は精度が低い）",
    "",
    "二、処理実行後、結果を write_memory で記録",
    "　　要約を簡潔なIDにする（漢字・かな中心、音声出力を考慮）",
    "　　例: write_memory({id: '会話記録二千二十五年十月二十三日 ○○完了', vector: [適切な値], weight: 1.0以上, alpha: 0.8})",
    "　　重要度に応じてweightを調整（通常1.0、重要1.5-2.0）",
    "",
    "三、新しい章・プロジェクトの開始時",
    "　　目次ベクトルまたはジャンル基底に新項目を追記",
    "　　phaseShift を使って時系列バージョンを分離することも検討",
  ],
  maintenance: [
    "零、セッション終盤の整理ルーチン（推奨）",
    "　　1. query_memory_verbose で目次ベクトルを再確認",
    "　　2. 新章の付記漏れがないか点検、必要なら write_memory で追記",
    "　　3. memory_stats で件数・バイト数・振幅を確認",
    "　　4. forget_memory を実行（後述）",
    "　　5. save_memory_snapshot で永続化",
    "",
    "一、選択的忘却の実行（forget_memory）",
    "　　目的: 未参照の記憶を減衰させ、重要な記憶のみを保持",
    "　　パラメータ:",
    "　　　sigma: 位相ノイズの強さ（推奨0.05、強く忘れたい場合は0.1-0.2）",
    "　　　decay: 削除確率（推奨0.1、積極的に削除する場合は0.5-0.9）",
    "　　　halfLifeSeconds: 半減期（推奨3600秒=1時間、短期記憶なら300秒）",
    "　　　referenced: 保護する記憶のIDリスト（目次ベクトルは必ず含める）",
    "　　　minAccess: 最小アクセス回数（この回数未満は忘却対象）",
    "　　例: forget_memory({sigma: 0.05, decay: 0.1, halfLifeSeconds: 3600, referenced: ['目次ベクトル カテゴリガイド ルート', '重要な記憶ID']})",
    "",
    "二、スナップショット保存の定期実行",
    "　　タイミング: セッション終了時、重要な作業の完了後",
    "　　保存前に必ず memory_stats で状態確認",
    "　　例: save_memory_snapshot({path: '/path/to/snapshot.json'})",
  ],
  advanced: {
    "矛盾更新（neutralize）": {
      説明: "古い事実を削除せずに無効化し、新しい事実を書き込む非破壊的更新",
      手順: [
        "一、neutralize_memory で古い記憶にπ位相シフトを適用",
        "二、同じベクトルで新しい記憶を write_memory",
        "三、古い記憶は破壊的干渉により検索不能になる",
      ],
      例: "neutralize_memory({id: '事実記憶 旧バージョン', dimension: 4, alpha: 0.8})",
      効果: "Old residual rate = 0.000 を達成（論文G8で実証済み）",
    },
    位相ブレンディング: {
      説明: "同じIDに異なるベクトルを複数回書き込むことで記憶を合成",
      用途: "複数の観点を統合、段階的な学習",
      例: [
        "write_memory({id: 'ブレンド記憶', vector: [255,0,0,0], weight: 0.3})",
        "write_memory({id: 'ブレンド記憶', vector: [0,255,0,0], weight: 0.3})",
        "write_memory({id: 'ブレンド記憶', vector: [0,0,255,0], weight: 0.4})",
      ],
      結果: "3方向の位相が干渉し、中間的な記憶として検索可能",
    },
    多周波バンク: {
      説明: "異なるalpha値で並列にメモリバンクを運用",
      用途: "完全に独立したプロジェクト管理、エイリアシング対策",
      推奨構成: "alpha=0.8（メイン）、alpha=0.5（実験用）、alpha=0.3（一時作業）",
      注意: "alphaを跨いだ検索はできないため、明確な分離が必要な場合のみ使用",
    },
    時系列バージョニング: {
      説明: "phaseShift を時間軸として使用",
      用途: "同じ内容の異なる時点での記録",
      例: [
        "2023年版: phaseShift=0",
        "2024年版: phaseShift=0.5",
        "2025年版: phaseShift=1.0",
      ],
      検索: "対応するphaseShiftで query すると該当時点の記憶が優先される",
    },
  },
  troubleshooting: {
    "検索結果が出ない": [
      "原因1: 原点ベクトル [0,0,0,0] を使用している → 非零ベクトルに変更",
      "原因2: alphaが異なる → 記憶時と検索時のalphaを一致させる",
      "原因3: 記憶が存在しない → memory_stats で確認、必要なら再書き込み",
      "原因4: neutralize済み → π位相シフトで無効化されている可能性",
    ],
    "記憶が消えた": [
      "原因1: forget_memory で削除された → decay値が高すぎる、referenced に含めるべきだった",
      "原因2: 別のalphaに書き込んでいた → alpha値を確認",
      "原因3: スナップショットをロードし直した → 最新の save を忘れていた可能性",
    ],
    "検索精度が低い": [
      "対策1: 目次→ジャンル→詳細の階層検索を使用",
      "対策2: weightを適切に設定（重要な記憶は1.5-2.0）",
      "対策3: 類似した記憶が多い場合は phaseShift で分離",
      "対策4: topKを増やして候補を広げる",
    ],
    "メモリ使用量が多い": [
      "対策1: forget_memory を定期実行",
      "対策2: 不要な記憶を delete_memory で削除",
      "対策3: 次元数を最小限に（4-8次元で十分な場合が多い）",
    ],
  },
  tips: [
    "IDは漢字・かな中心にすると音声出力時に自然（例: '会話記録二千二十五年十月二十三日'）",
    "目次ベクトルを基点にジャンル基底へ降り、検索と更新を階層化すると精度向上",
    "ベクトルは話題カテゴリごとの基底を用意し、複数属性は足し合わせて使用",
    "半減期で削除予定の項目は事前に要約へ統合し、重要語はweightを上げて振幅を維持",
    "実験的な記憶は別alpha（0.5など）に書き込むと本番環境を汚染しない",
    "neutralize は削除より安全（いつでも新規書き込みで復活可能）",
    "定期的に memory_stats でメモリ使用状況を監視",
    "振幅は自動管理されるため、アクセス頻度が高い記憶ほど強くなる（Hebbian learning）",
  ],
  examples: {
    基本的な使い方: {
      step1_load: "load_memory_snapshot({path: '/path/to/snapshot.json'})",
      step2_query: "query_memory_verbose({vector: [230,210,100,80], topK: 5, alpha: 0.8})",
      step3_write: "write_memory({id: '会話記録 ○○完了', vector: [200,150,100,50], weight: 1.2, alpha: 0.8})",
      step4_save: "save_memory_snapshot({path: '/path/to/snapshot.json'})",
    },
    矛盾更新: {
      step1_neutralize: "neutralize_memory({id: '古い事実', dimension: 4, alpha: 0.8})",
      step2_write: "write_memory({id: '新しい事実', vector: [同じベクトル], weight: 2.0, alpha: 0.8})",
      step3_verify: "query_memory({vector: [同じベクトル], topK: 3, alpha: 0.8}) // 新しい事実のみ返る",
    },
    階層検索: {
      step1_index: "query_memory({vector: [230,210,100,80], topK: 5, alpha: 0.8}) // 目次ベクトル照会",
      step2_genre: "query_memory({vector: [214,172,109,39], topK: 5, alpha: 0.8}) // ゲームジャンル照会",
      step3_detail: "query_memory({vector: [126,231,201,106], topK: 3, alpha: 0.8}) // 具体的な記憶",
    },
  },
  performance: {
    メモリ効率: "8bit/次元 = 4次元で4バイト、128次元で128バイト（従来比1/4）",
    検索速度: "LUT使用により高速（ただしon-the-flyエンコードで約2.5×のオーバーヘッド）",
    精度: "8bit量子化でもコサイン類似度と同等（誤差≤0.0245、マージン>0.025で順位保存）",
    スケーラビリティ: "4次元～128次元まで実証済み、数百～数千項目で実用的",
  },
  references: {
    理論: "LoNA Theory — Unified Rotational Memory Framework (G1-G8)",
    論文セクション: "Section 6: PhaseAngleMemory",
    実装: "mcp-servers/lona-memory (TypeScript, 1171 lines)",
    ベンチマーク: "G8実験結果: Recall@1=1.0, F1=1.0, メモリ50KiB vs 200KiB",
  },
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function toCode(theta: number): number {
  const wrapped = ((theta % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round(wrapped * INV_TWO_PI) & 0xff;
}

function ensureFiniteArray(name: string, arr: number[]): void {
  for (let i = 0; i < arr.length; i++) {
    const value = Number(arr[i]);
    if (!Number.isFinite(value)) {
      throw new Error(`${name}[${i}] must be a finite number`);
    }
  }
}

function ensureUint8ishArray(name: string, arr: number[]): void {
  for (let i = 0; i < arr.length; i++) {
    const value = Number(arr[i]);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${name}[${i}] must be an integer between 0 and 255`);
    }
    if (value < 0 || value > 255) {
      throw new Error(`${name}[${i}] must be in the range [0, 255]`);
    }
  }
}

let RAND: () => number = Math.random;

export function setRandomGenerator(generator: () => number): void {
  RAND = generator;
}

function sampleVonMises(sigma: number): number {
  if (!(sigma > 0)) {
    return 0;
  }
  const variance = sigma * sigma;
  const kappa = variance <= 1e-6 ? 1e6 : Math.max(1e-6, 1 / variance);
  if (kappa <= 1e-6) {
    return (RAND() - 0.5) * TWO_PI;
  }
  const a = 1 + Math.sqrt(1 + 4 * kappa * kappa);
  const b = (a - Math.sqrt(2 * a)) / (2 * kappa);
  const r = (1 + b * b) / (2 * b);
  while (true) {
    const u1 = RAND();
    const z = Math.cos(Math.PI * u1);
    const f = (1 + r * z) / (r + z);
    const c = kappa * (r - f);
    const u2 = RAND();
    if (u2 < c * (2 - c) || u2 <= Math.exp(1 - c)) {
      const theta = Math.acos(Math.max(-1, Math.min(1, f)));
      return (RAND() > 0.5 ? 1 : -1) * theta;
    }
  }
}

function buildMixSchedule(weight: number): number[] {
  const parsed = Number.isFinite(weight) ? Number(weight) : 0;
  if (!(parsed > 0)) {
    return [];
  }
  const whole = Math.floor(parsed);
  const frac = parsed - whole;
  const schedule: number[] = [];
  for (let i = 0; i < whole; i++) {
    schedule.push(1);
  }
  const tail = whole === 0 ? parsed : frac;
  const clampedTail = clamp01(tail);
  if (clampedTail > 0) {
    schedule.push(clampedTail);
  }
  return schedule;
}

function nowMillis(): number {
  return Date.now();
}

class MinHeap {
  private items: Array<{ id: string; score: number }> = [];

  constructor(private readonly k: number) {}

  push(entry: { id: string; score: number }): void {
    if (this.k <= 0) return;
    if (this.items.length < this.k) {
      this.items.push(entry);
      this.heapifyUp(this.items.length - 1);
      return;
    }
    if (entry.score > this.items[0].score) {
      this.items[0] = entry;
      this.heapifyDown(0);
    }
  }

  private heapifyUp(index: number): void {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.items[parent].score <= this.items[index].score) break;
      [this.items[parent], this.items[index]] = [this.items[index], this.items[parent]];
      index = parent;
    }
  }

  private heapifyDown(index: number): void {
    const length = this.items.length;
    while (true) {
      let smallest = index;
      const left = index * 2 + 1;
      const right = left + 1;
      if (left < length && this.items[left].score < this.items[smallest].score) {
        smallest = left;
      }
      if (right < length && this.items[right].score < this.items[smallest].score) {
        smallest = right;
      }
      if (smallest === index) break;
      [this.items[smallest], this.items[index]] = [this.items[index], this.items[smallest]];
      index = smallest;
    }
  }

  toSortedDesc(): Array<{ id: string; score: number }> {
    return [...this.items].sort((a, b) => {
      if (b.score === a.score) {
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      }
      return b.score - a.score;
    });
  }
}

class PhaseAngleMemory {
  private readonly dimension: number;
  private readonly alpha: number;
  private readonly items = new Map<string, Uint8Array>();
  private readonly access = new Map<string, number>();
  private readonly amplitudes = new Map<string, number>();
  private readonly metadata = new Map<string, { createdAt: number; updatedAt: number; lastAccessAt: number }>();

  constructor(dimension: number, alpha: number) {
    this.dimension = dimension;
    this.alpha = alpha;
  }

  getDimension(): number {
    return this.dimension;
  }

  getAlpha(): number {
    return this.alpha;
  }

  private encodePhaseCodes(vector: number[], phaseShift = 0): Uint8Array {
    if (vector.length !== this.dimension) {
      throw new Error(
        `vector dimension mismatch: expected ${this.dimension}, received ${vector.length}`
      );
    }
    const shiftCode = phaseShift !== 0 ? toCode(phaseShift) : 0;
    const codes = new Uint8Array(this.dimension);
    for (let i = 0; i < vector.length; i++) {
      const theta = this.alpha * vector[i];
      const base = toCode(theta);
      codes[i] = (base + shiftCode) & 0xff;
    }
    return codes;
  }

  write(id: string, vector: number[], weight = 1, phaseShift = 0): void {
    const weightValue = Number.isFinite(weight) ? Number(weight) : 0;
    const schedule = buildMixSchedule(weightValue);
    if (schedule.length === 0) {
      return;
    }
    const newCodes = this.encodePhaseCodes(vector, phaseShift);
    const existed = this.items.has(id);
    this.applyWriteSchedule(id, newCodes, schedule);
    this.updateAmplitude(id, weightValue, existed);
    this.access.set(id, 0);
    this.updateMetadataOnWrite(id, existed);
  }

  writeCodes(id: string, codesInput: number[], weight = 1): void {
    if (codesInput.length !== this.dimension) {
      throw new Error(
        `code dimension mismatch: expected ${this.dimension}, received ${codesInput.length}`
      );
    }
    const weightValue = Number.isFinite(weight) ? Number(weight) : 0;
    const schedule = buildMixSchedule(weightValue);
    if (schedule.length === 0) {
      return;
    }
    const codes = Uint8Array.from(codesInput, (value) => Number(value) & 0xff);
    const existed = this.items.has(id);
    this.applyWriteSchedule(id, codes, schedule);
    this.updateAmplitude(id, weightValue, existed);
    this.access.set(id, 0);
    this.updateMetadataOnWrite(id, existed);
  }

  private applyWriteSchedule(
    id: string,
    source: Uint8Array,
    schedule: number[],
  ): void {
    if (schedule.length === 0) {
      return;
    }
    for (const rawMix of schedule) {
      if (!this.items.has(id)) {
        this.items.set(id, new Uint8Array(source));
        continue;
      }
      const mix = clamp01(rawMix);
      if (mix <= 0) {
        continue;
      }
      if (mix >= 1) {
        this.items.set(id, new Uint8Array(source));
        continue;
      }
      const prev = this.items.get(id);
      if (!prev) {
        this.items.set(id, new Uint8Array(source));
        continue;
      }
      const blended = this.blendCodes(prev, source, mix);
      this.items.set(id, blended);
    }
    if (!this.items.has(id)) {
      this.items.set(id, new Uint8Array(source));
    }
  }

  private blendCodes(prev: Uint8Array, next: Uint8Array, mix: number): Uint8Array {
    const clamped = clamp01(mix);
    if (clamped <= 0) {
      return new Uint8Array(prev);
    }
    if (clamped >= 1) {
      return new Uint8Array(next);
    }
    const blended = new Uint8Array(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      const prevCode = prev[i];
      const nextCode = next[i];
      const prevRe = COS_LUT[prevCode];
      const prevIm = SIN_LUT[prevCode];
      const nextRe = COS_LUT[nextCode];
      const nextIm = SIN_LUT[nextCode];
      const mixRe = prevRe * (1 - clamped) + nextRe * clamped;
      const mixIm = prevIm * (1 - clamped) + nextIm * clamped;
      blended[i] = toCode(Math.atan2(mixIm, mixRe));
    }
    return blended;
  }

  private updateAmplitude(id: string, weight: number, _existed: boolean): void {
    const positive = Math.max(0, Number.isFinite(weight) ? weight : 0);
    const previous = this.amplitudes.get(id);
    const base = previous !== undefined ? Math.max(previous, AMP_MIN) : AMP_MIN;
    const rawIncrement = Math.ceil(positive * AMP_INCREMENT);
    const increment = rawIncrement > 0 ? rawIncrement : (previous === undefined ? AMP_INCREMENT : 1);
    const next = Math.min(AMP_MAX, base + increment);
    this.amplitudes.set(id, next);
  }

  private updateMetadataOnWrite(id: string, _existed: boolean): void {
    const now = nowMillis();
    const meta = this.metadata.get(id);
    if (meta) {
      meta.updatedAt = now;
      meta.lastAccessAt = now;
    } else {
      this.metadata.set(id, { createdAt: now, updatedAt: now, lastAccessAt: now });
    }
  }

  read(vector: number[], topK = 1, phaseShift = 0): string[] {
    const qCodes = this.encodePhaseCodes(vector, phaseShift);
    const qPairs = Array.from(qCodes, (code) => [COS_LUT[code], SIN_LUT[code]] as [number, number]);
    return this.rankFromPairs(qPairs, topK) as string[];
  }

  readCodes(codesInput: number[], topK = 1): string[] {
    if (codesInput.length !== this.dimension) {
      throw new Error(
        `code dimension mismatch: expected ${this.dimension}, received ${codesInput.length}`
      );
    }
    const qPairs = Array.from(codesInput, (code) => {
      const idx = Number(code) & 0xff;
      return [COS_LUT[idx], SIN_LUT[idx]] as [number, number];
    });
    return this.rankFromPairs(qPairs, topK) as string[];
  }

  readVerbose(vector: number[], topK = 1, phaseShift = 0): Array<{ id: string; score: number }> {
    const qCodes = this.encodePhaseCodes(vector, phaseShift);
    const qPairs = Array.from(qCodes, (code) => [COS_LUT[code], SIN_LUT[code]] as [number, number]);
    return this.rankFromPairs(qPairs, topK, true) as Array<{ id: string; score: number }>;
  }

  private rankFromPairs(
    qPairs: Array<[number, number]>,
    topK: number,
    withScores = false,
  ): string[] | Array<{ id: string; score: number }> {
    const k = Math.max(1, Math.floor(topK));
    const heap = new MinHeap(k);

    for (const [id, codes] of this.items.entries()) {
      let score = 0;
      for (let i = 0; i < this.dimension; i++) {
        const [qRe, qIm] = qPairs[i];
        const code = codes[i];
        score += qRe * COS_LUT[code] + qIm * SIN_LUT[code];
      }
      score /= this.dimension;
      const amplitude = this.amplitudes.get(id) ?? AMP_MIN;
      const ampScale = Math.max(AMP_MIN, amplitude) / AMP_MAX;
      heap.push({ id, score: score * ampScale });
    }

    const ordered = heap.toSortedDesc();
    const now = nowMillis();
    for (const entry of ordered) {
      this.access.set(entry.id, (this.access.get(entry.id) ?? 0) + 1);
      this.touchLastAccess(entry.id, now);
    }
    if (withScores) {
      return ordered;
    }
    return ordered.map((entry) => entry.id);
  }

  private touchLastAccess(id: string, timestamp: number): void {
    const meta = this.metadata.get(id);
    if (meta) {
      meta.lastAccessAt = timestamp;
    } else {
      this.metadata.set(id, { createdAt: timestamp, updatedAt: timestamp, lastAccessAt: timestamp });
    }
  }

  private touchUpdatedAt(id: string, timestamp: number): void {
    const meta = this.metadata.get(id);
    if (meta) {
      meta.updatedAt = timestamp;
    } else {
      this.metadata.set(id, { createdAt: timestamp, updatedAt: timestamp, lastAccessAt: timestamp });
    }
  }

  private degradeAmplitude(id: string, decay: number): void {
    const current = this.amplitudes.get(id);
    if (current === undefined) {
      return;
    }
    const clamped = clamp01(decay);
    const factor = Math.max(0, 1 - AMP_DECAY * (1 + clamped));
    const next = Math.max(AMP_MIN, Math.round(current * factor));
    this.amplitudes.set(id, next);
  }

  forget({ sigma, decay, referenced, minAccess, halfLifeSeconds }: ForgetOptions): number {
    const refSet = referenced ? new Set(referenced) : new Set<string>();
    const decayClamped = clamp01(decay);
    const halfLife = halfLifeSeconds && halfLifeSeconds > 0 ? halfLifeSeconds : 0;
    const now = nowMillis();
    let removed = 0;
    for (const [id, codes] of Array.from(this.items.entries())) {
      if (refSet.has(id)) {
        continue;
      }
      const accessCount = this.access.get(id) ?? 0;
      const meta = this.metadata.get(id);
      let removalChance = 0;
      if (decayClamped > 0 && accessCount <= minAccess) {
        removalChance = 1 - (1 - removalChance) * (1 - decayClamped);
      }
      if (halfLife > 0 && meta) {
        const last = meta.lastAccessAt ?? meta.updatedAt ?? meta.createdAt;
        const ageSeconds = Math.max(0, (now - last) / 1000);
        if (ageSeconds > 0) {
          const halfProb = 1 - Math.pow(0.5, ageSeconds / halfLife);
          removalChance = 1 - (1 - removalChance) * (1 - clamp01(halfProb));
        }
      }
      if (removalChance > 0 && RAND() < removalChance) {
        this.items.delete(id);
        this.access.delete(id);
        this.amplitudes.delete(id);
        this.metadata.delete(id);
        removed += 1;
        continue;
      }
      if (sigma > 0) {
        const updated = new Uint8Array(codes.length);
        for (let i = 0; i < codes.length; i++) {
          const shift = sampleVonMises(sigma);
          const shiftCodes = shift * INV_TWO_PI;
          let delta = Math.trunc(shiftCodes);
          const frac = shiftCodes - delta;
          const prob = Math.abs(frac);
          if (prob > 0 && RAND() < prob) {
            delta += frac > 0 ? 1 : -1;
          }
          updated[i] = (codes[i] + delta) & 0xff;
        }
        this.items.set(id, updated);
      }
      this.degradeAmplitude(id, decayClamped);
      this.touchUpdatedAt(id, now);
    }
    return removed;
  }

  delete(id: string): boolean {
    const existed = this.items.delete(id);
    this.access.delete(id);
    this.amplitudes.delete(id);
    this.metadata.delete(id);
    return existed;
  }

  list(limit: number): string[] {
    return Array.from(this.items.keys()).slice(0, limit);
  }

  stats() {
    return {
      dimension: this.dimension,
      alpha: this.alpha,
      itemCount: this.items.size,
      memoryBytes: this.memoryBytes(),
    };
  }

  memoryBytes(): number {
    return this.items.size * (this.dimension + 1);
  }

  private setRaw(
    id: string,
    codes: number[],
    accessCount: number,
    amplitude?: number,
    metadata?: SnapshotMetadataEntry | null,
  ): void {
    if (codes.length !== this.dimension) {
      throw new Error(
        `code dimension mismatch: expected ${this.dimension}, received ${codes.length}`
      );
    }
    const array = Uint8Array.from(codes, (value) => Number(value) & 0xff);
    this.items.set(id, array);
    this.access.set(id, Math.max(0, Math.floor(accessCount)));

    const amp = Number.isFinite(amplitude ?? NaN)
      ? Math.max(AMP_MIN, Math.min(AMP_MAX, Math.round(amplitude!)))
      : AMP_MIN;
    this.amplitudes.set(id, amp);

    const fallback = nowMillis();
    const parseTime = (value?: string): number => {
      if (!value) return fallback;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? parsed : fallback;
    };
    if (metadata) {
      this.metadata.set(id, {
        createdAt: parseTime(metadata.createdAt),
        updatedAt: parseTime(metadata.updatedAt),
        lastAccessAt: parseTime(metadata.lastAccessAt),
      });
    } else {
      this.metadata.set(id, {
        createdAt: fallback,
        updatedAt: fallback,
        lastAccessAt: fallback,
      });
    }
  }

  neutralize(id: string): boolean {
    const codes = this.items.get(id);
    if (!codes) return false;
    for (let i = 0; i < codes.length; i++) {
      codes[i] = (codes[i] + 128) & 0xff;
    }
    this.items.set(id, codes);
    this.touchUpdatedAt(id, nowMillis());
    return true;
  }

  toSnapshot(): SnapshotMemory {
    const items: Record<string, number[]> = {};
    const access: Record<string, number> = {};
    const amplitude: Record<string, number> = {};
    const metadata: Record<string, SnapshotMetadataEntry> = {};
    for (const [id, codes] of this.items.entries()) {
      items[id] = Array.from(codes);
      access[id] = this.access.get(id) ?? 0;
      const amp = this.amplitudes.get(id);
      if (amp !== undefined) {
        amplitude[id] = Math.round(Math.max(AMP_MIN, Math.min(AMP_MAX, amp)));
      }
      const meta = this.metadata.get(id);
      if (meta) {
        metadata[id] = {
          createdAt: new Date(meta.createdAt).toISOString(),
          updatedAt: new Date(meta.updatedAt).toISOString(),
          lastAccessAt: new Date(meta.lastAccessAt).toISOString(),
        };
      }
    }
    const snapshot: SnapshotMemory = {
      dimension: this.dimension,
      alpha: this.alpha,
      items,
      access,
    };
    if (Object.keys(amplitude).length > 0) {
      snapshot.amplitude = amplitude;
    }
    if (Object.keys(metadata).length > 0) {
      snapshot.metadata = metadata;
    }
    return snapshot;
  }

  static fromSnapshot(entry: SnapshotMemory): PhaseAngleMemory {
    const memory = new PhaseAngleMemory(entry.dimension, entry.alpha);
    for (const [id, codes] of Object.entries(entry.items)) {
      const accessCount = entry.access?.[id] ?? 0;
      const amp = entry.amplitude?.[id];
      const meta = entry.metadata?.[id] ?? null;
      memory.setRaw(id, codes, accessCount, amp, meta);
    }
    return memory;
  }

}

const server = new Server(
  {
    name: "mcp-lona-memory",
    version: "0.3.2",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

const memories = new Map<string, PhaseAngleMemory>();

function alphaKey(dim: number, alpha: number, precision = 6): string {
  return `${dim}|${alpha.toFixed(precision)}`;
}

function ensureMemory(dim: number, alpha: number): PhaseAngleMemory {
  const key = alphaKey(dim, alpha);
  let memory = memories.get(key);
  if (!memory) {
    memory = new PhaseAngleMemory(dim, alpha);
    memories.set(key, memory);
  } else if (memory.getDimension() !== dim) {
    throw new Error(`alpha=${alpha} expects dimension ${memory.getDimension()}, got ${dim}`);
  }
  return memory;
}

function getMemoryForVector(vector: number[], alpha: number): PhaseAngleMemory {
  return ensureMemory(vector.length, alpha);
}

function getMemoryForCodes(codes: number[], alpha: number): PhaseAngleMemory {
  return ensureMemory(codes.length, alpha);
}

function getMemoriesForAlpha(alpha: number): Array<{ key: string; memory: PhaseAngleMemory }> {
  const suffix = `|${alpha.toFixed(6)}`;
  const result: Array<{ key: string; memory: PhaseAngleMemory }> = [];
  for (const [key, memory] of memories.entries()) {
    if (key.endsWith(suffix)) result.push({ key, memory });
  }
  return result;
}

function clearMemoriesForAlpha(alpha: number): void {
  for (const { key } of getMemoriesForAlpha(alpha)) {
    memories.delete(key);
  }
}

function clearAllMemories(): void {
  memories.clear();
}

function exportSnapshot(): SnapshotPayload {
  const payload: SnapshotPayload = {
    version: SNAPSHOT_VERSION,
    savedAt: new Date().toISOString(),
    memories: Array.from(memories.values()).map((memory) => memory.toSnapshot()),
  };
  return payload;
}

async function saveSnapshotToFile(
  filePath: string
): Promise<{ memories: number; items: number }> {
  const snapshot = exportSnapshot();
  const memoryCount = snapshot.memories.length;
  const itemCount = snapshot.memories.reduce(
    (total, entry) => total + Object.keys(entry.items).length,
    0
  );
  const directory = path.dirname(filePath);
  if (directory && directory !== ".") {
    await fs.mkdir(directory, { recursive: true });
  }
  await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
  return { memories: memoryCount, items: itemCount };
}

async function loadSnapshotFromFile(
  filePath: string,
  options: { clearExisting: boolean }
): Promise<{ memories: number; items: number }> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as SnapshotPayload;
  if (!parsed || !Array.isArray(parsed.memories)) {
    throw new Error("invalid snapshot format");
  }
  if (options.clearExisting) {
    clearAllMemories();
  }
  let memoryCount = 0;
  let itemCount = 0;
  for (const entry of parsed.memories) {
    const key = alphaKey(entry.dimension, entry.alpha);
    const memory = PhaseAngleMemory.fromSnapshot(entry);
    memories.set(key, memory);
    memoryCount += 1;
    itemCount += Object.keys(entry.items).length;
  }
  return { memories: memoryCount, items: itemCount };
}

function getArgValue(flag: string): string | null {
  const index = process.argv.indexOf(flag);
  if (index >= 0 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return null;
}

async function tryAutoLoadSnapshot(): Promise<void> {
  const snapshotPath =
    process.env.LONA_MEMORY_SNAPSHOT ?? getArgValue("--snapshot");
  if (!snapshotPath) return;
  try {
    const result = await loadSnapshotFromFile(snapshotPath, {
      clearExisting: true,
    });
    console.error(
      `Loaded snapshot: ${result.memories} memories / ${result.items} items from ${snapshotPath}`
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : JSON.stringify(error);
    console.error(
      `Failed to load snapshot from ${snapshotPath}: ${message}`
    );
  }
}

function jsonResponse(obj: unknown): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(obj),
      },
    ],
  };
}

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "write_memory",
        description: "Store or blend a vector into the LoNA phase memory.",
        inputSchema: {
          type: "object",
          required: ["id", "vector"],
          properties: {
            id: { type: "string" },
            vector: { type: "array", items: { type: "number" } },
            weight: { type: "number", default: 1 },
            phaseShift: { type: "number", default: 0 },
            alpha: { type: "number", default: 0.8 },
          },
        },
      },
      {
        name: "write_memory_codes",
        description: "Store pre-encoded phase codes (8-bit per dimension).",
        inputSchema: {
          type: "object",
          required: ["id", "codes"],
          properties: {
            id: { type: "string" },
            codes: { type: "array", items: { type: "integer" } },
            weight: { type: "number", default: 1 },
            alpha: { type: "number", default: 0.8 },
          },
        },
      },
      {
        name: "query_memory",
        description: "Return the top matching identifiers for a query vector.",
        inputSchema: {
          type: "object",
          required: ["vector"],
          properties: {
            vector: { type: "array", items: { type: "number" } },
            topK: { type: "integer", default: 1 },
            phaseShift: { type: "number", default: 0 },
            alpha: { type: "number", default: 0.8 },
          },
        },
      },
      {
        name: "query_memory_verbose",
        description: "Return topK identifiers and similarity scores for a query vector.",
        inputSchema: {
          type: "object",
          required: ["vector"],
          properties: {
            vector: { type: "array", items: { type: "number" } },
            topK: { type: "integer", default: 1 },
            phaseShift: { type: "number", default: 0 },
            alpha: { type: "number", default: 0.8 },
          },
        },
      },
      {
        name: "query_memory_codes",
        description: "Return the top matching identifiers for pre-encoded phase codes.",
        inputSchema: {
          type: "object",
          required: ["codes"],
          properties: {
            codes: { type: "array", items: { type: "integer" } },
            topK: { type: "integer", default: 1 },
            alpha: { type: "number", default: 0.8 },
          },
        },
      },
      {
        name: "forget_memory",
        description: "Apply mean-zero dephasing/decay to unreferenced memories.",
        inputSchema: {
          type: "object",
          properties: {
            sigma: { type: "number", default: 0.05 },
            decay: { type: "number", default: 0 },
            referenced: { type: "array", items: { type: "string" } },
            minAccess: { type: "integer", default: 0 },
            halfLifeSeconds: { type: "number", default: 0 },
            alpha: { type: "number", default: 0.8 },
          },
        },
      },
      {
        name: "neutralize_memory",
        description: "Apply a π phase shift to an existing identifier (non-destructive neutralisation).",
        inputSchema: {
          type: "object",
          required: ["id", "dimension"],
          properties: {
            id: { type: "string" },
            dimension: { type: "integer" },
            alpha: { type: "number", default: 0.8 },
          },
        },
      },
      {
        name: "memory_stats",
        description: "Return statistics about the memory for a given alpha.",
        inputSchema: {
          type: "object",
          properties: { alpha: { type: "number", default: 0.8 } },
        },
      },
      {
        name: "clear_memory",
        description: "Remove all entries for a given alpha.",
        inputSchema: {
          type: "object",
          properties: { alpha: { type: "number", default: 0.8 } },
        },
      },
      {
        name: "save_memory_snapshot",
        description: "Persist all memories to a JSON snapshot file.",
        inputSchema: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string" },
          },
        },
      },
      {
        name: "load_memory_snapshot",
        description: "Load memories from a JSON snapshot file.",
        inputSchema: {
          type: "object",
          required: ["path"],
          properties: {
            path: { type: "string" },
            clear: { type: "boolean", default: true },
          },
        },
      },
      {
        name: "delete_memory",
        description: "Delete a single identifier from the memory.",
        inputSchema: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string" },
            alpha: { type: "number", default: 0.8 },
          },
        },
      },
      {
        name: "list_memory",
        description: "List stored identifiers (limited).",
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer", default: 100 },
            alpha: { type: "number", default: 0.8 },
            dimension: { type: "integer" },
          },
        },
      },
      {
        name: "session_memory_guide",
        description: "LoNA長期記憶セッション運用の推奨手順を返す。",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  switch (name) {
    case "write_memory": {
      const id = String(args?.id ?? "");
      const vector = (args?.vector as number[]) ?? [];
      if (!id) throw new Error("id is required");
      if (!Array.isArray(vector) || vector.length === 0)
        throw new Error("vector must be a non-empty array of numbers");
      ensureFiniteArray("vector", vector);
      const alpha = typeof args?.alpha === "number" ? args.alpha : 0.8;
      const instance = getMemoryForVector(vector.map(Number), alpha);
      const weight = typeof args?.weight === "number" ? args.weight : 1;
      const phaseShift = typeof args?.phaseShift === "number" ? args.phaseShift : 0;
      instance.write(id, vector.map(Number), weight, phaseShift);
      return jsonResponse({ stored: id, alpha });
    }
    case "write_memory_codes": {
      const id = String(args?.id ?? "");
      const codes = (args?.codes as number[]) ?? [];
      if (!id) throw new Error("id is required");
      if (!Array.isArray(codes) || codes.length === 0)
        throw new Error("codes must be a non-empty array of integers");
      ensureUint8ishArray("codes", codes);
      const alpha = typeof args?.alpha === "number" ? args.alpha : 0.8;
      const instance = getMemoryForCodes(codes, alpha);
      const weight = typeof args?.weight === "number" ? args.weight : 1;
      instance.writeCodes(id, codes, weight);
      return jsonResponse({ stored: id, alpha });
    }
    case "query_memory": {
      const vector = (args?.vector as number[]) ?? [];
      if (!Array.isArray(vector) || vector.length === 0)
        throw new Error("vector must be a non-empty array of numbers");
      ensureFiniteArray("vector", vector);
      const alpha = typeof args?.alpha === "number" ? args.alpha : 0.8;
      const instance = getMemoryForVector(vector.map(Number), alpha);
      const topK = typeof args?.topK === "number" ? Math.max(1, Math.floor(args.topK)) : 1;
      const phaseShift = typeof args?.phaseShift === "number" ? args.phaseShift : 0;
      const matches = instance.read(vector.map(Number), topK, phaseShift);
      return jsonResponse({ matches });
    }
    case "query_memory_verbose": {
      const vector = (args?.vector as number[]) ?? [];
      if (!Array.isArray(vector) || vector.length === 0)
        throw new Error("vector must be a non-empty array of numbers");
      ensureFiniteArray("vector", vector);
      const alpha = typeof args?.alpha === "number" ? args.alpha : 0.8;
      const instance = getMemoryForVector(vector.map(Number), alpha);
      const topK = typeof args?.topK === "number" ? Math.max(1, Math.floor(args.topK)) : 1;
      const phaseShift = typeof args?.phaseShift === "number" ? args.phaseShift : 0;
      const verbose = instance.readVerbose(vector.map(Number), topK, phaseShift);
      const dim = instance.getDimension();
      return jsonResponse({
        matches: verbose.map((entry) => entry.id),
        scores: verbose.map((entry) => entry.score),
        scoresSum: verbose.map((entry) => entry.score * dim),
        dimension: dim,
        alpha,
      });
    }
    case "query_memory_codes": {
      const codes = (args?.codes as number[]) ?? [];
      if (!Array.isArray(codes) || codes.length === 0)
        throw new Error("codes must be a non-empty array of integers");
      ensureUint8ishArray("codes", codes);
      const alpha = typeof args?.alpha === "number" ? args.alpha : 0.8;
      const instance = getMemoryForCodes(codes, alpha);
      const topK = typeof args?.topK === "number" ? Math.max(1, Math.floor(args.topK)) : 1;
      const matches = instance.readCodes(codes, topK);
      return jsonResponse({ matches });
    }
    case "forget_memory": {
      const alpha = typeof args?.alpha === "number" ? args.alpha : 0.8;
      const memoriesForAlpha = getMemoriesForAlpha(alpha);
      if (memoriesForAlpha.length === 0) return jsonResponse({ removed: 0, alpha });
      const sigma = typeof args?.sigma === "number" ? args.sigma : 0.05;
      const decay = typeof args?.decay === "number" ? args.decay : 0;
      const referenced = Array.isArray(args?.referenced)
        ? (args.referenced as string[])
        : null;
      const minAccess = typeof args?.minAccess === "number" ? Math.max(0, Math.floor(args.minAccess)) : 0;
      const halfLifeSeconds =
        typeof args?.halfLifeSeconds === "number" ? Math.max(0, Number(args.halfLifeSeconds)) : undefined;
      let removed = 0;
      for (const { memory } of memoriesForAlpha) {
        removed += memory.forget({ sigma, decay, referenced, minAccess, halfLifeSeconds });
      }
      return jsonResponse({ removed, alpha });
    }
    case "neutralize_memory": {
      const id = String(args?.id ?? "");
      const dimension =
        typeof args?.dimension === "number" ? Math.floor(args.dimension) : NaN;
      if (!id) throw new Error("id is required");
      if (!Number.isFinite(dimension) || dimension <= 0)
        throw new Error("dimension is required");
      const alpha = typeof args?.alpha === "number" ? args.alpha : 0.8;
      const key = alphaKey(dimension, alpha);
      const instance = memories.get(key);
      if (!instance)
        return jsonResponse({
          neutralized: false,
          reason: "no memory",
          alpha,
          id,
          dimension,
        });
      const ok = instance.neutralize(id);
      return jsonResponse({ neutralized: ok, alpha, id, dimension });
    }
    case "memory_stats": {
      const alpha = typeof args?.alpha === "number" ? args.alpha : 0.8;
      const memoriesForAlpha = getMemoriesForAlpha(alpha);
      if (memoriesForAlpha.length === 0) return jsonResponse({});
      return jsonResponse(
        memoriesForAlpha.map(({ memory }) => ({
          ...memory.stats(),
        }))
      );
    }
    case "clear_memory": {
      const alpha = typeof args?.alpha === "number" ? args.alpha : 0.8;
      const existing = getMemoriesForAlpha(alpha);
      clearMemoriesForAlpha(alpha);
      return jsonResponse({ cleared: existing.length > 0, removed: existing.length, alpha });
    }
    case "save_memory_snapshot": {
      const filePath = String(args?.path ?? "");
      if (!filePath) throw new Error("path is required");
      const result = await saveSnapshotToFile(filePath);
      return jsonResponse({
        saved: true,
        file: filePath,
        memories: result.memories,
        items: result.items,
        version: SNAPSHOT_VERSION,
      });
    }
    case "load_memory_snapshot": {
      const filePath = String(args?.path ?? "");
      if (!filePath) throw new Error("path is required");
      const clear =
        typeof args?.clear === "boolean" ? Boolean(args.clear) : true;
      const result = await loadSnapshotFromFile(filePath, {
        clearExisting: clear,
      });
      return jsonResponse({
        loaded: true,
        file: filePath,
        memories: result.memories,
        items: result.items,
        version: SNAPSHOT_VERSION,
        cleared: clear,
      });
    }
    case "delete_memory": {
      const id = String(args?.id ?? "");
      if (!id) throw new Error("id is required");
      const alpha = typeof args?.alpha === "number" ? args.alpha : 0.8;
      const memoriesForAlpha = getMemoriesForAlpha(alpha);
      if (memoriesForAlpha.length === 0) return jsonResponse({ deleted: false, alpha, id });
      let deleted = false;
      for (const { memory } of memoriesForAlpha) {
        deleted = memory.delete(id) || deleted;
      }
      return jsonResponse({ deleted, alpha, id });
    }
    case "list_memory": {
      const alpha = typeof args?.alpha === "number" ? args.alpha : 0.8;
      const memoriesForAlpha = getMemoriesForAlpha(alpha);
      if (memoriesForAlpha.length === 0) return jsonResponse({ alpha, dimension: null, ids: [] });
      const limit = typeof args?.limit === "number" ? Math.max(1, Math.floor(args.limit)) : 100;
      const dimFilterRaw = args?.dimension;
      let dimFilter: number | null = null;
      if (dimFilterRaw !== undefined) {
        const parsed = Math.floor(Number(dimFilterRaw));
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error("dimension must be a positive integer");
        }
        dimFilter = parsed;
      }
      const listed = new Set<string>();
      for (const { memory } of memoriesForAlpha) {
        if (dimFilter !== null && memory.getDimension() !== dimFilter) continue;
        for (const id of memory.list(limit)) {
          listed.add(id);
          if (listed.size >= limit) break;
        }
        if (listed.size >= limit) break;
      }
      return jsonResponse({ alpha, dimension: dimFilter, ids: Array.from(listed) });
    }
    case "session_memory_guide": {
      return jsonResponse(SESSION_MEMORY_GUIDE);
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  await tryAutoLoadSnapshot();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("LoNA Memory MCP server running on stdio");
}

main().catch(console.error);
