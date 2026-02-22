#!/usr/bin/env node
/**
 * κ-Memory MCP Server
 *
 * BC代数 w = z₊e₊ + z₋e₋ に基づくPhase-Angle Long-Term Memory。
 * 自然言語を自動エンコードし、暗黒セクター(z₋)の共起学習と
 * Schur補完(W₀≈10.1)増幅で文脈的想起を実現する。
 *
 * κ物理学定数: κ=5.3603, q=0.530, 3世代PT階層
 * LoNalogy Theory — Lona, 2026
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ============================================================
// Types
// ============================================================

type ToolResponse = {
  content: Array<{ type: "text"; text: string }>;
};

const enum Tier {
  Peripheral = 1, // n=2: sech θ·(5tanh²θ−1), decay ∝ q¹
  Working = 2,    // n=1: sech²θ·tanh θ,      decay ∝ q²
  Core = 3,       // n=0: sech³θ,              decay ∝ q³
}

type MemoryItem = {
  id: string;
  text: string;
  context: string | null;
  zPlus: Uint8Array;       // visible sector (deterministic hash)
  zMinus: Float32Array;    // dark sector (learned co-access)
  amplitude: number;       // [AMP_MIN, AMP_MAX] Hebbian
  accessCount: number;
  tier: Tier;
  createdAt: number;       // millis
  updatedAt: number;
  lastAccessAt: number;
};

type SnapshotItem = {
  id: string;
  text: string;
  context: string | null;
  zPlus: number[];
  zMinus: number[];
  amplitude: number;
  accessCount: number;
  tier: number;
  createdAt: string;
  updatedAt: string;
  lastAccessAt: string;
};

type SnapshotPayload = {
  version: string;
  format: "kappa-v1";
  savedAt: string;
  dimension: number;
  constants: { kappa: number; W0: number; q: number };
  items: SnapshotItem[];
  migratedFrom?: string;
};

// Legacy types for migration
type LegacySnapshotMemory = {
  dimension: number;
  alpha: number;
  items: Record<string, number[]>;
  access?: Record<string, number>;
  amplitude?: Record<string, number>;
  metadata?: Record<string, { createdAt: string; updatedAt: string; lastAccessAt: string }>;
};

type LegacySnapshot = {
  version: string;
  savedAt: string;
  memories: LegacySnapshotMemory[];
};

// ============================================================
// κ Physics Constants — from (1+κ)³ = 48κ, s=3
// ============================================================

const KAPPA = 5.3603;
const P_PLUS = 1 / (1 + KAPPA);                    // 0.1572
const P_MINUS = KAPPA / (1 + KAPPA);                // 0.8428
const W0 = ((1 + KAPPA) ** 2) / 4;                  // 10.1134 Schur amplification
const Q_MIX = 4 * KAPPA / ((1 + KAPPA) ** 2);       // 0.5300 sech²θ_eq
const DIMENSION = 64;

// PT binding energies: ε_n = −(s−n)², s=3
const PT_BINDING = { [Tier.Core]: 9, [Tier.Working]: 4, [Tier.Peripheral]: 1 } as const;

// Tier decay rates: q^m / q = q^(m-1) normalized so Peripheral = 1
const TIER_DECAY = {
  [Tier.Peripheral]: 1.0,
  [Tier.Working]: Q_MIX,
  [Tier.Core]: Q_MIX * Q_MIX,
} as const;

// ============================================================
// Amplitude & Tier Constants
// ============================================================

const AMP_MIN = 16;
const AMP_MAX = 255;
const AMP_INCREMENT = 32;
const AMP_READ_INCREMENT = 16;

const TIER_WORKING_THRESHOLD = 5;
const TIER_CORE_THRESHOLD = 15;

// ============================================================
// Dark Sector Constants
// ============================================================

const DARK_BLEND_RATE = 0.05;
const DARK_MATURITY_THRESHOLD = DIMENSION * 0.3;

// ============================================================
// LUT (256-entry cos/sin, reused from original)
// ============================================================

const LUT_SIZE = 256;
const TWO_PI = Math.PI * 2;
const INV_TWO_PI = LUT_SIZE / TWO_PI;

const COS_LUT = Array.from({ length: LUT_SIZE }, (_, i) =>
  Math.cos((i / LUT_SIZE) * TWO_PI)
);
const SIN_LUT = Array.from({ length: LUT_SIZE }, (_, i) =>
  Math.sin((i / LUT_SIZE) * TWO_PI)
);

// ============================================================
// Utility Functions
// ============================================================

function toCode(theta: number): number {
  const wrapped = ((theta % TWO_PI) + TWO_PI) % TWO_PI;
  return Math.round(wrapped * INV_TWO_PI) & 0xff;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function sampleVonMises(sigma: number): number {
  if (sigma <= 0) return 0;
  const kappa = 1 / (sigma * sigma);
  if (kappa < 1e-6) return (Math.random() - 0.5) * TWO_PI;
  const tau = 1 + Math.sqrt(1 + 4 * kappa * kappa);
  const rho = (tau - Math.sqrt(2 * tau)) / (2 * kappa);
  const r = (1 + rho * rho) / (2 * rho);
  for (;;) {
    const u1 = Math.random();
    const z = Math.cos(Math.PI * u1);
    const f = (1 + r * z) / (r + z);
    const c = kappa * (r - f);
    const u2 = Math.random();
    if (u2 < c * (2 - c) || u2 <= c * Math.exp(1 - c)) {
      const u3 = Math.random();
      return Math.sign(u3 - 0.5) * Math.acos(f);
    }
  }
}

// ============================================================
// FNV-1a Hash
// ============================================================

function fnv1a(str: string, seed: number = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hashToPhase(hash: number): number {
  return (hash / 0x100000000) * TWO_PI;
}

// ============================================================
// Text → Phase Vector (z₊ visible sector)
//
// Multi-scale simhash: 4 bands × 16 dimensions = 64
// Band 0: char unigrams (individual characters — critical for CJK)
// Band 1: char bigrams
// Band 2: char trigrams
// Band 3: tokens (CJK chars + space-split words) + token bigrams
// ============================================================

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** CJK range check (CJK Unified + Hiragana + Katakana + CJK symbols) */
function isCJK(code: number): boolean {
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||  // CJK Unified Ideographs
    (code >= 0x3040 && code <= 0x309f) ||  // Hiragana
    (code >= 0x30a0 && code <= 0x30ff) ||  // Katakana
    (code >= 0x3400 && code <= 0x4dbf) ||  // CJK Extension A
    (code >= 0xff00 && code <= 0xffef) ||  // Fullwidth
    (code >= 0x3000 && code <= 0x303f)     // CJK Symbols
  );
}

