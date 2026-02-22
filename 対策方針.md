# Messenger IME改行問題 対策方針

## 問題概要

Facebook Messenger で、IME（Google日本語入力 / macOS標準IME）使用時に Enter で改行されない。

## 原因

### 前提: SILHack の Messenger 改行処理

- `keydown` capture phase で `stopImmediatePropagation()` → Messenger(Lexical)の送信ハンドラをブロック
- `preventDefault()` は呼ばない → ブラウザのデフォルト動作に改行を委ねる設計

### Messenger(Lexical)の改行処理は2段構え

1. **主要パス**: `keydown` → Lexical内部 `KEY_ENTER_COMMAND` → 改行挿入
2. **フォールバック**: `beforeinput` (`insertParagraph`) → 改行挿入

SILHack の `stopImmediatePropagation()` は主要パス(1)をブロックする。
非IME時はフォールバック(2)が正常に動くので改行できる。

### IME使用時に壊れる2つの要因

#### 要因A: IME確定Enterの誤認識

Google日本語入力 / macOS IME では、変換確定時に `compositionend` が `keydown` の**前に**発火するケースがある。

```
compositionend          ← 先に来る
keydown (isComposing: false, keyCode: 13)  ← 確定Enterなのに isComposing=false
```

content.js 94行目の IME ガード `event.isComposing || event.keyCode === 229` をすり抜ける。
確定のための Enter が「通常の Enter（＝改行）」として誤処理される。

#### 要因B: IME直後の beforeinput の挙動差異

IME確定直後の Enter では、ブラウザが `beforeinput` の `insertParagraph` を正しく発火しないケースがある（Chrome の IME 統合の既知問題）。

結果:
1. `keydown` → SILHack が `stopImmediatePropagation()` → Lexical の主要パスをブロック
2. `beforeinput` → IME直後なので正しく発火しない
3. → どちらのパスでも改行が処理されない

## 修正方針

### `compositionend` を監視して直後の Enter をスキップする

content.js に以下を追加:

```javascript
let justComposed = false;
document.addEventListener('compositionend', () => {
  justComposed = true;
  requestAnimationFrame(() => { justComposed = false; });
}, true);
```

`handleKeydown` の IME チェック（94行目）を拡張:

```diff
- if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) {
+ if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || justComposed) {
+   justComposed = false;
    return;
  }
```

### 修正の狙い

- IME確定の Enter → `justComposed = true` → SILHack がスキップ → Lexical本来の処理に任せる
- `requestAnimationFrame` で1フレーム後にフラグをリセット → 次の「本当の改行Enter」には影響しない
- 全サイト共通の修正なので Messenger 以外のサイトでも IME 周りの安定性が向上する

### 注意点

- `requestAnimationFrame` のタイミングで十分かは要検証（環境によっては `setTimeout(_, 100)` 程度が必要かもしれない）
- Messenger 以外のサイト（ChatGPT, Slack, Gemini, Perplexity）でも同様の問題が起きていないか確認が必要

## Codexレビュー（2026-02-14）

### 結論

この対策方針は妥当。特に `compositionend` 直後 Enter の取りこぼしを拾う方向は有効。

### 妥当な点

- 現在の IME ガードは `event.isComposing || event.keyCode === 229` のみで、取りこぼしが発生しうる。
- Messenger 分岐の plain Enter で `stopImmediatePropagation()` しているため、実装差異で改行が消える余地がある。
- `justComposed` で確定 Enter のみ自前処理を回避する設計は、回帰を小さく抑えやすい。

### 注意点（追加）

- `requestAnimationFrame` 1フレームだけでは環境差で短い可能性がある。
- まず Messenger 限定で導入し、回帰範囲を絞るのが安全。
- `keyup` ブロック (`enterHandledOnKeydown` 系) との相互作用は実機確認が必要。

### 実装順（推奨）

1. Messenger 限定で `justComposed` を導入する。
2. まず `requestAnimationFrame` 版で検証する。
3. 改善が不十分な環境のみ `setTimeout`（80-150ms目安）へ拡張する。
