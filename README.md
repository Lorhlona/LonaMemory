# κ-Memory

BC代数 **w = z₊e₊ + z₋e₋** に基づくAI長期記憶MCPサーバー。

外部API完全不要。BM25転置索引で初日から検索精度100%、暗黒セクター(z₋)の共起学習で使うほど連想が育つ。Schur補完 W₀≈10.1 で暗黒セクターが検索を増幅する。

## アーキテクチャ

```
Query → bm25Tokenize → Inverted Index → 候補集合
                                            ↓
        textToPhaseVector → z₊ phase sim ──→ Blend (0.7 BM25 + 0.3 phase)
                                            ↓
                           z₋ dark sim ──→ BC Score: p₊·visible + p₋·W₀·dark
                                            ↓
                        Amplitude (adaptive Hebbian) → Top-K Results
                                            ↓
                        Co-access → z₋ dark sector update (top-3 coupling)
```

### 三層構造

| 層 | 役割 | 手法 |
|----|------|------|
| **BM25** (70%) | 正確なトークンマッチング | 転置索引 + IDF重み付け |
| **Phase** (30%) | Fuzzy/部分一致 | Multi-scale simhash (64-dim) |
| **Dark Sector** | 学習済み連想 | 共起パターンからの自動学習 × W₀≈10.1増幅 |

## セットアップ

```bash
cd /path/to/LonaMemory
npm install
```

## MCP設定

Claude Code の `~/.claude.json` または各IDE設定に追加:

```json
{
  "mcpServers": {
    "kappa-memory": {
      "command": "npx",
      "args": ["tsx", "/path/to/LonaMemory/index.ts"],
      "env": {
        "KAPPA_MEMORY_SNAPSHOT": "/path/to/snapshot.json"
      }
    }
  }
}
```

`KAPPA_MEMORY_SNAPSHOT` を指定すると起動時に自動ロードされる。

## 使い方

### 記憶する

```
remember({text: "ユーザーはダークモードを好む"})
remember({text: "APIキーは環境変数に保存", context: "セキュリティ設定"})
```

`context` を渡すと暗黒セクターの初期シードになり、連想検索が即座に強化される。

### 思い出す

```
recall({query: "ユーザーの好み", topK: 5})
```

返却値:

```json
{
  "results": [{
    "text": "ユーザーはダークモードを好む",
    "context": null,
    "score": 0.85,
    "scoreVisible": 0.83,
    "scoreDark": 0.12,
    "scoreBM25": 0.91,
    "tier": 1,
    "tierName": "Peripheral"
  }]
}
```

一緒にrecallされた記憶同士は暗黒セクターで自動的に結びつく（top-3 coupling）。

### 忘却

```
forget()
```

Fisher計量 g_θθ = sech²θ × PT束縛エネルギーで階層別に減衰:

| 階層 | 条件 | 減衰速度 | PT固有状態 |
|------|------|---------|-----------|
| Core | アクセス≥15回 | 極遅 (q³) | sech³θ, ε=-9 |
| Working | 5-14回 | 中 (q²) | sech²θ·tanhθ, ε=-4 |
| Peripheral | <5回 | 速い (q¹) | sechθ·(5tanh²θ-1), ε=-1 |

Core記憶はほぼ消えない。Peripheral記憶は確率的に削除される。

### 永続化

```
save_snapshot({path: "/path/to/snapshot.json"})
load_snapshot({path: "/path/to/snapshot.json"})
load_snapshot({path: "/path/to/snapshot.json", clear: false})  # 既存記憶とマージ
```

マージ時の戦略: 新しいテキスト優先、amplitude/accessCountはmax、z₋は加重平均。
旧LonaMemory形式からの自動マイグレーション対応。

### その他

```
list_memory({limit: 50})       # 記憶一覧
delete_memory({id: "..."})     # 個別削除
stats()                        # 統計・κ物理定数
session_guide()                # 使い方ガイド
```

## κ物理学との対応

| κ物理学 | κ-Memory |
|---------|----------|
| w = z₊e₊ + z₋e₋ | 各記憶 = 可視(BM25+phase) + 暗黒(共起学習) |
| e₊e₋ = 0 (零因子) | 暗黒セクターは直接クエリ不可、スコアに寄与のみ |
| Schur補完 W₀ = (1+κ)²/4 | 暗黒セクター類似度を最大10.1倍に増幅 |
| p₊ = 15.7%, p₋ = 84.3% | 可視16%:暗黒84%の情報配分 |
| PT固有値 s=3, ε = -9,-4,-1 | 3世代メモリ階層 Core/Working/Peripheral |
| 36q³ − 12q + 1 = 0, q=0.530 | 階層間の減衰比率 |
| (1+κ)³ = 48κ, κ=5.3603 | 全体の構造定数 |

## 設計思想

位相ベクトル(z₊)だけでは検索精度に限界がある — 宇宙のバリオンが全質量の16%しかないのと同じ構造。BM25転置索引がこの可視セクターを補強し、初日から100%の検索精度を実現する。

**使い込むほど暗黒セクター(z₋)が育ち、テキストが違っても文脈で引き出せるようになる。** BM25が「正確に探す」、暗黒セクターが「連想で見つける」、PT階層が「重要なものを残す」。三位一体の記憶システム。

### Amplitude適応スケーリング

Hebbian amplitudeはBM25の信頼度に応じて適応的に効く:

- **精密クエリ** (BM25高) → amplitude影響最小 (exp=0.05)、検索精度を維持
- **曖昧クエリ** (BM25低) → amplitude影響大 (exp=0.45)、よく使う記憶が浮上

## テスト

```bash
npx tsx test.ts
```

71テスト: BM25精度, 暗黒セクター学習, tier昇格, forget減衰, snapshot merge, edge cases

## 既存メモリとの比較

| | Mem0 / Zep等 | κ-Memory |
|---|---|---|
| 検索 | embedding API必須 | **ローカル完結** (BM25+phase) |
| 初期精度 | 90%+ (API依存) | **100%** (BM25) |
| 連想 | なし or embedding頼り | **暗黒セクター自動学習** |
| 忘却 | TTL or 手動削除 | **PT階層で物理的減衰** |
| 外部依存 | OpenAI等 | **なし** |
| 理論的裏付け | なし | **κ物理学 BC代数** |

## ライセンス

LoNalogy Theory — Lona, 2026