/** Tokenize: each CJK char is its own token; latin words are space-split */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let buf = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (isCJK(code)) {
      if (buf.length > 0) { tokens.push(buf); buf = ""; }
      tokens.push(ch);
    } else if (ch === " ") {
      if (buf.length > 0) { tokens.push(buf); buf = ""; }
    } else {
      buf += ch;
    }
  }
  if (buf.length > 0) tokens.push(buf);
  return tokens;
}

/** BM25 multi-granularity tokenizer: unigrams + bigrams + char-trigrams */
function bm25Tokenize(text: string): string[] {
  const norm = normalizeText(text);
  const baseTokens = tokenize(norm);
  const result: string[] = [];

  // Level 1: unigrams (CJK chars / latin words)
  for (const t of baseTokens) result.push(t);

  // Level 2: token bigrams (phrase matching)
  for (let i = 0; i < baseTokens.length - 1; i++) {
    result.push(baseTokens[i] + "\x01" + baseTokens[i + 1]);
  }

  // Level 3: character trigrams (substring/partial matching)
  const clean = norm.replace(/\s+/g, "");
  for (let i = 0; i <= clean.length - 3; i++) {
    result.push("\x02" + clean.substring(i, i + 3));
  }

  return result;
}

function textToPhaseVector(text: string): Uint8Array {
  const norm = normalizeText(text);
  const codes = new Uint8Array(DIMENSION);
  const BAND = DIMENSION / 4; // 16

  const accRe = new Float64Array(DIMENSION);
  const accIm = new Float64Array(DIMENSION);

  // Band 0: character unigrams (each char gets a slot — vital for CJK)
  for (let i = 0; i < norm.length; i++) {
    const ch = norm[i];
    if (ch === " ") continue;
    const dim = fnv1a(ch, 0x99999999) % BAND;
    const phase = hashToPhase(fnv1a(ch, 0xaaaaaaaa));
    accRe[dim] += Math.cos(phase);
    accIm[dim] += Math.sin(phase);
  }

  // Band 1: character bigrams
  for (let i = 0; i < norm.length - 1; i++) {
    const bg = norm.substring(i, i + 2);
    if (bg.includes(" ")) continue;
    const dim = BAND + (fnv1a(bg, 0xbaadf00d) % BAND);
    const phase = hashToPhase(fnv1a(bg, 0xdeadbeef));
    accRe[dim] += Math.cos(phase);
    accIm[dim] += Math.sin(phase);
  }

  // Band 2: character trigrams
  for (let i = 0; i < norm.length - 2; i++) {
    const tg = norm.substring(i, i + 3);
    if (tg.includes(" ")) continue;
    const dim = 2 * BAND + (fnv1a(tg, 0xcafebabe) % BAND);
    const phase = hashToPhase(fnv1a(tg, 0xfeedface));
    accRe[dim] += Math.cos(phase);
    accIm[dim] += Math.sin(phase);
  }

  // Band 3: tokens (CJK-aware) + token bigrams + global
  const tokens = tokenize(norm);
  for (const tok of tokens) {
    const dim = 3 * BAND + (fnv1a(tok, 0x12345678) % BAND);
    const phase = hashToPhase(fnv1a(tok, 0x87654321));
    accRe[dim] += Math.cos(phase);
    accIm[dim] += Math.sin(phase);
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const tb = tokens[i] + tokens[i + 1];
    const dim = 3 * BAND + (fnv1a(tb, 0xabcdef01) % BAND);
    const phase = hashToPhase(fnv1a(tb, 0x10fedcba));
    accRe[dim] += Math.cos(phase);
    accIm[dim] += Math.sin(phase);
  }

  // Convert sin/cos accumulations → 8-bit phase codes
  for (let i = 0; i < DIMENSION; i++) {
    if (accRe[i] === 0 && accIm[i] === 0) {
      codes[i] = fnv1a(norm, 0x11111111 + i) & 0xff;
    } else {
      codes[i] = toCode(Math.atan2(accIm[i], accRe[i]));
    }
  }

  return codes;
}

// ============================================================
// MinHeap (top-K retrieval, reused from original)
// ============================================================

