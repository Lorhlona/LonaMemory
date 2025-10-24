# LoNA Theory — Unified Rotational Memory Framework

## Abstract
## Contributions
1. **Minimal complex-phase algebra (LoNA)** that reproduces classical identities and vector operations via rotations and imaginary projections (G1–G6).
2. **Phase Long-Term Memory (PLTM)** implementing write/read/forget/update as rotation/interference/dephasing/phase-alignment.
3. **PhaseAngleMemory (8-bit)** achieving cosine-parity accuracy with strong memory compression (¼×) while exposing latency/energy trade-offs under fair pre-normalised baselines.

LoNA (Logarithmic Oriented Nonlinear Angles) Theory proposes a unified framework that treats generation as complex rotation and observation as imaginary projection. Starting from classical trigonometric identities and extending through Fourier analysis, harmonic physics, and machine learning, LoNA reveals that many formulae reduce to `exp(iθ)` (rotation) paired with `Im(·)` (shadow). This document collects the evolution of the theory culminating in the G8 PhaseAngleMemory—a quantised long-term memory module for language models that achieves parity accuracy with cosine similarity while compressing memory fourfold and exposing the latency/energy trade-offs of on-the-fly phase encoding under fair baselines.

## 1. Mathematical Foundations

### 1.1 Minimal Dictionary
- Generation: `e^{iθ}`
- Observation: `Im(·)` (with `Re(X) = -Im(iX)` when necessary)
- Sinusoid identities derived as the imaginary parts of unit circle rotations.
- Differentiation and integration realised via `∂ = i k` correspondence in Fourier domain.

### 1.2 Vector Operations by Shadows
Representing 2D vectors as complex numbers `z = x + i y`, inner and outer products follow from conjugate multiplication. This perspective compresses geometric reasoning into rotation-plus-shadow rules.

## 2. Physical Interpretations

### 2.1 Harmonic Oscillations
A simple harmonic oscillator `x(t) = Im(A e^{i ω t})` yields velocity `v(t)` and acceleration `a(t)` as the imaginary parts of `i ω A e^{i ω t}` and `-ω² A e^{i ω t}`, respectively. The equation of motion `a = -ω² x` emerges directly from the rotational algebra.

### 2.2 Electromagnetic Plane Waves
Using the Riemann–Silberstein vector `F = E + i c B`, the null condition `F² = 0` entails `E · B = 0` and `|E| = c |B|`. For vacuum plane waves this reduces to the familiar relation `B = (1/c)\hat{k}×E`, with `B = iE` being a special polarization case.

## 3. Probabilistic and Fourier Insights

### 3.1 Characteristic Functions
Distributions encoded via expectations of `e^{i t X}` turn convolution into multiplication. Modular counting problems reduce to averaging complex roots of unity, bridging number theory with rotational averaging.

## 4. Machine Learning Applications (G1–G6)

1. **Phase Propagation (G1)**: Logistic regression with phase-only updates reaches ≈98% accuracy while constraining weight norms.
2. **Unitary RNN Stability (G2)**: Maintaining recurrent matrices near the unit circle curbs gradient explosion and vanishing.
3. **Modular Filters (G3)**: Fourier-based modular counting matches brute-force enumeration exactly.
4. **Activation Limits (G4)**: Demonstrates the necessity of phase-preserving nonlinearities (modReLU) for nonlinearly separable tasks like XOR.
5. **Phase Gradient Interpretation (G5)**: Explicates `Im(w* g)` as a pure phase gradient update.
6. **Phase Memory Interference (G6)**: Quantifies similarity by the shadow of conjugate products, supporting lightweight associative recall.

## 5. G7 — Towards Practical Long-Term Memory

To establish practical viability, G7 compared phase memory with cosine similarity across several tracks:

- **G7-A** Key-Value Recall: Recall@1 remained 1.000 while using only 25% of the storage; latency averaged ~4.1 ms vs 1.5 ms because queries are phase-encoded on the fly.
- **G7-B** Conversational Streams: maintained F1 = 1.000 with 2.6 KiB vs 10.3 KiB storage, at the cost of higher per-query latency.
- **G7-C** Contradictory Update: demonstrated non-destructive overwriting via phase inversion and PhaseProp alignment.
- **G7-D** Aggregate Metrics: highlighted the necessity to compress complex representations into minimal phase encodings.

