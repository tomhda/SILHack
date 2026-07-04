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

### `compositionend` を監視して直後の Enter を消費する

Messenger の入力欄で `compositionend` が起きたら、短時間だけ「次の Enter は IME 確定キー」とみなす。
該当 Enter は `preventDefault()` + `stopImmediatePropagation()` で消費し、Messenger の送信ハンドラへ渡さない。

### 修正の狙い

- IME確定の Enter → SILHack が `preventDefault()` + `stopImmediatePropagation()` で消費 → Messenger の送信ハンドラへ渡さない
- ガードは短時間のみ有効にし、最初の Enter で消費する → 次の「本当の改行Enter」には影響しにくい
- Messenger 限定の修正にして、他サイトへの回帰を避ける

### Messenger の通常 Enter は明示的に改行を挿入する

IME直後は Messenger / Chrome 側の `beforeinput` が揺れるため、Messenger だけは通常の Enter で `insertLineBreak` を実行する。
他サイトは各エディタの実装差に合わせて別途処理し、Messenger の IME 対策を横展開しない。

### 注意点

- ガード時間は長すぎると「確定直後に本当に改行したい Enter」まで飲むため、短めに保つ
- `keyup` ブロック (`enterHandledOnKeydown` 系) との相互作用は実機確認が必要

## Codex実装メモ（2026-05-16）

### 結論

`requestAnimationFrame` 1フレームのガードでは環境差に弱いため、短時間タイマー方式へ変更。
また、Messenger の通常 Enter は `beforeinput` に依存せず、拡張側で明示的に改行を挿入する。

### 妥当な点

- `event.isComposing || event.keyCode === 229` だけでは、`compositionend` が先に来る環境を拾いきれない。
- Messenger 分岐の plain Enter で `stopImmediatePropagation()` しているため、Messenger / Chrome 側の `beforeinput` 実装差で改行が消える余地がある。
- Messenger 限定で明示挿入へ寄せることで、ChatGPT / Perplexity の既存挙動には触れない。