class MinHeap {
  private items: Array<{ id: string; score: number }> = [];
  constructor(private k: number) {}

  push(entry: { id: string; score: number }): void {
    if (this.items.length < this.k) {
      this.items.push(entry);
      this.heapifyUp(this.items.length - 1);
    } else if (entry.score > this.items[0].score) {
      this.items[0] = entry;
      this.heapifyDown(0);
    }
  }

  private heapifyUp(i: number): void {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.items[i].score < this.items[p].score) {
        [this.items[i], this.items[p]] = [this.items[p], this.items[i]];
        i = p;
      } else break;
    }
  }

  private heapifyDown(i: number): void {
    const n = this.items.length;
    for (;;) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.items[l].score < this.items[smallest].score) smallest = l;
      if (r < n && this.items[r].score < this.items[smallest].score) smallest = r;
      if (smallest === i) break;
      [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
      i = smallest;
    }
  }

  toSortedDesc(): Array<{ id: string; score: number }> {
    return this.items
      .slice()
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }
}

// ============================================================
// KappaMemory — BC代数メモリシステム
// ============================================================

class KappaMemory {
  private items: Map<string, MemoryItem> = new Map();

  // ------- BM25 Inverted Index (visible sector enhancement) -------
  private invertedIndex: Map<string, Set<string>> = new Map();
  private docTokenCache: Map<string, string[]> = new Map();
  private totalTokenCount: number = 0;
  private static readonly BM25_K1 = 1.5;
  private static readonly BM25_B = 0.75;

  // ------- ID generation -------

  private generateId(text: string): string {
    const preview = text.substring(0, 60).replace(/\s+/g, " ").trim();
    const hash = fnv1a(text).toString(16).padStart(8, "0");
    return `${preview}#${hash}`;
  }

  // ------- Tier classification (PT eigenstates) -------

  private classifyTier(accessCount: number): Tier {
    if (accessCount >= TIER_CORE_THRESHOLD) return Tier.Core;
    if (accessCount >= TIER_WORKING_THRESHOLD) return Tier.Working;
    return Tier.Peripheral;
  }

  // ------- BM25 Index Management -------