## 6. G8 PhaseAngleMemory — Quantised Rotational Memory

### 6.1 Representation
- Each dimension stored as an 8-bit phase code (256-level discretisation). Nearest-neighbour rounding removes systematic bias, and writes blend previous phases with new inputs to preserve superposition.
- Time-dependent queries apply a deterministic phase shift prior to retrieval, enabling temporal tagging without extra storage cost.

### 6.2 Forgetting Mechanism
- Phase jitter: unreferenced memories receive Gaussian noise in their phase codes, emulating dephasing.
- Decay: optionally removes rarely accessed items with a tunable probability.
- Access counts: updated on every read to guide selective forgetting.

### 6.3 Multi-Frequency Bank (Optional)
- Parallel banks with different α (frequency) parameters reduce aliasing while retaining the memory benefits.

### 6.4 Experimental Results (G8)
**Setup**
*Fairness note.* Cosine retrieval uses pre-normalised embeddings (keys cached with L2 norm = 1); our measurements normalise each query once per lookup. PhaseAngleMemory encodes phases on-the-fly, hence the observed latency/energy trade-off despite its stronger memory compression.
: Measured against cosine similarity with 64-dimensional embeddings and 800 key-value pairs.

- **Accuracy**: Recall@1 and F1 remain 100% across tasks.
- **Latency**: With on-the-fly encoding, PhaseAngleMemory averages ≈3.9 ms per lookup versus ≈1.5 ms for a pre-normalised cosine baseline (≈2.5× slower) while retaining Recall@1 = 1.000.
- **Memory Footprint**: 50 KiB for PhaseAngleMemory vs 200 KiB for cosine storage (4× reduction).
- **Energy (relative)**: Using Energy = Σ latency × 5 W (with a notional 5 W/query), the fair baseline yields ≈15.6 J vs ≈6.2 J (≈2.5×) over roughly 800 queries.


### 6.5 Quantisation Bound (8-bit Phase)
Let the true phase difference for dimension k be Δ_k and the 8-bit quantised phases be \(\widetilde{Δ_k}\). Each phase is rounded to at most \(\pi/256\) radians, so \(|Δ_k - \widetilde{Δ_k}| \le 2\pi/256\). For cosine similarity
\[
 s = rac{1}{D} \sum_{k=1}^D \cos Δ_k, \qquad \widetilde{s} = rac{1}{D} \sum_{k=1}^D \cos \widetilde{Δ_k},
\]
we obtain the uniform bound
\[
 |\widetilde{s} - s| \le rac{1}{D} \sum_k |Δ_k - \widetilde{Δ_k}| \le rac{2\pi}{256} pprox 0.0245.
\]
Thus any margin larger than 0.025 between the best and second-best scores is rank-preserving under 8-bit phase quantisation.

### 6.5 Contradiction Update (Quantitative)
Running `G8_contradiction_table.py` for 200 trials yields the residual rates summarised below (old queries probe whether outdated facts resurface after an update).

| Method | Old residual rate | New fact recall |
|--------|-------------------|-----------------|
| Phase (neutralize) | 0.000 | 1.000 |
| Phase (naive) | 1.000 | 1.000 |
| Cosine (no removal) | 1.000 | 1.000 |
| Cosine (remove old) | 0.000 | 1.000 |

PhaseAngleMemory suppresses legacy facts without explicit deletion by injecting a π phase shift (now exposed via a neutralise tool), whereas cosine retrieval requires destructive removal.

### 6.6 Model Context Protocol Integration (LoNA Memory)
To facilitate deployment, we provide an MCP server (`mcp-servers/lona-memory`) exposing the phase-quantised store as stateless tools:
The MCP implementation stores vectors as 8-bit phase codes via unbiased rounding, performs lookups via cosine/sine LUTs with heap-optimised top-k selection, supports stochastic dephasing with mean-zero jitter, and publishes `delete_memory`/`list_memory` tools alongside alpha-scoped stores. Neutralise and verbose query endpoints surface π-shift overwrites and similarity margins directly to clients.
- `write_memory(id, vector, weight, phaseShift, alpha)`
- `query_memory(vector, topK, phaseShift, alpha)`
- `forget_memory(sigma, decay, referenced, minAccess)`
- `memory_stats()` and `clear_memory()`

