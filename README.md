# SILHack

Chrome extension that remaps send keys for multiple chat services.
複数チャットサービスの送信キー挙動を変更する Chrome 拡張です。

## LLM Quick Context
- Goal: Make Enter insert a newline, and Ctrl/Cmd+Enter send messages.
- Targets: ChatGPT, Gemini, Perplexity, Messenger.
- Chatwork: tag insert buttons only.
- Entry points: `SILHack/manifest.json`, `SILHack/js/content.js`, `SILHack/js/chatwork_tags.js`.

## クイック概要（日本語）
- 目的: Enter で改行、Ctrl/Cmd+Enter で送信。
- 対応先: ChatGPT / Gemini / Perplexity / Messenger。
- Chatwork: タグ挿入ボタンのみ。
- 主要ファイル: `SILHack/manifest.json`, `SILHack/js/content.js`, `SILHack/js/chatwork_tags.js`。

## Features
- Enter -> newline in supported inputs.
- Ctrl+Enter or Cmd+Enter -> send.
- Works across textarea and contenteditable inputs.
- Gemini auto-selects the smartest available mode (PRO > Thinking > Fast).
- Fallback send strategy: click send button, submit form, dispatch Enter.
- Chatwork tag buttons for quick markup insertion.

## 機能
- 対応入力欄では Enter で改行。
- Ctrl+Enter または Cmd+Enter で送信。
- `textarea` と `contenteditable` の両方に対応。
- Gemini は利用可能な中で最も賢いモード（PRO > 思考 > 高速）を自動選択。
- 送信のフォールバック: 送信ボタンクリック、form submit、Enter イベント送出。
- Chatwork ではタグ挿入ボタンを提供。

## Supported Sites
- Chatwork (tag buttons): `chatwork.com`
- ChatGPT: `chat.openai.com`, `chatgpt.com`
- Gemini: `gemini.google.com`
- Messenger: `messenger.com`
- Perplexity: `perplexity.ai`

## 対応サイト
- Chatwork（タグボタンのみ）: `chatwork.com`
- ChatGPT: `chat.openai.com`, `chatgpt.com`
- Gemini: `gemini.google.com`
- Messenger: `messenger.com`
- Perplexity: `perplexity.ai`

## Install (Local)
1. Open `chrome://extensions` and enable Developer Mode.
2. Click "Load unpacked" and select `SILHack`.
3. Reload tabs for target sites.

## インストール（ローカル）
1. `chrome://extensions` を開いて「デベロッパーモード」を有効化。
2. 「パッケージ化されていない拡張機能を読み込む」で `SILHack` を選択。
3. 対象サイトのタブをリロード。

## File Layout
- `SILHack/manifest.json`: MV3 manifest and match patterns.
- `SILHack/js/content.js`: key handling and site selectors.
- `SILHack/js/chatwork_tags.js`: Chatwork tag insertion UI.
- `SILHack/icons/`: extension icons (`icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `silhack-icon.svg`).

## ファイル構成
- `SILHack/manifest.json`: MV3 マニフェストとマッチパターン。
- `SILHack/js/content.js`: キー処理とサイト別セレクタ。
- `SILHack/js/chatwork_tags.js`: Chatwork タグ挿入 UI。
- `SILHack/icons/`: 拡張アイコン（`icon16.png`, `icon32.png`, `icon48.png`, `icon128.png`, `silhack-icon.svg`）。

## How It Works
- A capture-phase `keydown` listener checks for Enter and IME state.
- On Ctrl/Cmd+Enter, it attempts to send using configured selectors.
- On plain Enter, it inserts a newline (textarea or contenteditable).

## 動作概要
- capture phase の `keydown` リスナーで Enter キーと IME 状態を判定。
- Ctrl/Cmd+Enter では、設定済みセレクタで送信を試行。
- 通常 Enter では改行を挿入（`textarea` / `contenteditable`）。

## Updating Selectors
- Add/adjust CSS selectors in `SITE_CONFIGS` in `SILHack/js/content.js`.
- Keep selectors specific enough to avoid non-chat inputs.
- If send fails on a site, add or refine `sendButtonSelectors`.

## セレクタ更新
- `SILHack/js/content.js` の `SITE_CONFIGS` に CSS セレクタを追加・調整。
- チャット以外の入力欄を拾わないように十分具体的なセレクタにする。
- 送信失敗があるサイトは `sendButtonSelectors` を追加または調整。

## Notes
- IME composition is ignored to avoid breaking Japanese input.
- Some web apps change DOM frequently; selectors may need updates.

## 注意事項
- 日本語入力を壊さないため、IME 変換中の Enter は無視。
- Web アプリ側の DOM 変更が頻繁なため、セレクタ調整が必要になる場合あり。

## Versioning
- Update the version in `SILHack/manifest.json` for releases.

## バージョン管理
- リリース時は `SILHack/manifest.json` のバージョンを更新。