  private addToIndex(id: string, tokens: string[]): void {
    this.docTokenCache.set(id, tokens);
    this.totalTokenCount += tokens.length;
    const seen = new Set<string>();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      let set = this.invertedIndex.get(t);
      if (!set) { set = new Set(); this.invertedIndex.set(t, set); }
      set.add(id);
    }
  }

  private removeFromIndex(id: string): void {
    const tokens = this.docTokenCache.get(id);
    if (!tokens) return;
    this.totalTokenCount -= tokens.length;
    const seen = new Set<string>();
    for (const t of tokens) {
      if (seen.has(t)) continue;
      seen.add(t);
      const set = this.invertedIndex.get(t);
      if (set) { set.delete(id); if (set.size === 0) this.invertedIndex.delete(t); }
    }
    this.docTokenCache.delete(id);
  }

  private getAvgDocLen(): number {
    const n = this.docTokenCache.size;
    return n > 0 ? this.totalTokenCount / n : 1;
  }

  private scoreBM25(queryTokens: string[], itemId: string): number {
    const docToks = this.docTokenCache.get(itemId);
    if (!docToks || docToks.length === 0) return 0;
    const tf = new Map<string, number>();
    for (const t of docToks) tf.set(t, (tf.get(t) || 0) + 1);
    const N = this.items.size;
    const avgDl = this.getAvgDocLen();
    const dl = docToks.length;
    const k1 = KappaMemory.BM25_K1;
    const b = KappaMemory.BM25_B;
    let score = 0;
    const seen = new Set<string>();
    for (const qt of queryTokens) {
      if (seen.has(qt)) continue;
      seen.add(qt);
      const df = this.invertedIndex.get(qt)?.size ?? 0;
      if (df === 0) continue;
      const termFreq = tf.get(qt) ?? 0;
      if (termFreq === 0) continue;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const tfNorm = (termFreq * (k1 + 1)) / (termFreq + k1 * (1 - b + b * dl / avgDl));
      score += idf * tfNorm;
    }
    return score;
  }

  private rebuildIndex(): void {
    this.invertedIndex.clear();
    this.docTokenCache.clear();
    this.totalTokenCount = 0;
    for (const [id, item] of this.items) {
      this.addToIndex(id, bm25Tokenize(item.text));
    }
  }

  // ------- Similarity functions -------

  /** Phase-code ↔ phase-code cosine similarity via LUT */
  private simPhase(a: Uint8Array, b: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < DIMENSION; i++) {
      sum += COS_LUT[a[i]] * COS_LUT[b[i]] + SIN_LUT[a[i]] * SIN_LUT[b[i]];
    }
    return sum / DIMENSION;
  }

  /** Phase-code query ↔ Float32 dark vector similarity */
  private simDark(query: Uint8Array, dark: Float32Array): number {
    let dot = 0;
    let normD = 0;
    for (let i = 0; i < DIMENSION; i++) {
      const qVal = COS_LUT[query[i]]; // use cosine component as scalar projection
      dot += qVal * dark[i];
      normD += dark[i] * dark[i];
    }
    if (normD < 1e-12) return 0;
    // Normalize: phase query has unit norm per dimension in cos space
    let normQ = 0;
    for (let i = 0; i < DIMENSION; i++) {
      const c = COS_LUT[query[i]];
      normQ += c * c;
    }
    if (normQ < 1e-12) return 0;
    return dot / (Math.sqrt(normQ) * Math.sqrt(normD));
  }

  /** Dark sector maturity [0, 1] */
  private darkMaturity(zMinus: Float32Array): number {
    let norm = 0;
    for (let i = 0; i < DIMENSION; i++) norm += zMinus[i] * zMinus[i];
    return Math.min(1.0, Math.sqrt(norm) / DARK_MATURITY_THRESHOLD);
  }

  // ------- BC Scoring (Schur complement + BM25) -------

  private computeScore(
    queryZPlus: Uint8Array,
    queryTokens: string[],
    item: MemoryItem
  ): { total: number; visible: number; dark: number; bm25: number } {
    const simV = this.simPhase(queryZPlus, item.zPlus);
    const simD = this.simDark(queryZPlus, item.zMinus);

    // BM25 exact matching (inverted index)
    const bm25Raw = this.scoreBM25(queryTokens, item.id);
    const bm25Norm = bm25Raw / (bm25Raw + 1); // → [0, 1)

    // Blend visible sector: BM25 (precise) + phase (fuzzy fallback)
    const phaseNorm = clamp01((simV + 1) / 2); // [-1,1] → [0,1]
    const blendedVisible = 0.7 * bm25Norm + 0.3 * phaseNorm;

    const maturity = this.darkMaturity(item.zMinus);
    const darkW0 = W0 * maturity;
    const normFactor = P_PLUS + P_MINUS * Math.min(darkW0, W0);

    // BC score: p₊ × blended_visible + p₋ × W₀_eff × sim_dark
    const score = (P_PLUS * blendedVisible + P_MINUS * darkW0 * simD) / normFactor;

    // Amplitude scaling (Hebbian, adaptive: less impact when BM25 is confident)
    const rawAmpScale = Math.max(AMP_MIN, item.amplitude) / AMP_MAX;
    const ampExponent = 0.05 + 0.4 * (1 - bm25Norm); // 0.05 (precise BM25) to 0.45 (no BM25)
    const ampScale = Math.pow(rawAmpScale, ampExponent);

    return {
      total: score * ampScale,
      visible: blendedVisible,
      dark: simD,
      bm25: bm25Norm,
    };
  }

  // ------- Dark sector update (co-access learning) -------
  // Only couple top DARK_COUPLE_LIMIT items to reduce noise associations

  private static readonly DARK_COUPLE_LIMIT = 3;

  private updateDarkSector(accessedIds: string[]): void {
    if (accessedIds.length < 2) return;
    // accessedIds is score-sorted; only couple the strongest matches
    const topIds = accessedIds.slice(0, KappaMemory.DARK_COUPLE_LIMIT);
    const accessed = topIds
      .map(id => this.items.get(id))
      .filter((item): item is MemoryItem => item !== undefined);

    for (let i = 0; i < accessed.length; i++) {
      for (let j = i + 1; j < accessed.length; j++) {
        const a = accessed[i];
        const b = accessed[j];
        for (let d = 0; d < DIMENSION; d++) {
          a.zMinus[d] += DARK_BLEND_RATE * COS_LUT[b.zPlus[d]];
          b.zMinus[d] += DARK_BLEND_RATE * COS_LUT[a.zPlus[d]];
        }
      }
    }
  }

  // ------- Fisher metric decay factor -------

  private fisherDecayFactor(item: MemoryItem): number {
    const tierDecay = TIER_DECAY[item.tier as Tier] ?? 1.0;
    const binding = PT_BINDING[item.tier as Tier] ?? 1;

    const age = Math.max(0, Date.now() - item.lastAccessAt);
    const ageHours = age / (1000 * 60 * 60);

    return Math.min(1.0, tierDecay * (1 + ageHours * 0.1) / binding);
  }

  // ===== PUBLIC API =====

  remember(text: string, context?: string | null): { id: string; tier: Tier } {
    const id = this.generateId(text);
    const zPlus = textToPhaseVector(text);
    const now = Date.now();

    const existing = this.items.get(id);
    if (existing) {
      // Remove old index entry before update
      this.removeFromIndex(id);
      // Blend z₊ (50/50 with new)
      for (let i = 0; i < DIMENSION; i++) {
        const prevRe = COS_LUT[existing.zPlus[i]];
        const prevIm = SIN_LUT[existing.zPlus[i]];
        const newRe = COS_LUT[zPlus[i]];
        const newIm = SIN_LUT[zPlus[i]];
        existing.zPlus[i] = toCode(Math.atan2(
          prevIm * 0.5 + newIm * 0.5,
          prevRe * 0.5 + newRe * 0.5
        ));
      }
      existing.text = text;
      if (context) existing.context = context;
      existing.amplitude = Math.min(AMP_MAX, existing.amplitude + AMP_INCREMENT);
      existing.accessCount++;
      existing.updatedAt = now;
      existing.lastAccessAt = now;
      existing.tier = this.classifyTier(existing.accessCount);
      // Re-index with updated text
      this.addToIndex(id, bm25Tokenize(text));
      return { id, tier: existing.tier };
    }

    // New item
    const zMinus = new Float32Array(DIMENSION);
    // Seed dark sector from context if provided
    if (context) {
      const ctxVec = textToPhaseVector(context);
      for (let d = 0; d < DIMENSION; d++) {
        zMinus[d] = COS_LUT[ctxVec[d]] * DARK_BLEND_RATE * 10;
      }
    }

    const item: MemoryItem = {
      id,
      text,
      context: context ?? null,
      zPlus,
      zMinus,
      amplitude: AMP_MIN + AMP_INCREMENT,
      accessCount: 0,
      tier: Tier.Peripheral,
      createdAt: now,
      updatedAt: now,
      lastAccessAt: now,
    };

    this.items.set(id, item);
    // Index for BM25
    this.addToIndex(id, bm25Tokenize(text));
    return { id, tier: item.tier };
  }

  recall(
    query: string,
    topK: number = 5
  ): Array<{
    id: string;
    text: string;
    context: string | null;
    score: number;
    scoreVisible: number;
    scoreDark: number;
    scoreBM25: number;
    tier: Tier;
  }> {
    const queryZPlus = textToPhaseVector(query);
    const queryTokens = bm25Tokenize(query);
    const k = Math.max(1, Math.floor(topK));
    const heap = new MinHeap(k);

    // Phase 1: BM25 candidate set from inverted index
    const candidateIds = new Set<string>();
    for (const qt of queryTokens) {
      const docs = this.invertedIndex.get(qt);
      if (docs) for (const id of docs) candidateIds.add(id);
    }

    // Score BM25 candidates (fast path)
    for (const id of candidateIds) {
      const item = this.items.get(id);
      if (!item) continue;
      const { total } = this.computeScore(queryZPlus, queryTokens, item);
      heap.push({ id, score: total });
    }

    // Phase 2: dark sector fallback — score items with mature z₋
    // that weren't in the BM25 candidate set
    for (const [id, item] of this.items) {
      if (candidateIds.has(id)) continue;
      if (this.darkMaturity(item.zMinus) < 0.1) continue;
      const { total } = this.computeScore(queryZPlus, queryTokens, item);
      heap.push({ id, score: total });
    }

    const ordered = heap.toSortedDesc();
    const results: Array<{
      id: string;
      text: string;
      context: string | null;
      score: number;
      scoreVisible: number;
      scoreDark: number;
      scoreBM25: number;
      tier: Tier;
    }> = [];

    const accessedIds: string[] = [];
    const now = Date.now();

    for (const entry of ordered) {
      const item = this.items.get(entry.id);
      if (!item) continue;

      // Update access metadata
      item.accessCount++;
      item.lastAccessAt = now;
      item.amplitude = Math.min(AMP_MAX, item.amplitude + AMP_READ_INCREMENT);
      item.tier = this.classifyTier(item.accessCount);

      const scores = this.computeScore(queryZPlus, queryTokens, item);
      results.push({
        id: entry.id,
        text: item.text,
        context: item.context,
        score: round4(scores.total),
        scoreVisible: round4(scores.visible),
        scoreDark: round4(scores.dark),
        scoreBM25: round4(scores.bm25),
        tier: item.tier,
      });

      accessedIds.push(entry.id);
    }

    // Dark sector update: co-accessed items build associations
    this.updateDarkSector(accessedIds);

    return results;
  }

  forget(): { decayed: number; removed: number } {
    let decayed = 0;
    let removed = 0;
    const now = Date.now();

    for (const [id, item] of this.items.entries()) {
      const decay = this.fisherDecayFactor(item);

      // Phase dephasing (Von Mises noise proportional to decay)
      if (decay > 0.01) {
        const sigma = decay * 0.1;
        for (let i = 0; i < DIMENSION; i++) {
          const noise = sampleVonMises(sigma);
          const shift = Math.round(noise * INV_TWO_PI);
          item.zPlus[i] = (item.zPlus[i] + shift) & 0xff;
        }
        decayed++;
      }

      // Amplitude decay
      item.amplitude = Math.max(
        AMP_MIN,
        Math.round(item.amplitude * (1 - 0.1 * decay))
      );

      // Probabilistic removal for deeply decayed Peripheral items
      if (
        item.tier === Tier.Peripheral &&
        decay > 0.8 &&
        Math.random() < decay * 0.3
      ) {
        this.removeFromIndex(id);
        this.items.delete(id);
        removed++;
        continue;
      }

      item.updatedAt = now;
    }

    return { decayed, removed };
  }

  deleteItem(id: string): boolean {
    this.removeFromIndex(id);
    return this.items.delete(id);
  }

  listItems(limit: number = 100): Array<{ id: string; text: string; tier: Tier; accessCount: number }> {
    const results: Array<{ id: string; text: string; tier: Tier; accessCount: number }> = [];
    let count = 0;
    for (const item of this.items.values()) {
      if (count >= limit) break;
      results.push({ id: item.id, text: item.text, tier: item.tier, accessCount: item.accessCount });
      count++;
    }
    return results;
  }

  stats(): {
    totalItems: number;
    tiers: { core: number; working: number; peripheral: number };
    memoryBytes: number;
    constants: { kappa: number; W0: number; q: number; dimension: number };
  } {
    let core = 0, working = 0, peripheral = 0;
    let bytes = 0;
    for (const item of this.items.values()) {
      if (item.tier === Tier.Core) core++;
      else if (item.tier === Tier.Working) working++;
      else peripheral++;
      // z+ (64 bytes) + z- (64*4 bytes) + overhead (~200)
      bytes += DIMENSION + DIMENSION * 4 + 200;
    }
    return {
      totalItems: this.items.size,
      tiers: { core, working, peripheral },
      memoryBytes: bytes,
      constants: { kappa: KAPPA, W0: round4(W0), q: round4(Q_MIX), dimension: DIMENSION },
    };
  }

  // ------- Snapshot persistence -------

  toSnapshot(): SnapshotPayload {
    const items: SnapshotItem[] = [];
    for (const item of this.items.values()) {
      items.push({
        id: item.id,
        text: item.text,
        context: item.context,
        zPlus: Array.from(item.zPlus),
        zMinus: Array.from(item.zMinus),
        amplitude: item.amplitude,
        accessCount: item.accessCount,
        tier: item.tier as number,
        createdAt: new Date(item.createdAt).toISOString(),
        updatedAt: new Date(item.updatedAt).toISOString(),
        lastAccessAt: new Date(item.lastAccessAt).toISOString(),
      });
    }
    return {
      version: SNAPSHOT_VERSION,
      format: "kappa-v1",
      savedAt: new Date().toISOString(),
      dimension: DIMENSION,
      constants: { kappa: KAPPA, W0: round4(W0), q: round4(Q_MIX) },
      items,
    };
  }

  static fromSnapshot(payload: SnapshotPayload): KappaMemory {
    const mem = new KappaMemory();
    for (const si of payload.items) {
      mem.items.set(si.id, KappaMemory.snapshotItemToMemory(si));
    }
    mem.rebuildIndex();
    return mem;
  }

  /** Merge snapshot into existing memory (clear=false support) */
  mergeFromSnapshot(payload: SnapshotPayload): { added: number; updated: number } {
    let added = 0;
    let updated = 0;
    const now = Date.now();

    for (const si of payload.items) {
      const existing = this.items.get(si.id);
      if (existing) {
        // Merge strategy: newer text wins, max amplitude/access, blend z₋
        const snapshotUpdated = safeParseDate(si.updatedAt, 0);
        if (snapshotUpdated > existing.updatedAt) {
          existing.text = si.text;
          if (si.context) existing.context = si.context;
          const zPlus = new Uint8Array(DIMENSION);
          for (let i = 0; i < DIMENSION && i < si.zPlus.length; i++) zPlus[i] = si.zPlus[i] & 0xff;
          existing.zPlus = zPlus;
        }
        existing.amplitude = Math.min(AMP_MAX, Math.max(existing.amplitude, si.amplitude));
        existing.accessCount = Math.max(existing.accessCount, si.accessCount);
        existing.tier = this.classifyTier(existing.accessCount);
        // Dark sector: weighted average (preserve both learned associations)
        for (let d = 0; d < DIMENSION && d < si.zMinus.length; d++) {
          existing.zMinus[d] = existing.zMinus[d] * 0.5 + si.zMinus[d] * 0.5;
        }
        existing.updatedAt = now;
        existing.lastAccessAt = Math.max(existing.lastAccessAt, safeParseDate(si.lastAccessAt, 0));
        this.removeFromIndex(si.id);
        this.addToIndex(si.id, bm25Tokenize(existing.text));
        updated++;
      } else {
        // New item
        this.items.set(si.id, KappaMemory.snapshotItemToMemory(si));
        this.addToIndex(si.id, bm25Tokenize(si.text));
        added++;
      }
    }
    return { added, updated };
  }

  private static snapshotItemToMemory(si: SnapshotItem): MemoryItem {
    const zPlus = new Uint8Array(DIMENSION);
    for (let i = 0; i < DIMENSION && i < si.zPlus.length; i++) zPlus[i] = si.zPlus[i] & 0xff;
    const zMinus = new Float32Array(DIMENSION);
    for (let i = 0; i < DIMENSION && i < si.zMinus.length; i++) zMinus[i] = si.zMinus[i];
    const now = Date.now();
    return {
      id: si.id,
      text: si.text,
      context: si.context,
      zPlus,
      zMinus,
      amplitude: Math.max(AMP_MIN, Math.min(AMP_MAX, si.amplitude)),
      accessCount: si.accessCount,
      tier: (si.tier >= 1 && si.tier <= 3 ? si.tier : Tier.Peripheral) as Tier,
      createdAt: safeParseDate(si.createdAt, now),
      updatedAt: safeParseDate(si.updatedAt, now),
      lastAccessAt: safeParseDate(si.lastAccessAt, now),
    };
  }
}

