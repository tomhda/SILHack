# SILHack

複数のチャットサービスで、`Enter` / `Shift+Enter` / `Ctrl+Enter` を押したときの動作（改行か送信か）をサイトごとに決められる Chrome 拡張です。  
初期設定は次のとおりです。

- `Enter` / `Shift+Enter` で改行
- `Ctrl+Enter` / `Cmd+Enter` で送信

あわせて、Gemini を開いたときのモデル選択と、Chatwork の入力補助を提供します。

## できること

- サイトごとに `Enter` / `Shift+Enter` / `Ctrl+Enter`（macOS は `Cmd+Enter`）の動作を「改行」「送信」から選ぶ
- サイトごとに拡張の動作を ON/OFF
- `textarea` / `contenteditable` の両方に対応
- Gemini を開いたときに、指定したモデル（自動モード / Hydrogen / Neon / Carbon）と思考レベル（低 / 標準 / 高）を選ぶ
- Messenger の IME 入力で改行が失われにくいように補正
- Chatwork のルーム一覧の端で、画面全体がスクロールしないように止める
- Chatwork で Markdown を貼り付けたときに Chatwork タグへ変換（設定画面で ON）
- 更新後は拡張アイコンに `NEW` を表示し、更新内容カードを一回だけ表示

## 対応サイト

| サイト | URL | 内容 |
|---|---|---|
| ChatGPT | `chat.openai.com`, `chatgpt.com` | キーの割り当て |
| Claude | `claude.ai` | キーの割り当て |
| Gemini | `gemini.google.com` | キーの割り当て + モデルと思考レベルの選択 |
| Perplexity | `perplexity.ai`, `www.perplexity.ai` | キーの割り当て |
| Messenger | `messenger.com`, `www.messenger.com` | キーの割り当て（IME 考慮） |
| Chatwork | `chatwork.com`, `www.chatwork.com` | ルーム一覧のスクロール止め + Markdown 貼り付けの変換 |

## インストール方法（ローカル）

1. `chrome://extensions` を開く
2. 「デベロッパーモード」を ON にする
3. 「パッケージ化されていない拡張機能を読み込む」で `SILHack` フォルダを選択
4. 対象サイトのタブを再読み込みする

## 使い方

1. 拡張アイコンのポップアップ、または設定画面の「キーの割り当て」で、サイトごとに各キーの「改行」「送信」を選ぶ
2. 対応サイトの入力欄で、選んだとおりにキーが動く
3. Gemini は「モデル」と「思考レベル」で、開いたときに選ぶものを指定する（「変更しない」なら触らない）

## キーの割り当て

- 「改行」は、そのサイトで `Shift+Enter` を押したときと同じ改行を入れる
- 「送信」は、入力欄の近くにある送信ボタンを押す
- `Alt` や `Ctrl+Shift` を組み合わせたキーは、サイト本来の動作のまま
- 候補の一覧（メンションなど）が開いているときの `Enter` は、候補の確定に使う

## Gemini のモデル選択

- 新しいチャット（`/app` や Gem のトップ）を開いたときに、入力欄の上のモデル選択メニューから指定のモデルと思考レベルを選ぶ
- 既存のチャットを開いたときは変更しない。手動で切り替えた後も、新しいチャットを開き直すまで変更しない
- 自動モードを選んだときは、思考レベルを変更しない
- Gemini 側の UI 変更により、将来的に判定ロジックの調整が必要になる可能性あり

## Messenger の IME 対応

- `compositionend` 直後の `Enter` は IME 確定キーとして扱い、Messenger の送信ハンドラへ渡さない
- 通常の `Enter` は Messenger の `beforeinput` フォールバックに依存せず、拡張側で改行を挿入
- Google 日本語入力の確定操作直後に改行できない問題を緩和
- 確定直後に `Enter` を無視する時間は設定画面で変更できる（0 で無効）

## ファイル構成

- `manifest.json`: 拡張の定義（Manifest V3、対象 URL、読み込むスクリプト）
- `background.js`: 更新検知、更新バッジ、更新内容カードの既読処理
- `js/settings.js`: 設定値の初期値、保存、正規化、旧設定からの移行
- `js/update_notice.js`: 更新内容カードの保存、表示、既読管理
- `js/content.js`: キーの割り当て、Gemini のモデル選択、Messenger IME 対策
- `js/chatwork.js`: Chatwork のスクロール止めと Markdown 貼り付けの変換
- `options/`, `popup/`: 設定画面とポップアップ
- `icons/`: 拡張アイコン
- `docs/messenger-ime.md`  
  Messenger IME 問題の調査メモと方針

## 開発メモ

- サイトごとのセレクタは `js/content.js` の `SITE_CONFIGS` で管理
- 送信が効かない場合は `sendButtonSelectors` を優先して見直す
- 設定の形を変えるときは `js/settings.js` の `normalizeSettings` で旧設定から移行する
- リリース時は `manifest.json` の `version` と `js/update_notice.js` の更新内容を更新する

## 動作しないときの確認ポイント

1. `chrome://extensions` で SILHack を再読み込み
2. 対象サイトのタブをハードリロード
3. 対象 URL が `manifest.json` の `matches` に含まれているか確認
4. サイト側 UI 変更があれば、セレクタを更新

## ライセンス

MIT License（`LICENSE` を参照）