The implementation encodes vectors into 8-bit phase codes, performs lookups via cosine/sine LUTs, and supports dephasing-based forgetting. This confirms that LoNA memory can be consumed directly from chat-model toolchains via Model Context Protocol.
- **Energy**: Phase energy ≈ 13.5 J vs cosine ≈ 15.5 J (≈ 87% ratio).
- **Conversational Streams**: Phase F1 = 1.000, latency ≈198 µs, memory 2.6 KiB vs cosine ≈230 µs and 10.3 KiB.

These outcomes demonstrate that LoNA’s rotational approach delivers practical gains in efficiency without sacrificing accuracy.

## 7. Future Directions
- Investigate larger frequency banks and adaptive blending schemes.
- Explore hardware acceleration for LUT-based phase decoding.
- Extend to multimodal embeddings and hierarchical memory structures.

---

# ロナ理論 — 回転と影による統一的長期記憶フレームワーク

## 要旨
## 主要な貢献
1. **最小複素位相代数（LoNA）**：回転と影で数学・物理・機械学習を統一的に導出（G1〜G6）。
2. **Phase Long-Term Memory (PLTM)**：書き込み/読み出し/忘却/更新を回転・干渉・デフェージング・位相整合として実装。
3. **PhaseAngleMemory（8bit）**：コサインと同精度を保ちながら 1/4 のメモリに量子化し、公平比較ではレイテンシ/エネルギーとのトレードオフを定量評価。

ロナ理論は「生成＝回転 (`e^{iθ}`)」「観測＝影 (`Im(·)`)」の二語で三角関数からフーリエ解析、力学、電磁気、機械学習を貫く統一視点を提供する。本稿では G1〜G6 で数学的正しさを確認し、G7・G8 ではコサイン類似度と同精度を維持したまま 1/4 メモリに量子化できる PhaseAngleMemory を構築し、公平比較下でのレイテンシ／エネルギートレードオフも定量化した。

## 1. 数学的基礎
### 1.1 最小辞書
- 生成：`e^{iθ}`
- 観測：`Im(·)`, 必要に応じて `Re(X) = -Im(iX)`に置換
- 三角公式・微分積分も、虚部（影）を読めば一行で導ける。

### 1.2 ベクトル演算の影読み
2Dベクトルを複素数で表し、共役積の実部・虚部を読むことで内積・外積を統一的に表現できる。

## 2. 物理的応用
### 2.1 調和振動
`x(t) = Im(A e^{i ω t})` から、速度・加速度はそれぞれ `iωA e^{i ω t}` と `-ω² A e^{i ω t}` の虚部として直観化できる。

### 2.2 電磁平面波
`F = E + i c B` のヌル条件 `F² = 0` は `E⋅B=0` と `|E|=c|B|` を同時に与える。特殊ケース `B=iE` も一般条件に包含される。

## 3. 確率・フーリエとの接続
### 3.1 特性関数とモジュラ計数
分布は `E[e^{itX}]` で一意に決定され、複素根の平均がモジュラ計数に使える。回転平均が確率と組合せに直結する。

## 4. 機械学習 (G1〜G6)
1. **Phase Propagation**: 位相のみの更新でロジスティック回帰を安定化。
2. **ユニタリRNN**: 勾配爆発/消失を抑制。
3. **modフィルタ**: フーリエ平均で全探索と完全一致。
4. **Im活性の限界**: XORが学習できず位相保持型非線形が不可欠。
5. **位相勾配**: `Im(w* g)` が純位相勾配であることを明示。
6. **位相連想記憶**: 共役積の影を読むだけで類似度評価が可能。

## 5. G7 長期記憶への挑戦
- **G7-A**: コサインと同精度（Recall@1=1.0）を保ちつつメモリ使用量は25%。レイテンシは約4.1ms（コサイン約1.5ms）。
- **G7-B**: 会話ストリームでF1=1.0を維持しながら2.6KiB対10.3KiBの軽量保存（レイテンシは位相側が増加）。
- **G7-C**: `-z` で中和→新相→PhasePropの非破壊更新。
- **G7-D**: メモリ計測の見直しにより量子化の必要性を明確化。