// ============================================================
// Legacy Migration
// ============================================================

function migrateFromLegacy(legacy: LegacySnapshot): SnapshotPayload {
  const items: SnapshotItem[] = [];
  for (const mem of legacy.memories) {
    for (const [id, codes] of Object.entries(mem.items)) {
      // Pad old codes (typically 4-dim) to DIMENSION with deterministic hash
      const zPlus = new Array(DIMENSION).fill(0);
      for (let i = 0; i < DIMENSION; i++) {
        zPlus[i] = i < codes.length ? codes[i] & 0xff : fnv1a(id, 0x11111111 + i) & 0xff;
      }
      const acc = mem.access?.[id] ?? 0;
      items.push({
        id,
        text: id, // old IDs were descriptive
        context: null,
        zPlus,
        zMinus: new Array(DIMENSION).fill(0),
        amplitude: mem.amplitude?.[id] ?? AMP_MIN,
        accessCount: acc,
        tier: acc >= TIER_CORE_THRESHOLD ? 3 : acc >= TIER_WORKING_THRESHOLD ? 2 : 1,
        createdAt: mem.metadata?.[id]?.createdAt ?? new Date().toISOString(),
        updatedAt: mem.metadata?.[id]?.updatedAt ?? new Date().toISOString(),
        lastAccessAt: mem.metadata?.[id]?.lastAccessAt ?? new Date().toISOString(),
      });
    }
  }
  return {
    version: SNAPSHOT_VERSION,
    format: "kappa-v1",
    savedAt: new Date().toISOString(),
    dimension: DIMENSION,
    constants: { kappa: KAPPA, W0: round4(W0), q: round4(Q_MIX) },
    items,
    migratedFrom: legacy.version,
  };
}

