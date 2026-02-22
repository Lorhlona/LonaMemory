#!/usr/bin/env npx tsx
/**
 * κ-Memory 全機能テスト (MCP Client SDK使用)
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "node:fs/promises";
import path from "node:path";

const SNAPSHOT_DIR = "/tmp/kappa-test-" + Date.now();

// ============================================================
// MCP Client setup
// ============================================================

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "/Users/lona/Desktop/LonaMemory/index.ts"],
  cwd: "/Users/lona/Desktop/LonaMemory",
});

const client = new Client({ name: "kappa-test", version: "1.0" }, {});

async function callTool(name: string, args: Record<string, any> = {}): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  const text = (result?.content as any)?.[0]?.text;
  return text ? JSON.parse(text) : result;
}

// ============================================================
// Test framework
// ============================================================

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    const msg = detail ? name + " — " + detail : name;
    failures.push(msg);
    console.log("  FAIL: " + msg);
  }
}

function section(name: string) {
  console.log("\n--- " + name + " ---");
}

// ============================================================
// Tests
// ============================================================

async function testToolList() {
  section("Tool List");
  const result = await client.listTools();
  const names = result.tools.map(t => t.name);
  assert(names.includes("remember"), "has remember");
  assert(names.includes("recall"), "has recall");
  assert(names.includes("forget"), "has forget");
  assert(names.includes("delete_memory"), "has delete_memory");
  assert(names.includes("list_memory"), "has list_memory");
  assert(names.includes("stats"), "has stats");
  assert(names.includes("save_snapshot"), "has save_snapshot");
  assert(names.includes("load_snapshot"), "has load_snapshot");
  assert(names.includes("session_guide"), "has session_guide");
  assert(names.length === 9, "exactly 9 tools", "got " + names.length);
}

async function testBasicRememberRecall() {
  section("Basic Remember/Recall");

  const r1 = await callTool("remember", { text: "東京タワーの高さは333メートル" });
  assert(!!r1.stored, "remember returns id");
  assert(r1.tierName === "Peripheral", "new item is Peripheral");

  const r2 = await callTool("remember", { text: "富士山は標高3776メートルの日本最高峰" });
  assert(!!r2.stored, "remember second item");

  const r3 = await callTool("remember", { text: "エッフェル塔はパリのランドマーク" });
  assert(!!r3.stored, "remember third item");

  const q1 = await callTool("recall", { query: "東京タワー", topK: 3 });
  assert(q1.results.length === 3, "returns 3 results");
  assert(q1.results[0].text.includes("東京タワー"), "top-1 matches 東京タワー",
    "got: " + q1.results[0].text.substring(0, 30));

  const q2 = await callTool("recall", { query: "富士山 高さ", topK: 1 });
  assert(q2.results[0].text.includes("富士山"), "partial match 富士山");

  const q3 = await callTool("recall", { query: "エッフェル パリ", topK: 1 });
  assert(q3.results[0].text.includes("エッフェル"), "match エッフェル");

  assert(typeof q1.results[0].scoreBM25 === "number", "BM25 score in output");
  assert(q1.results[0].scoreBM25 > 0, "BM25 score > 0 for matching query");
}

async function testContextSeeding() {
  section("Context Seeding");

  await callTool("remember", {
    text: "量子もつれは2つの粒子が瞬時に相関する現象",
    context: "物理学 量子力学 EPRパラドックス",
  });

  const q = await callTool("recall", { query: "量子もつれ EPR", topK: 1 });
  assert(q.results[0].text.includes("量子もつれ"), "context-seeded item found");
  assert(q.results[0].context !== null, "context returned in recall output");
}

async function testBM25AccuracyBulk() {
  section("BM25 Accuracy (50 items)");

  const items = [
    "Python is a versatile programming language",
    "JavaScript runs in web browsers natively",
    "Rust guarantees memory safety without garbage collection",
    "Go was designed by Google for concurrent systems",
    "TypeScript adds static types to JavaScript code",
    "Docker containerizes applications for portable deployment",
    "Kubernetes orchestrates container workloads at scale",
    "PostgreSQL is an advanced open-source relational database",
    "Redis is an in-memory key-value data store",
    "GraphQL is a query language for modern APIs",
    "React is a frontend UI library created by Meta",
    "Vue.js is a progressive JavaScript framework for SPAs",
    "TensorFlow is a machine learning framework by Google",
    "PyTorch is the preferred ML framework for researchers",
    "Nginx is a high-performance reverse proxy and web server",
    "Apache Kafka handles real-time distributed event streaming",
    "Elasticsearch provides distributed full-text search capabilities",
    "MongoDB is a document-oriented NoSQL database system",
    "Git is a distributed version control system for code",
    "Linux is the most popular open-source operating system kernel",
    "ニューラルネットワークは生物の脳構造を数学的に模倣する",
    "深層学習は多数の隠れ層を持つニューラルネットワーク",
    "自然言語処理はコンピュータでテキストを理解する技術分野",
    "強化学習はエージェントが環境から報酬を最大化する手法",
    "畳み込みニューラルネットワークCNNは画像認識の基礎",
    "トランスフォーマーはself-attention機構のアーキテクチャ",
    "GANは生成器と識別器が敵対的に学習する生成モデル",
    "BERTは双方向トランスフォーマーによる事前学習モデル",
    "ファインチューニングで事前学習モデルを特定タスクに適応",
    "バッチ正規化はミニバッチ単位で正規化し学習を安定化",
    "ミトコンドリアは細胞のエネルギー工場ATP合成の場",
    "光合成は二酸化炭素と水からグルコースを生成する",
    "DNAは二重らせん構造で遺伝情報を塩基配列として保存",
    "RNAは遺伝情報をmRNAとして転写しタンパク質合成を仲介",
    "CRISPR-Cas9は特定DNA配列を正確に編集する遺伝子工学",
    "抗体はB細胞が産生する免疫タンパク質で病原体と結合",
    "神経細胞ニューロンは電気信号を軸索で伝達する",
    "酵素は生体触媒として化学反応速度を大幅に高める",
    "ATPはアデノシン三リン酸で細胞のエネルギー通貨",
    "リボソームはmRNAからアミノ酸をペプチド結合でタンパク質へ",
    "一般相対性理論は重力を時空の曲率として幾何学的に記述",
    "特殊相対性理論によりE=mc²という質量エネルギー等価が成立",
    "量子色力学QCDはグルーオンを媒介するクォーク間の強い相互作用",
    "超弦理論は点粒子を1次元の弦に置き換え10次元時空で統一",
    "ヒッグス場との相互作用で素粒子は質量を獲得する",
    "暗黒物質は電磁波で観測不能だが重力的影響で存在が示唆",
    "ブラックホールの事象の地平面から光でさえ脱出不可能",
    "重力波はLIGO干渉計で2015年に初めて直接検出された",
    "宇宙マイクロ波背景放射はビッグバンから38万年後の光の化石",
    "ニュートリノは3世代のフレーバーを持つ極軽量レプトン",
  ];

  for (const text of items) await callTool("remember", { text });

  const queries: [string, string][] = [
    ["Python programming language", "Python"],
    ["JavaScript web browser", "JavaScript"],
    ["Rust memory safety garbage", "Rust"],
    ["Docker containerize deploy", "Docker"],
    ["PostgreSQL relational database", "PostgreSQL"],
    ["React UI Meta frontend", "React"],
    ["TensorFlow machine learning Google", "TensorFlow"],
    ["Git version control code", "Git"],
    ["Linux open-source kernel", "Linux"],
    ["ニューラルネットワーク 脳 模倣", "ニューラルネットワーク"],
    ["深層学習 多数 隠れ層", "深層学習"],
    ["自然言語処理 テキスト 理解", "自然言語処理"],
    ["トランスフォーマー self-attention", "トランスフォーマー"],
    ["BERT 双方向 事前学習", "BERT"],
    ["DNA 二重らせん 遺伝情報", "DNA"],
    ["CRISPR 遺伝子 編集", "CRISPR"],
    ["ATP エネルギー 細胞", "ATP"],
    ["一般相対性理論 重力 時空", "一般相対性理論"],
    ["E=mc² 特殊相対性理論 質量", "特殊相対性理論"],
    ["ヒッグス 質量 素粒子", "ヒッグス"],
    ["暗黒物質 重力 観測不能", "暗黒物質"],
    ["ブラックホール 事象の地平面 光", "ブラックホール"],
    ["重力波 LIGO 検出", "重力波"],
    ["ニュートリノ レプトン 3世代", "ニュートリノ"],
    ["Kubernetes container orchestrate", "Kubernetes"],
    ["Redis in-memory key-value", "Redis"],
    ["GraphQL API query language", "GraphQL"],
    ["Kafka streaming event", "Kafka"],
    ["MongoDB NoSQL document", "MongoDB"],
    ["Nginx web server reverse proxy", "Nginx"],
  ];

  let correct = 0;
  const qFails: string[] = [];
  for (const [query, expected] of queries) {
    const result = await callTool("recall", { query, topK: 1 });
    if (result.results[0]?.text?.includes(expected)) {
      correct++;
    } else {
      qFails.push("  " + query + " -> " + (result.results[0]?.text?.substring(0, 50) || "null"));
    }
  }

  const pct = (correct / queries.length * 100).toFixed(1);
  console.log("  BM25 accuracy: " + correct + "/" + queries.length + " = " + pct + "%");
  assert(correct >= queries.length * 0.9, "BM25 accuracy >= 90%", pct + "%");

  if (qFails.length > 0 && qFails.length <= 5) {
    console.log("  Failures:");
    for (const f of qFails) console.log(f);
  }
}

async function testDarkSectorLearning() {
  section("Dark Sector Learning");

  await callTool("remember", { text: "DARK_TEST: カレーライスは日本の国民的な食べ物" });
  await callTool("remember", { text: "DARK_TEST: ナンはインドの伝統的な平たいパン" });

  // Co-access them to build associations
  for (let i = 0; i < 20; i++) {
    await callTool("recall", { query: "DARK_TEST カレー ナン インド 日本 食べ物 パン", topK: 5 });
  }

  // Check dark sector score (use topK=20 to find ナン among many items)
  const q = await callTool("recall", { query: "DARK_TEST カレーライス 日本", topK: 20 });
  const nanItem = q.results.find((r: any) => r.text.includes("ナン"));
  const nanRank = q.results.findIndex((r: any) => r.text.includes("ナン"));

  console.log("  ナン rank: " + nanRank + ", dark score: " + (nanItem?.scoreDark ?? "N/A"));
  assert(nanItem !== undefined, "ナン in results after co-access learning");
  if (nanItem) {
    assert(nanItem.scoreDark > 0, "dark sector score > 0", "got " + nanItem.scoreDark);
  }
}

async function testTierPromotion() {
  section("Tier Promotion");

  await callTool("remember", { text: "TIER_TEST unique item ZZZ999 for promotion testing" });

  for (let i = 0; i < 6; i++) {
    await callTool("recall", { query: "TIER_TEST ZZZ999 promotion", topK: 1 });
  }
  const q1 = await callTool("recall", { query: "TIER_TEST ZZZ999 promotion", topK: 1 });
  const tier1 = q1.results[0].tierName;
  assert(tier1 === "Working" || tier1 === "Core", "Working after ~7 accesses", "tier: " + tier1);

  for (let i = 0; i < 10; i++) {
    await callTool("recall", { query: "TIER_TEST ZZZ999 promotion", topK: 1 });
  }
  const q2 = await callTool("recall", { query: "TIER_TEST ZZZ999 promotion", topK: 1 });
  assert(q2.results[0].tierName === "Core", "Core after ~18 accesses",
    "tier: " + q2.results[0].tierName);
}

async function testForget() {
  section("Forget (Fisher decay)");

  // The Core item from tier test should survive
  const coreQuery = await callTool("recall", { query: "TIER_TEST ZZZ999 promotion", topK: 1 });
  assert(coreQuery.results[0].text.includes("ZZZ999"), "Core item exists before forget");

  // Also remember a fresh Peripheral item
  await callTool("remember", { text: "FORGET_CANARY ephemeral peripheral item" });

  const statsBefore = await callTool("stats");

  let totalDecayed = 0;
  let totalRemoved = 0;
  for (let i = 0; i < 3; i++) {
    const result = await callTool("forget");
    totalDecayed += result.decayed;
    totalRemoved += result.removed;
  }
  console.log("  decayed: " + totalDecayed + ", removed: " + totalRemoved);
  assert(totalDecayed > 0, "some items decayed");

  // Core item should survive
  const coreAfter = await callTool("recall", { query: "TIER_TEST ZZZ999 promotion", topK: 1 });
  assert(coreAfter.results[0].text.includes("ZZZ999"), "Core item survived forget");
}

async function testDeleteMemory() {
  section("Delete Memory");

  const r = await callTool("remember", { text: "DELETE_TEST item ABC789 to be removed" });
  const id = r.stored;

  const q1 = await callTool("recall", { query: "DELETE_TEST ABC789 removed", topK: 1 });
  assert(q1.results[0].text.includes("ABC789"), "item exists before delete");

  const del = await callTool("delete_memory", { id });
  assert(del.deleted === true, "delete returns true");

  const q2 = await callTool("recall", { query: "DELETE_TEST ABC789 removed", topK: 1 });
  const found = q2.results.some((r: any) => r.text.includes("ABC789"));
  assert(!found, "deleted item not in results");
}

async function testSnapshotSaveLoad() {
  section("Snapshot Save/Load (clear=true)");

  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });
  const snapPath = path.join(SNAPSHOT_DIR, "test1.json");

  const statsBefore = await callTool("stats");
  const save = await callTool("save_snapshot", { path: snapPath });
  assert(save.saved === true, "save succeeded");
  assert(save.items === statsBefore.totalItems, "saved item count matches");

  const raw = await fs.readFile(snapPath, "utf8");
  const parsed = JSON.parse(raw);
  assert(parsed.format === "kappa-v1", "snapshot format is kappa-v1");

  const load = await callTool("load_snapshot", { path: snapPath, clear: true });
  assert(load.loaded === true, "load succeeded");
  assert(load.mode === "replace", "mode is replace");

  const statsAfter = await callTool("stats");
  assert(statsAfter.totalItems === statsBefore.totalItems, "item count preserved");
}

async function testSnapshotMerge() {
  section("Snapshot Merge (clear=false)");

  await fs.mkdir(SNAPSHOT_DIR, { recursive: true });

  // Save current state
  const snapPath = path.join(SNAPSHOT_DIR, "merge_base.json");
  await callTool("save_snapshot", { path: snapPath });
  const baseCount = (await callTool("stats")).totalItems;

  // Add a new unique item
  await callTool("remember", { text: "MERGE_GAMMA_UNIQUE item added after snapshot" });
  const premergeCount = (await callTool("stats")).totalItems;
  assert(premergeCount === baseCount + 1, "gamma added");

  // Merge (clear=false) — gamma should survive
  const merge = await callTool("load_snapshot", { path: snapPath, clear: false });
  assert(merge.mode === "merge", "mode is merge");

  const qGamma = await callTool("recall", { query: "MERGE_GAMMA_UNIQUE after snapshot", topK: 1 });
  assert(qGamma.results[0]?.text?.includes("MERGE_GAMMA"), "gamma survived merge",
    "got: " + (qGamma.results[0]?.text?.substring(0, 50) || "null"));

  const afterCount = (await callTool("stats")).totalItems;
  assert(afterCount >= baseCount + 1, "total >= base+1 after merge", "got " + afterCount);
}

async function testListMemory() {
  section("List Memory");

  const list = await callTool("list_memory", { limit: 5 });
  assert(list.count > 0, "list returns items");
  assert(list.count <= 5, "respects limit");
  assert(list.items[0].tierName !== undefined, "items have tierName");
  assert(typeof list.items[0].accessCount === "number", "items have accessCount");
}

async function testStats() {
  section("Stats");

  const s = await callTool("stats");
  assert(s.totalItems > 0, "has items");
  assert(s.constants.kappa > 5, "kappa > 5");
  assert(s.constants.W0 > 10, "W0 > 10");
  assert(s.constants.q > 0.5, "q > 0.5");
  assert(s.constants.dimension === 64, "dimension = 64");
  assert(s.tiers.core + s.tiers.working + s.tiers.peripheral === s.totalItems, "tiers sum to total");
}

async function testSessionGuide() {
  section("Session Guide");
  const guide = await callTool("session_guide");
  assert(guide.title.includes("κ-Memory"), "guide has title");
  assert(guide.quickstart.length > 0, "guide has quickstart steps");
}

async function testEdgeCases() {
  section("Edge Cases");

  // Empty text
  try {
    await callTool("remember", { text: "" });
    assert(false, "empty text should throw");
  } catch {
    assert(true, "empty text throws error");
  }

  // Single char
  await callTool("remember", { text: "EDGE_SINGLE_CHAR_x" });
  const q1 = await callTool("recall", { query: "EDGE_SINGLE_CHAR_x", topK: 1 });
  assert(q1.results.length > 0, "single char query returns results");

  // CJK mixed
  await callTool("remember", { text: "EDGE_CJK: 漢字 ひらがな カタカナ ABC 123" });
  const q2 = await callTool("recall", { query: "EDGE_CJK 漢字 ひらがな", topK: 1 });
  assert(q2.results[0].text.includes("漢字"), "CJK mixed text works");

  // Long text — use highly unique tokens for reliable matching
  const longText = "EDGE_XYLOPHONE_ZEBRA " + "padding content text ".repeat(50) + "EDGE_XYLOPHONE_ZEBRA";
  await callTool("remember", { text: longText });
  const q3 = await callTool("recall", { query: "EDGE_XYLOPHONE_ZEBRA", topK: 1 });
  assert(q3.results[0].text.includes("EDGE_XYLOPHONE_ZEBRA"), "long text recall");

  // topK=1
  const q4 = await callTool("recall", { query: "test", topK: 1 });
  assert(q4.results.length === 1, "topK=1 returns exactly 1");

  // Duplicate remember
  await callTool("remember", { text: "EDGE_DUPE duplicate test item xyz" });
  await callTool("remember", { text: "EDGE_DUPE duplicate test item xyz" });
  const list = await callTool("list_memory", { limit: 1000 });
  const dupes = list.items.filter((i: any) => i.text.startsWith("EDGE_DUPE"));
  assert(dupes.length === 1, "no duplicates created", "found " + dupes.length);
}

async function testCrossLanguagePartial() {
  section("Cross-language / Partial Match");

  await callTool("remember", { text: "CROSS_EN: Transformer architecture uses self-attention mechanism" });
  await callTool("remember", { text: "CROSS_JP: トランスフォーマーはself-attentionを使う" });

  const q1 = await callTool("recall", { query: "CROSS_EN self-attention mechanism architecture", topK: 1 });
  assert(q1.results[0].text.includes("CROSS_EN"), "EN query -> EN item");

  const q2 = await callTool("recall", { query: "CROSS_JP トランスフォーマー self-attention", topK: 1 });
  assert(q2.results[0].text.includes("CROSS_JP"), "JP query -> JP item");

  // Partial match via char trigrams
  await callTool("remember", { text: "PARTIAL: Elasticsearch provides full-text search" });
  const q3 = await callTool("recall", { query: "PARTIAL Elastic search", topK: 1 });
  assert(q3.results[0].text.includes("PARTIAL"), "partial Elastic -> Elasticsearch",
    "got: " + q3.results[0].text.substring(0, 50));
}

async function testScoreBreakdown() {
  section("Score Breakdown");

  await callTool("remember", { text: "SCORE_TEST: artificial intelligence is transformative technology" });
  const q = await callTool("recall", { query: "SCORE_TEST artificial intelligence", topK: 1 });
  const r = q.results[0];

  assert(typeof r.score === "number", "has total score");
  assert(typeof r.scoreVisible === "number", "has visible score");
  assert(typeof r.scoreDark === "number", "has dark score");
  assert(typeof r.scoreBM25 === "number", "has BM25 score");
  assert(r.scoreBM25 > 0, "BM25 > 0 for exact match");
  assert(r.score > 0, "total > 0");

  console.log("  score=" + r.score + " vis=" + r.scoreVisible +
    " dark=" + r.scoreDark + " bm25=" + r.scoreBM25);
}

async function testRecallPrefilter() {
  section("Recall Pre-filter (inverted index)");

  // With many items, pre-filter should still find the right ones
  for (let i = 0; i < 20; i++) {
    await callTool("remember", { text: "PREFILTER_NOISE_" + i + " random filler content number " + i });
  }
  await callTool("remember", { text: "PREFILTER_TARGET: specific quantum chromodynamics QCD" });

  const q = await callTool("recall", { query: "PREFILTER_TARGET quantum chromodynamics QCD", topK: 1 });
  assert(q.results[0].text.includes("PREFILTER_TARGET"), "found target among noise",
    "got: " + q.results[0].text.substring(0, 50));
}

// ============================================================
// Runner
// ============================================================

async function main() {
  console.log("Starting κ-Memory test suite (MCP Client SDK)...\n");

  try {
    await client.connect(transport);
    console.log("Connected to server OK");

    await testToolList();
    await testBasicRememberRecall();
    await testContextSeeding();
    await testBM25AccuracyBulk();
    await testDarkSectorLearning();
    await testTierPromotion();
    await testForget();
    await testDeleteMemory();
    await testSnapshotSaveLoad();
    await testSnapshotMerge();
    await testListMemory();
    await testStats();
    await testSessionGuide();
    await testEdgeCases();
    await testCrossLanguagePartial();
    await testScoreBreakdown();
    await testRecallPrefilter();

  } catch (err) {
    console.log("\nFATAL: " + (err as Error).message);
    console.log((err as Error).stack);
    failed++;
  } finally {
    try { await client.close(); } catch {}
    try { await fs.rm(SNAPSHOT_DIR, { recursive: true }); } catch {}
  }

  console.log("\n========================================");
  console.log("PASSED: " + passed);
  console.log("FAILED: " + failed);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) console.log("  - " + f);
  }
  console.log("========================================");

  process.exit(failed > 0 ? 1 : 0);
}

main();