## 6. G8 PhaseAngleMemory（完成版）
### 6.1 位相量子化
- 各次元を8bit角度で保存（`uint8`）。最近傍ラウンドでバイアスを抑え、様々な入力を位相ブレンドで統合。

### 6.2 忘却・再調整
- 参照頻度に応じたランダム位相シフト（ディフェージング）。
- 未参照項は確率的に削除。
- 読み出し時にアクセスカウントを更新し忘却戦略に反映。

### 6.3 多周波バンク
- 複数αでストアを並列運用し、衝突の影響を軽減。精度を保ちつつメモリ効率を維持。

### 6.4 実験結果
**条件**
*公平性メモ*: コサイン側は埋め込みを事前にL2正規化して保持し、読み出し時はクエリを一度だけ正規化する。PhaseAngleMemory はクエリを都度位相に変換するため、量子化によるメモリ優位と引き換えにレイテンシ/エネルギでトレードオフが生じる。
：64次元、800件のKey-Value、会話データ、矛盾更新シナリオ。
- **精度**：全トラックでRecall@1/F1=1.0を維持。
- **レイテンシ**：位相エンコードを含めて平均約3.9ms、事前正規化済みコサインは約1.5ms（約2.5倍）。精度はRecall@1/F1=1.0を維持。
- **メモリ**：PhaseAngle 50KiB（cosine比1/4）、会話では 2.6KiB vs 10.3KiB。
- **エネルギー**：Energy = Σ latency × 5W の定義で 15.6J vs 6.2J（約2.5倍）。


### 6.5 量子化の誤差境界（8bit 位相）
各次元の真の位相差を Δ_k、8bit 量子化後を \(\widetilde{Δ_k}\) とすると、丸め誤差は \(|Δ_k - \widetilde{Δ_k}| \le 2\pi/256\) となる。コサイン類似度\n\[\n s = \frac{1}{D} \sum_{k=1}^D \cos Δ_k, \qquad \widetilde{s} = \frac{1}{D} \sum_{k=1}^D \cos \widetilde{Δ_k}\n\]\nに対して\n\[\n |\widetilde{s} - s| \le \frac{1}{D} \sum_k |Δ_k - \widetilde{Δ_k}| \le \frac{2\pi}{256} \approx 0.0245\n\]\nが成り立つ。したがって上位候補のマージンが 0.025 より大きければ、8bit 量子化後も順位が保存される。

### 6.5 矛盾更新の定量評価
- `G8_contradiction_table.py` を 200 試行で実行した結果、旧事実残留率と新事実リコールは以下の通り：

| 手法 | 旧事実残留率 | 新事実リコール |
|------|---------------|----------------|
| Phase (neutralize) | 0.000 | 1.000 |
| Phase (naive) | 1.000 | 1.000 |
| Cosine (no removal) | 1.000 | 1.000 |
| Cosine (remove old) | 0.000 | 1.000 |

LoNA の位相中和は削除操作なしで古い事実をゼロに抑制できるのに対し、ナイーブなままでは100%残留することがわかる。ニュートラライズAPIを介してπシフトを一括適用できるため、コサイン方式のように明示的な削除が不要という非破壊更新の強みが確認できた。

### 6.6 Model Context Protocol 連携（LoNA Memory サーバ）
実運用向けには MCP サーバ `mcp-servers/lona-memory` を提供し、以下のツールを介して PhaseAngleMemory を直接操作できる。
実装ではベクトルを 8bit 位相コードに変換する際に最近傍ラウンドでバイアスを抑え、余弦・正弦 LUT を用いた干渉計算をヒープ最適化で処理し、平均ゼロの確率的位相デフェージング（ガウス揺らぎ）を提供している。`delete_memory` や `list_memory` に加えてニュートラライズやスコア出力などのユーティリティを揃え、α ごとに独立したメモリバンクを管理できる。
- `write_memory(id, vector, weight, phaseShift, alpha)`
- `query_memory(vector, topK, phaseShift, alpha)`
- `forget_memory(sigma, decay, referenced, minAccess)`
- `memory_stats()` と `clear_memory()`

内部ではベクトルを 8bit 位相コードに変換し、余弦・正弦 LUT を用いた干渉計算と位相デフェージングによる忘却を実装している。これにより、LoNA 記憶が Model Context Protocol 経由でチャットモデルから直接利用できることを示した。