// ============================================================
// Helpers
// ============================================================

const SNAPSHOT_VERSION = "1.0.0";

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

function safeParseDate(s: string, fallback: number): number {
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : fallback;
}

function jsonResponse(data: unknown): ToolResponse {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

const TIER_NAMES: Record<number, string> = {
  1: "Peripheral",
  2: "Working",
  3: "Core",
};

// ============================================================
// Session Guide
// ============================================================

const SESSION_GUIDE = {
  title: "κ-Memory セッションガイド",
  version: "1.0",
  theory:
    "BC代数 w = z₊e₊ + z₋e₋ に基づく位相メモリ。" +
    "z₊(可視)はテキストの自動ハッシュ、z₋(暗黒)は共起学習。" +
    "Schur補完 W₀≈10.1 で暗黒セクターが検索を増幅。" +
    "3世代PT階層: Core(q³) / Working(q²) / Peripheral(q¹)。",
  quickstart: [
    "1. load_snapshot で既存スナップショット復元",
    "2. remember({text: '覚えたい内容'}) で記憶",
    "3. recall({query: '思い出したいキーワード'}) で想起",
    "4. forget() で古い記憶を減衰",
    "5. save_snapshot で永続化",
  ],
  tips: [
    "remember の context パラメータで初期の暗黒セクターをシード可能",
    "同じ内容を繰り返し recall すると自動的に Core 階層に昇格",
    "一緒に recall された記憶同士は暗黒セクターで結びつく",
    "forget は Core 記憶をほぼ消さない（PT束縛エネルギー ε=-9）",
  ],
  constants: {
    "κ": KAPPA,
    "W₀ (Schur amplification)": round4(W0),
    "q (sech²θ_eq)": round4(Q_MIX),
    "p₊ (visible)": round4(P_PLUS),
    "p₋ (dark)": round4(P_MINUS),
    "dimension": DIMENSION,
  },
};

// ============================================================
// MCP Server
// ============================================================

const server = new Server(
  { name: "kappa-memory", version: SNAPSHOT_VERSION },
  { capabilities: { tools: {} } }
);

let memory = new KappaMemory();

// ------- Tool definitions -------

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "remember",
      description:
        "自然言語で記憶を保存。テキストは自動的にκ物理学の位相ベクトルにエンコードされる。" +
        "context を渡すと暗黒セクター(z₋)の初期シードになり連想検索が強化される。",
      inputSchema: {
        type: "object" as const,
        required: ["text"],
        properties: {
          text: { type: "string", description: "記憶するテキスト" },
          context: {
            type: "string",
            description: "任意: 文脈情報（暗黒セクターのシードに使用）",
          },
        },
      },
    },
    {
      name: "recall",
      description:
        "自然言語で記憶を想起。BCスコアリング: " +
        "可視セクター(テキスト類似度) + 暗黒セクター(学習済み連想) × Schur補完(W₀≈10.1)。",
      inputSchema: {
        type: "object" as const,
        required: ["query"],
        properties: {
          query: { type: "string", description: "検索クエリ（自然言語）" },
          topK: {
            type: "integer",
            default: 5,
            description: "返す結果数（デフォルト: 5）",
          },
        },
      },
    },
    {
      name: "forget",
      description:
        "Fisher計量 g_θθ = sech²θ による全記憶の減衰。" +
        "PT束縛エネルギーで階層別: Core(ε=-9,極遅) / Working(ε=-4) / Peripheral(ε=-1,速い)。" +
        "Peripheral記憶は確率的に削除される。",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "delete_memory",
      description: "指定IDの記憶を削除する。",
      inputSchema: {
        type: "object" as const,
        required: ["id"],
        properties: {
          id: { type: "string", description: "削除する記憶のID" },
        },
      },
    },
    {
      name: "list_memory",
      description: "記憶一覧を返す。",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: { type: "integer", default: 100, description: "最大件数" },
        },
      },
    },
    {
      name: "stats",
      description:
        "メモリ統計: 総件数、階層分布(Core/Working/Peripheral)、" +
        "メモリ使用量、κ物理定数。",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    {
      name: "save_snapshot",
      description: "全記憶をJSONスナップショットとして保存。",
      inputSchema: {
        type: "object" as const,
        required: ["path"],
        properties: {
          path: { type: "string", description: "保存先ファイルパス" },
        },
      },
    },
    {
      name: "load_snapshot",
      description:
        "スナップショットから記憶を復元。旧LonaMemory形式からの自動マイグレーション対応。",
      inputSchema: {
        type: "object" as const,
        required: ["path"],
        properties: {
          path: { type: "string", description: "スナップショットのパス" },
          clear: {
            type: "boolean",
            default: true,
            description: "読み込み前に既存記憶をクリアするか（デフォルト: true）",
          },
        },
      },
    },
    {
      name: "session_guide",
      description: "κ-Memoryの使い方ガイドとκ物理定数を返す。",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ],
}));

