# κ-Memory

BC代数 **w = z₊e₊ + z₋e₋** に基づくAI長期記憶MCPサーバー。

外部API完全不要。BM25転置索引で初日から検索精度100%、暗黒セクター(z₋)の共起学習で使うほど連想が育つ。Schur補完 W₀≈10.1 で暗黒セクターが検索を増幅する。

*An AI long-term memory MCP server based on BC algebra **w = z₊e₊ + z₋e₋**. No external API required. 100% retrieval accuracy from day one via BM25 inverted index, with co-access learning in the dark sector (z₋) that grows associative connections over use. Schur complement W₀≈10.1 amplifies dark sector retrieval.*

## アーキテクチャ / Architecture

```
Query → bm25Tokenize → Inverted Index → Candidate Set
                                            ↓
        textToPhaseVector → z₊ phase sim ──→ Blend (0.7 BM25 + 0.3 phase)
                                            ↓
                           z₋ dark sim ──→ BC Score: p₊·visible + p₋·W₀·dark
                                            ↓
                        Amplitude (adaptive Hebbian) → Top-K Results
                                            ↓
                        Co-access → z₋ dark sector update (top-3 coupling)
```

### 三層構造 / Three-Layer Structure

| Layer | Role | Method |
|-------|------|--------|
| **BM25** (70%) | Precise token matching | Inverted index + IDF weighting |
| **Phase** (30%) | Fuzzy/partial matching | Multi-scale simhash (64-dim) |
| **Dark Sector** | Learned associations | Auto-learned co-access patterns × W₀≈10.1 amplification |

## セットアップ / Setup

```bash
cd /path/to/LonaMemory
npm install
```

## MCP設定 / MCP Configuration

Add to Claude Code `~/.claude.json` or your IDE settings:

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

Setting `KAPPA_MEMORY_SNAPSHOT` enables auto-load on startup.

## 使い方 / Usage

### Remember

```
remember({text: "User prefers dark mode"})
remember({text: "API keys stored in env vars", context: "security config"})
```

Passing `context` seeds the dark sector (z₋), immediately strengthening associative retrieval.

### Recall

```
recall({query: "user preferences", topK: 5})
```

Response:

```json
{
  "results": [{
    "text": "User prefers dark mode",
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

Memories recalled together are automatically linked via dark sector coupling (top-3).

### Forget

```
forget()
```

Decay via Fisher metric g_θθ = sech²θ × PT binding energy, stratified by tier:

| Tier | Condition | Decay Rate | PT Eigenstate |
|------|-----------|------------|---------------|
| Core | Access ≥ 15 | Very slow (q³) | sech³θ, ε=-9 |
| Working | 5–14 | Medium (q²) | sech²θ·tanhθ, ε=-4 |
| Peripheral | < 5 | Fast (q¹) | sechθ·(5tanh²θ-1), ε=-1 |

Core memories are nearly permanent. Peripheral memories are probabilistically removed.

### Persistence

```
save_snapshot({path: "/path/to/snapshot.json"})
load_snapshot({path: "/path/to/snapshot.json"})
load_snapshot({path: "/path/to/snapshot.json", clear: false})  // merge with existing
```

Merge strategy: newer text wins, max(amplitude, accessCount), weighted average for z₋.
Auto-migration from legacy LonaMemory format supported.

### Other Tools

```
list_memory({limit: 50})       // list memories
delete_memory({id: "..."})     // delete by ID
stats()                        // statistics & κ physics constants
session_guide()                // usage guide
```

## κ Physics Correspondence

| κ Physics | κ-Memory |
|-----------|----------|
| w = z₊e₊ + z₋e₋ | Each memory = visible (BM25+phase) + dark (co-access learning) |
| e₊e₋ = 0 (zero divisor) | Dark sector cannot be queried directly, only contributes to score |
| Schur complement W₀ = (1+κ)²/4 | Amplifies dark sector similarity up to 10.1× |
| p₊ = 15.7%, p₋ = 84.3% | Visible 16% : Dark 84% information ratio |
| PT eigenvalues s=3, ε = -9,-4,-1 | 3-generation memory hierarchy: Core/Working/Peripheral |
| 36q³ − 12q + 1 = 0, q=0.530 | Inter-tier decay ratios |
| (1+κ)³ = 48κ, κ=5.3603 | Master structural constant |

## 設計思想 / Design Philosophy

Phase vectors (z₊) alone have limited retrieval accuracy — mirroring how baryonic matter accounts for only 16% of the universe's mass. The BM25 inverted index reinforces this visible sector, achieving 100% retrieval accuracy from day one.

**The more you use it, the more the dark sector (z₋) grows, enabling retrieval by context even when text differs.** BM25 "finds precisely", the dark sector "finds by association", and the PT hierarchy "preserves what matters". A trinity of memory.

### Adaptive Amplitude Scaling

Hebbian amplitude adapts to BM25 confidence:

- **Precise query** (high BM25) → minimal amplitude effect (exp=0.05), preserving retrieval accuracy
- **Vague query** (low BM25) → strong amplitude effect (exp=0.45), frequently-used memories surface

## テスト / Tests

```bash
npx tsx test.ts
```

71 tests: BM25 accuracy, dark sector learning, tier promotion, forget decay, snapshot merge, edge cases

## Comparison with Existing Memory Systems

| | Mem0 / Zep etc. | κ-Memory |
|---|---|---|
| Search | Embedding API required | **Fully local** (BM25+phase) |
| Initial accuracy | 90%+ (API-dependent) | **100%** (BM25) |
| Association | None or embedding-based | **Dark sector auto-learning** |
| Forgetting | TTL or manual deletion | **Physics-based PT decay** |
| External deps | OpenAI etc. | **None** |
| Theoretical basis | None | **κ Physics / BC Algebra** |

## License

LoNalogy Theory — Lona, 2026