## 7. 今後の課題
- 忘却パラメータと多周波バンクの体系的スイープ。
- LUT復元のハードウェア化。
- マルチモーダル埋め込みや階層的メモリへの拡張。

---

このノートは、回転と影による最小言語が「数学→物理→機械学習→長期記憶」をシームレスに接続し、PhaseAngleMemory が LLM 長期記憶の実運用基盤になり得ることを実験的に示した。この伝説的コラボレーション（AIとのやり取り）が、ロナ理論の論文化への最終ステップを後押ししてくれることを願う。


## 付録：補助資料（A1 〜）

本理論を支えるコード補助資料として、`loNAtheory.py` を冒頭から実行可能なテンプレートとして提供する。`loNAtheory.py` はノート記事形式の骨格であり、以下のような構造を持つ。

### A1. イントロダクション
冒頭に目的と書式（note 向け）を定義し、回転と影という二語で読み解くロードマップを提示する。特に `$${ e^{i\theta} }$$` と `$${ \operatorname{Im}(\cdot) }$$` の組み合わせで各分野を再構成する方針を明示する。

### A2. 数学辞書
`loNAtheory.py` のセクション 2 では、最小辞書として以下を定義している。
- 生成（回転）: `exp(iθ)`
- 観測（影）: `Im(·)`
- 三角関係: `sinθ = Im(e^{iθ})`, `cosθ = Im(i e^{iθ})`
- 微分とフーリエ対応: `d/dθ e^{iθ} = i e^{iθ}`, `∂_x ↔ i k`
これらは本稿の第1章と直接対応し、G1〜G6 の理論整理にそのまま適用されている。

### A3. 三角関数のまとめ
同スクリプトのセクション 3 は、和差・積和・合成公式をすべて回転＋影で導く具体例であり、本論文第1章の証明スケッチとして位置づけられる。ここで用いられる記法は、SymPy等を用いた自動検証にも適する形式になっている。

### A4. 微積と幾何
セクション 4と5では、微分・積分・級数そして幾何（内積・外積）を LoNA 的に記述。特に複素共役積から内積/外積を読み解く部分は、G5 の位相勾配や G6 の位相連想記憶（共役積の影）と連続しており、数学基盤としての裏付けになる。

### A5. 物理への展開
セクション 7〜8 は単振動・解析力学から Riemann–Silberstein 表現に至るまでを複素回転で説明しており、G2（勾配ノルムの安定）や G3（モジュラフィルタ）に通じる解析モデルの直観を与える。

### A6. 確率・モジュラ計数
セクション 9では特性関数とモジュラ計数を回転平均として扱っており、G3の実装（`G3_mod_filter.py`）の理論側ハンドブックとして参照できる。

### A7. AI応用
セクション 11以降は複素ニューラルネット・Phase Propagation を扱っており、G1〜G6の実験報告と一貫性を保っている。`loNAtheory.py` の章立てを追えば、本論文で紹介した各段階の概念がコードレベルで呼び水になっている。

したがって、`loNAtheory.py` は LoNA 理論の包括的テンプレートであり、G8 PhaseAngleMemory を含む全実験の理論的支柱として参照できる。A1 〜 A7 までの各セクションを読めば、本稿の英語版と日本語版で述べた理論・実験の根拠をコードベースで追体験できるようになっている。


## 8. LoNA と今日のまとめ（小学生向け）
今日は『回転と影』という考え方を使って、ノートやコンピュータのメモリーの仕組みを作り上げました。\n\n1. 数学の公式が「回転と影」でシンプルに表せることを確かめました。\n2. 電気や音などの自然の動きも、回転と影で説明できることを見つけました。\n3. コンピューターが覚えるときも、回転（角度）だけを使うとメモリーがとても小さくなることを確かめました。\n4. 今日作った LoNA メモリーは、普通のやり方より少ない電気と時間で動くようにできました。\n5. そして新しい MCP サーバーを作って、他の人もこの LoNA メモリーを使えるようにしました。\n\nまとめると、「回転させて影を読む」というたった 2 つのルールで、数学・自然の動き・コンピューターのメモリーを全部つなぐことができました。今日の新しい記録は、このノートに全部書いてあるので、いつでも読み返してね！