// ------- Tool handler -------

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "remember": {
      const text = String(args?.text ?? "");
      if (!text) throw new Error("text is required");
      const context = args?.context != null ? String(args.context) : undefined;
      const result = memory.remember(text, context);
      return jsonResponse({
        stored: result.id,
        tier: result.tier,
        tierName: TIER_NAMES[result.tier],
      });
    }

    case "recall": {
      const query = String(args?.query ?? "");
      if (!query) throw new Error("query is required");
      const topK = typeof args?.topK === "number" ? args.topK : 5;
      const results = memory.recall(query, topK);
      return jsonResponse({
        results: results.map(r => ({
          id: r.id,
          text: r.text,
          context: r.context,
          score: r.score,
          scoreVisible: r.scoreVisible,
          scoreDark: r.scoreDark,
          scoreBM25: r.scoreBM25,
          tier: r.tier,
          tierName: TIER_NAMES[r.tier],
        })),
        query,
        topK,
      });
    }

    case "forget": {
      const result = memory.forget();
      return jsonResponse(result);
    }

    case "delete_memory": {
      const id = String(args?.id ?? "");
      if (!id) throw new Error("id is required");
      const deleted = memory.deleteItem(id);
      return jsonResponse({ deleted, id });
    }

    case "list_memory": {
      const limit = typeof args?.limit === "number" ? args.limit : 100;
      const items = memory.listItems(limit);
      return jsonResponse({
        count: items.length,
        items: items.map(i => ({
          id: i.id,
          text: i.text.substring(0, 80),
          tier: i.tier,
          tierName: TIER_NAMES[i.tier],
          accessCount: i.accessCount,
        })),
      });
    }

    case "stats": {
      return jsonResponse(memory.stats());
    }

    case "save_snapshot": {
      const filePath = String(args?.path ?? "");
      if (!filePath) throw new Error("path is required");
      const snapshot = memory.toSnapshot();
      const dir = path.dirname(filePath);
      if (dir && dir !== ".") {
        await fs.mkdir(dir, { recursive: true });
      }
      await fs.writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf8");
      return jsonResponse({
        saved: true,
        file: filePath,
        items: snapshot.items.length,
        version: SNAPSHOT_VERSION,
        format: "kappa-v1",
      });
    }

    case "load_snapshot": {
      const filePath = String(args?.path ?? "");
      if (!filePath) throw new Error("path is required");
      const clear = typeof args?.clear === "boolean" ? args.clear : true;
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw);

      let snapshot: SnapshotPayload;
      if (parsed.format === "kappa-v1") {
        snapshot = parsed as SnapshotPayload;
      } else if (Array.isArray(parsed.memories)) {
        // Legacy LonaMemory format → auto-migrate
        snapshot = migrateFromLegacy(parsed as LegacySnapshot);
      } else {
        throw new Error("Unrecognized snapshot format");
      }

      if (clear) {
        memory = KappaMemory.fromSnapshot(snapshot);
        return jsonResponse({
          loaded: true,
          mode: "replace",
          file: filePath,
          items: snapshot.items.length,
          format: "kappa-v1",
          migrated: !!snapshot.migratedFrom,
          version: snapshot.version,
        });
      } else {
        const result = memory.mergeFromSnapshot(snapshot);
        return jsonResponse({
          loaded: true,
          mode: "merge",
          file: filePath,
          added: result.added,
          updated: result.updated,
          total: memory.stats().totalItems,
          format: "kappa-v1",
          migrated: !!snapshot.migratedFrom,
          version: snapshot.version,
        });
      }
    }

    case "session_guide": {
      return jsonResponse(SESSION_GUIDE);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ============================================================
// Startup & Auto-load
// ============================================================

async function tryAutoLoad(): Promise<void> {
  const snapshotPath =
    process.env.KAPPA_MEMORY_SNAPSHOT ??
    process.env.LONA_MEMORY_SNAPSHOT ??
    process.argv.find((_, i, a) => a[i - 1] === "--snapshot");

  if (!snapshotPath) return;

  try {
    const raw = await fs.readFile(snapshotPath, "utf8");
    const parsed = JSON.parse(raw);
    let snapshot: SnapshotPayload;
    if (parsed.format === "kappa-v1") {
      snapshot = parsed as SnapshotPayload;
    } else if (Array.isArray(parsed.memories)) {
      snapshot = migrateFromLegacy(parsed as LegacySnapshot);
      process.stderr.write(`[κ-Memory] Migrated legacy snapshot from v${parsed.version}\n`);
    } else {
      process.stderr.write(`[κ-Memory] Warning: unrecognized snapshot format at ${snapshotPath}\n`);
      return;
    }
    memory = KappaMemory.fromSnapshot(snapshot);
    process.stderr.write(
      `[κ-Memory] Loaded ${snapshot.items.length} items from ${snapshotPath}\n`
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[κ-Memory] Auto-load failed: ${msg}\n`);
  }
}

async function main(): Promise<void> {
  await tryAutoLoad();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[κ-Memory] Server started. κ=${KAPPA}, W₀=${round4(W0)}, q=${round4(Q_MIX)}, dim=${DIMENSION}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[κ-Memory] Fatal: ${err}\n`);
  process.exit(1);
});
