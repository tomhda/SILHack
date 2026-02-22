# SILHack

複数のチャットサービスで、送信キーの挙動をそろえる Chrome 拡張です。  
基本方針は次の 2 点です。

- `Enter` で改行
- `Ctrl+Enter` / `Cmd+Enter` で送信

あわせて、Gemini のモード自動切り替えと Chatwork のタグ挿入補助を提供します。

## できること

- `Enter` で改行、`Ctrl+Enter` / `Cmd+Enter` で送信
- `textarea` / `contenteditable` の両方に対応
- Gemini で利用可能な上位モードを自動選択（`PRO > 思考 > 高速`）
- Chatwork でタグ挿入ボタンを表示（`Info` / `Title` / `Code` / `Hr`）
- Messenger の IME 入力で改行が失われにくいように補正

## 対応サイト

| サイト | URL | 内容 |
|---|---|---|
| ChatGPT | `chat.openai.com`, `chatgpt.com` | 送信キー挙動の変更 |
| Gemini | `gemini.google.com` | 送信キー挙動の変更 + モード自動選択 |
| Perplexity | `perplexity.ai`, `www.perplexity.ai` | 送信キー挙動の変更 |
| Messenger | `messenger.com`, `www.messenger.com` | 送信キー挙動の変更（IME考慮） |
| Chatwork | `chatwork.com`, `www.chatwork.com` | タグ挿入ボタンのみ |

## インストール方法（ローカル）

1. `chrome://extensions` を開く
2. 「デベロッパーモード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」で `SILHack` フォルダを選択
4. 対象サイトのタブを再読み込みする

## 使い方

1. 対応サイトの入力欄で `Enter` を押すと改行
2. `Ctrl+Enter`（macOS は `Cmd+Enter`）で送信
3. Gemini はページ表示後に、利用可能な最上位モードへ自動で切り替え

## Gemini モード自動切り替え

- 優先順位は `PRO > 思考 > 高速`
- 入力欄まわりの UI を基準にモード切り替えボタンを判定
- 送信ボタンやサイドメニューなど、無関係なボタンの誤クリックを避ける設計
- Gemini 側の UI 変更により、将来的に判定ロジックの調整が必要になる可能性あり

## Messenger の IME 対応

- `compositionend` 直後の `Enter` を考慮するガードを実装
- 日本語 IME の確定操作直後に改行できない問題を緩和

## ファイル構成

- `manifest.json`  
  拡張の定義（Manifest V3、対象 URL、読み込むスクリプト）
- `js/content.js`  
  送信キー制御、Gemini モード自動切り替え、Messenger IME 対策
- `js/chatwork_tags.js`  
  Chatwork のタグ挿入ボタン UI
- `icons/`  
  拡張アイコン
- `対策方針.md`  
  Messenger IME 問題の調査メモと方針

## 開発メモ

- サイトごとのセレクタは `js/content.js` の `SITE_CONFIGS` で管理
- 送信が効かない場合は `sendButtonSelectors` を優先して見直す
- リリース時は `manifest.json` の `version` を更新する

## 動作しないときの確認ポイント

1. `chrome://extensions` で SILHack を再読み込み
2. 対象サイトのタブをハードリロード
3. 対象 URL が `manifest.json` の `matches` に含まれているか確認
4. サイト側 UI 変更があれば、セレクタを更新

## ライセンス

MIT License（`LICENSE` を参照）
