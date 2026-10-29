# 少年野球配車管理システム システム設計書 兼 仕様書（完全版）

> **対象**: `-haisha`（少年野球 配車ヘルパー）  
> **準拠実装**: `?v=20261029c` / `haisha-cache-v20261029c` 時点  
> **目的**: 本ファイル単体でアーキテクチャ・データモデル・契約ルールを把握し、改修時のリグレッションを防ぐ。  
> **ソース・オブ・トゥルース**: 挙動が食い違う場合はコードを正し、続けて本ファイルを更新する。

---

## 0. ファイル構成とアーキテクチャ契約

### 0.1 ディレクトリ構造

```
/
├── index.html              # シェルUI・モーダル・?v= 付き読込・SW登録・PWA meta
├── manifest.json           # PWA マニフェスト（standalone / icons / theme_color）
├── sw.js                   # Cache First Service Worker
├── ARCHITECTURE.md         # 本設計書
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── css/
│   └── style.css           # レイアウト・タッチ領域・診断・2カラム・アコーディオン
└── js/
    ├── data.js             # window.HaishaData
    ├── ui.js               # window.HaishaUI
    ├── carpool.js          # window.HaishaCarpool
    └── app.js              # window.HaishaApp
```

### 0.2 スクリプト依存順（変更禁止）

`index.html` 末尾の読込順を崩さないこと:

1. `js/data.js` → `HaishaData`（`loadData()` 即時実行）
2. `js/ui.js` → `HaishaUI`
3. `js/carpool.js` → `HaishaCarpool`
4. `js/app.js` → `HaishaApp.init()`（イベント委任＋初回描画）

### 0.3 名前空間パターン（Namespace）

各 JS は **IIFE** で閉じ、公開 API のみ専用オブジェクトへ集約する。

| 名前空間 | ファイル | 責務 |
|----------|----------|------|
| `window.HaishaData` | `js/data.js` | データ正規化、ストレージ永続化、改名同期、週次/完全リセット、テキスト退避・復元、座席ヘルパ |
| `window.HaishaUI` | `js/ui.js` | 描画、インライン入力、モーダル、同乗エディタ、CRUD・ソート |
| `window.HaishaCarpool` | `js/carpool.js` | 配車アルゴリズム、診断サジェスト、LINE/画面テキスト、履歴ロールバック |
| `window.HaishaApp` | `js/app.js` | イベント委任（`click` / `change` / `touchstart` / `touchend` / `keydown`）、初期化 |

#### 主要公開 API（抜粋）

```ts
// HaishaData
HaishaData.cars / .children          // getter/setter（同一配列参照）
HaishaData.loadData / saveData / manualSave
HaishaData.hasSeenTutorial / markTutorialSeen   // cp_tutorial_seen
HaishaData.renameCar / renameCarCascade
HaishaData.resetTodaySession / resetAllData
HaishaData.copyBackupData / restoreBackupData
HaishaData.shareDispatchText          // クリップボード＋Capacitor Share / Web Share
HaishaData.seatCost / carSeatSummary / canFitOnCar / normalize*

// HaishaUI
HaishaUI.renderCars / renderChildren / refreshLists / updateStatusBar
HaishaUI.openCompanionEditor          // = openChildCompanionEditor
HaishaUI.toggleSection / toggleSettingsPanel
HaishaUI.openTutorialModal / closeTutorialModal / tutorialNext|Prev|Goto / maybeShowTutorialOnLaunch
HaishaUI.addCompanion* / addChildCompanion* / commitCarRename / …

// HaishaCarpool
HaishaCarpool.generate                // = generateCarpool
HaishaCarpool.diagnose                // = diagnoseCarpoolFailure
HaishaCarpool.copyResult
HaishaCarpool.buildLinePlanText()     // 直近生成済み LINE 文を返す
HaishaCarpool.clearDiagnosis / clearLastSessionCommit
HaishaCarpool.currentAssignments / assignmentWarnings / lastGeneratedPlan / lastSessionCommit

// HaishaApp
HaishaApp.init / runClickAction / handleAppClick / handleAppChange / …
```

#### グローバル直下への新規追加 — **禁止**

- **禁止**: グローバル直下への新規 `function` / `var` / `let` / `const` の追加。
- **必須**: 新機能は必ず該当 `Haisha*` のプロパティ／メソッドとして追加する。
- **互換エイリアス**: 段階的移行のため、既存呼び出し向けに `window.saveData = HaishaData.saveData` 等を各ファイル末尾で張っている。  
  - `cars` / `children` / `currentAssignments` / `lastGeneratedPlan` / `lastSessionCommit` は `Object.defineProperty` の getter/setter で IIFE 内変数と同期。  
  - **新規コードはエイリアスではなく `Haisha*` を呼べ。** エイリアスの安易な増殖も避ける。

### 0.4 アセット同期契約（キャッシュバスター）

新機能・修正・見た目変更のいずれでも、次を**同一バージョン文字列で必ず同時更新**する:

| 箇所 | 例（現行） |
|------|------------|
| `index.html` の CSS/JS `?v=` | `20261029c` |
| `sw.js` の `CACHE_NAME` | `haisha-cache-v20261029c` |
| `sw.js` の PRECACHE 内 `?v=` 付き URL | 同上 |

片方だけの更新は iOS PWA で古い JS/CSS が残り、原因不明の不具合になる。

### 0.5 PWA 契約（`manifest.json` / `sw.js`）

- **manifest**: `name: 配車ヘルパー`, `short_name: 配車`, `start_url: ./index.html`, `display: standalone`, `theme_color: #1e3a8a`, icons 192/512
- **SW 戦略**: Cache First + Network Fallback（同一オリジン GET）
  - `install`: PRECACHE → `skipWaiting()`
  - `activate`: 旧キャッシュ全削除 → `clients.claim()`
  - `fetch`: キャッシュ命中優先、ミス時ネットワークしてキャッシュ更新、ナビ失敗時は `index.html` フォールバック
- **登録**: `index.html` 末尾 `navigator.serviceWorker.register('./sw.js')`（`load` 後）
- HTTPS または localhost での配信が必要（file:// では SW 非対応）

---

## 1. システム概要と開発思想

### 1.1 アプリの目的

少年野球チームの**配車係（保護者）**が、遠征先など**電波の弱い／無い環境**でも:

1. 出勤車両・出欠・同乗・指定を入力し  
2. 公正な配車を数タップで組み  
3. LINE 用テキストをコピーして保護者連絡に貼る  

ことを、**完全オフライン動作可能な正規 PWA**として完結させる。

### 1.2 コア原則（改修時の最優先制約）

| # | 原則 | 破ってはいけない例 |
|---|------|-------------------|
| 1 | **ゼロ・ヒューマンエラー** — 定員超過を UI/計算で防ぎ、失敗時は診断で具体策を出す | 定員チェック無しで指定車両を許可する／失敗を alert だけで終わらせる |
| 2 | **ミニマル LINE 出力** — 乗員は注記なしの**読点区切り1行**。車両見出しの `【道具車】` のみ例外 | 乗員に属性ラベル・箇条書き・絵文字を付ける／縦長の1人1行に戻す |
| 3 | **モバイルファースト＆省スペース** — 縦スクロール最小化、同乗の展開式入力、768px+ で 2 カラム | 選手カードに常時フル入力フォームを常設する |
| 4 | **データの絶対保全** — 週次リセットは一時フラグのみ、マスタ・履歴は保護。退避/復元・改名カスケードで整合性維持 | `resetTodaySession` で `rideHistory` や選手名を消す／改名で参照切れを残す |

### 1.3 技術スタック要約

- Vanilla JS + IIFE 名前空間（バンドラなし）
- `localStorage`（マスタ＋当日状態）/ `sessionStorage`（UI 開閉・セッション確定履歴）
- 単一 HTML + CSS + PWA（manifest + Cache First SW）

---

## 2. データ構造・スキーマ定義（localStorage & sessionStorage）

### 2.1 ストレージキー

| ストア | キー | 内容 |
|--------|------|------|
| localStorage | `cp_cars` | 車両配列 JSON |
| localStorage | `cp_children` | 選手配列 JSON |
| localStorage | `cp_tutorial_seen` | 初回ガイド既読: `"1"` で自動表示しない |
| sessionStorage | `cp_section_cars` | `"1"`/`"0"` 本日の車パネル開閉 |
| sessionStorage | `cp_section_children` | 参加選手パネル開閉 |
| sessionStorage | `cp_section_settings` | 設定パネル開閉（既定閉じ） |
| sessionStorage | `cp_car_sort` | 車両一覧ソート: `default`\|`kana` |
| sessionStorage | `cp_child_sort` | 選手一覧ソート: `default`\|`kana`\|`grade`\|`position` |
| sessionStorage | `cp_lastSessionCommit` | 直前 LINE 確定のロールバック用マップ |

メモリのみ（永続化しない）:

- `HaishaCarpool.currentAssignments` — `{ [carName]: Child[] }`
- `HaishaCarpool.lastGeneratedPlan` — LINE 用プレーンテキスト
- `HaishaUI.openChildCompanionEditors` — 同乗入力展開中の選手 ID `Set`

### 2.2 Companion（車両側・選手側共通）

```ts
interface Companion {
  id: string | number;  // newCompanionId() 例: "cmp-1730…-4242"
  label: string;        // "母" / "兄" / 自由入力名 など。空は正規化で破棄
}
```

### 2.3 Vehicle（Car）

```ts
interface Car {
  id: number;                 // 既存サンプルは 1,2,3… / 新規は Date.now()
  name: string;               // 参照キー（親車・指定・rideHistory）。一意運用前提
  capacity: number;           // 乗車可能席（選手＋同乗を含む母数）
  active: boolean;            // 本日出勤
  companions: Companion[];    // 車両側の事前同乗枠
  isEquipmentCar: boolean;    // 道具車フラグ（既定 false）。LINE/画面見出しに反映
  driverRole: string;          // 本日の運転者。未設定の読み込みは「父」。選択肢は cp_driver_roles。席は消費しない
}
// 移行互換: familySeats?: number → companions に「身内」を人数分生成
// normalizeCar: isEquipmentCar: !!car.isEquipmentCar（永続化・バックアップ対応）
```

**個人名の `driverName` は無い。** 運転者は役割 `driverRole`。車両名（`佐藤号`）とは別。

**道具車 UI**: 車両カードの「道具車」チェック（`data-action="toggle-equipment"`）→ `toggleEquipmentCar` → `saveData`。ON 時はカードに `📦 道具車` バッジ。

### 2.4 Player（Child）

```ts
interface Child {
  id: number;
  name: string;
  grade: number;              // 1–6
  pos: string;                // 投手|捕手|内野|外野|未定 等
  parentCar: string;          // 親の車の name。空 = なし（マスタ）
  fixedCar: string;           // 本日の指定車両 name。空 = 自動
  motionSick: boolean;        // 吐き気配慮
  active: boolean;            // false = 欠席
  meetOnSite: boolean;        // true かつ active = 現地（座席 0）
  companions: Companion[];    // 選手に付随する同乗（複数可）
  lastCar: string;            // 直近確定乗車の車両名
  rideHistory: {              // 車両名 → 累計確定回数
    [carName: string]: number;
  };
}
// 移行互換: guardianRide / guardianName → companions[{label}]
```

**出欠の意味**（`getAttendMode` / `setAttendMode`）:

| UI | active | meetOnSite | 配車 |
|----|--------|------------|------|
| 欠席 `off` | false | false | 不参加。同乗・指定クリア |
| 乗車 `ride` | true | false | `seatCost` 消費 |
| 現地 `site` | true | true | 座席 0。同乗・指定クリア。LINE 末尾リスト |

**座席消費**:

```
seatCost(child) = isRiding(child) ? 1 + child.companions.length : 0
```

### 2.5 Session Commit（履歴ロールバック）

```ts
// sessionStorage: cp_lastSessionCommit およびメモリ lastSessionCommit
type LastSessionCommit = {
  [childId: string]: string;  // 加算した車両名
} | null;
```

### 2.6 データ連動関数（重要契約）

#### `renameCar(carId, newName)` / `renameCarCascade(car, oldName, newName)`

車両名は参照キーであるため、単純上書きは**禁止**。UI の名前入力確定 → `commitCarRename` → `renameCar`:

1. `newName` 空／`oldName === newName` → 中断  
2. 他車と名前重複 → alert して中断  
3. **`renameCarCascade`**: 全選手を走査し  
   - `parentCar` / `fixedCar` / `lastCar` の `oldName` → `newName`  
   - `rideHistory[oldName]` を `rideHistory[newName]` に合算し旧キー削除  
   - メモリ上 `currentAssignments` のキーも追随  
4. `car.name = newName` → `saveData()`

→ **車両改名による参照切れは発生しない。**

#### `resetTodaySession()`（🔄 本日の配車をリセット）

| クリア | 保護 |
|--------|------|
| 出欠→全員乗車、両 `companions`、`fixedCar`、車 `active=全ON`、**`isEquipmentCar=false`（道具車は週替わり運用のため毎回初期化）**、結果・診断、`lastSessionCommit` | 選手/車両マスタ名、grade/pos、parentCar、motionSick、capacity、rideHistory、lastCar |

#### `resetAllData()`

`lastSessionCommit` クリア + `localStorage.clear()` + リロード（サンプル再生成）。

#### バックアップ

```ts
interface BackupPayload {
  version: 1;
  exportedAt: string; // ISO8601
  cars: Car[];
  children: Child[];
}
```

- 退避: `buildBackupPayload` → JSON → `copyTextToClipboard`（Clipboard API + execCommand フォールバック）  
- 復元: モーダル貼付 → 検証 → confirm → normalize → save → 再描画、結果クリア  

### 2.7 概念名との対応（誤解防止）

| 概念ドキュメント上の名前 | 実装フィールド |
|--------------------------|----------------|
| status present/absent/direct | `active` + `meetOnSite` |
| parentVehicleId | `parentCar: string`（**車両名**） |
| assignedVehicleId | `fixedCar: string`（**車両名**、空=自動） |
| isCarsick | `motionSick` |
| companions: string[] | **`{id,label}[]`** |
| isActive（車） | `active` |

---

## 3. 座席計算と配車アルゴリズム（HaishaCarpool）

### 3.1 座席算定ルール（不変）

```
車両の事前消費 = companionSeatsOf(car)           // 車両同乗人数
選手グループ必要 = seatCost(child)               // 1 + 選手同乗人数
UI 上の used（指定込み）=
  companionSeatsOf(car) + Σ seatCost(fixedCar===car.name の乗車選手)

全体成立チェック:
  totalCap = Σ active.capacity
  seatDemand = Σ seatCost(riding) + Σ companionSeatsOf(active)
  totalCap < seatDemand → 失敗（診断）
```

### 3.2 配車ステップ（`HaishaCarpool.generate`）

対象: `activeCars`、`ridingKids`、`onSiteKids`。`#carpoolMode` は画面に残るが、スコア計算には使わない。

| Step | 内容 |
|------|------|
| 0 | 参加者なし→alert。出勤車0→診断して終了 |
| 1 | 総定員 < 必要座席（選手同乗＋車両同乗）なら alert「座席が〇席不足しています」して終了 |
| 2 | 出勤台数×2 > 乗車人数なら警告「車両数が多いため、1名乗車の車両が発生します」を保持して続行 |
| 3 | 骨格: 有効席は定員−車両同乗。`fixedCar` → `parentCar` → フリー選手を、可能な範囲で1台2名以上になるよう均等配置 |
| 4 | `evaluateAssignmentScore(assignments)` が上がるときだけ、固定ピンでも親車拘束でもない選手を2台間で入れ替える（最大280試行） |
| 5 | 席に入らない選手が残ったら失敗＋診断。成功時は診断を消し、結果カード上部に `warnings` を出す |

`currentAssignments` は従来どおり `{ 車両名: 選手[] }`。`warnings` は列挙されないプロパティ、および `HaishaCarpool.assignmentWarnings`。画面は `#resultWarnings`。

**スコア（高いほど良い、減点）**:

- 全体人数が2名/台を満たせるのに選手1名の車 → **-1000**
- 車酔いの選手が、定員の中央値未満の車 → **-200**
- 同一車に投手（投手/P）または捕手（捕手/C）が2名以上 → **その人数 × -150**
- 乗車のある車の平均学年の分散 → **分散 × -30**

### 3.3 履歴確定とロールバック（`copyResult`）

- 配車計算だけでは `rideHistory` / `lastCar` / `dispatchHistory` を更新**しない**。  
- **LINE コピー時**のみ確定処理:

  1. `lastSessionCommit` があれば各選手の `rideHistory[直前車両]` を **-1**（≤0 はキー削除）＝ロールバック  
  2. `cp_lastDispatchCommit` があれば、その確定で足した各車の `dispatchHistory` 日付を1件戻す  
  3. 今回の `currentAssignments` で +1 と `lastCar` 更新。計画に含まれる各車の `dispatchHistory` に当日 `YYYY-MM-DD` を1件追加  
  4. 新しい `{ childId: carName }` を `lastSessionCommit` に保存（メモリ＋ sessionStorage）  
  5. `saveData()`

出動回数の表示期間は `localStorage` の `cp_dispatch_period`（`30` / `90` / `180`、既定 90）。`getCarDispatchCount(car, days)` は当日を含む `days` 日以内の件数。履歴が無い車は 0。週次リセットは履歴を消さず、ロールバック用マーカーだけ外す。

→ **同セッション内の複数回コピーによる二重加算を防止**（直前確定の置き換え）。  
→ `resetTodaySession` / `resetAllData` で `lastSessionCommit` をクリアし、翌週は新規1回分として加算。

### 3.4 デッドロック診断（`diagnose`）

失敗時は結果カードを隠し、`#carpoolDiagnosis` に赤/黄アラートを表示。

**分析**: kidSeatDemand、carCompanionSeats、totalCap、shortage、leftoverKids、吐き気空き 等。

**サジェスト（priority 順・最大10・重複除去）**:

| Tag | 内容 |
|-----|------|
| A | 車両同乗の個別解除／不足時は選手同乗の削減 |
| B | 休止車両の出勤で N 席 |
| C | 席単価の大きい選手から現地へ移す必要人数 |
| D | `capacity - 車同乗 === 1` の車への2席以上確保 |
| E | 🤢酔い選手向け空き車なし |

成功時および週次リセットで診断クリア。

---

## 4. UI/UX 設計とコンポーネント構成

### 4.1 画面ブロック（上から）

1. タイトル  
2. sticky 状況バー（参加／現地／定員／過不足）  
3. 操作バー（❓使い方／本日リセット／今の状態を保存）  
4. **main-grid**: 本日の車 ｜ 参加選手  
5. 配車ルール＋実行  
6. **診断カード**（失敗時のみ）  
7. 配車結果（成功時）  
8. 設定・バックアップ（折りたたみ・既定閉じ）  
9. 復元モーダル／選手編集モーダル／**初回ガイドモーダル** 

### 4.2 レスポンシブ

- **&lt;768px**: 1カラム。車・選手はアコーディオン（要約バッジ付き）。  
- **≥768px**: 左右2カラム。車・選手は常時展開。設定パネルのみ折りたたみ継続。  
- **要約バッジ**: `updatePanelSummaries` が文言付きで描画（例: `出勤 4台 / 15席` / `参加 12名`）。`toggle-section` は `.is-open` と `aria-expanded` と `sessionStorage`（`cp_section_*` の `"0"`/`"1"`）のみ更新し、バッジ文言へフラグを流し込まない。

### 4.3 車両カード

- ヘッダー1行: 出勤チェック、**名前インライン編集**（`rename-car` → カスケード）、道具車時は `📦 道具車` バッジ、定員残バッジ、**出動回数**（`.badge-dispatch`）、並び替え（≡ / ▲ / ▼）、定員、削除  
- 「道具車」チェック（`toggle-equipment` → `isEquipmentCar` 永続化）。週次リセットで OFF  
- 同乗チップ + クイック続柄（母/兄/姉/弟/妹）+ 名前 + ＋  
- 満席・休止時は追加 disabled  

#### 車両の並び順

- ツールバーボタン `data-action="toggle-car-sort"`（表示: 無効時「🔤 50音順」／有効時「📋 登録順」）
- 状態 `carSortMode`: `default` | `kana`（`sessionStorage` キー `cp_car_sort`）
- `getSortedCarsForRender()`
  - `default`: `cars` のインデックス順（手動順を保持。id 順では並べ直さない）
  - `kana`: コピーを `name.localeCompare(..., 'ja')`。配列本体は変えない
- 手動並び替え（`moveCar` の ▲▼、`reorderCar` のドラッグ／タッチ）は `cars` の要素順を直接入れ替え、`carSortMode` を `default` にして `saveData()` と `renderCars()`  
  - ▲▼は配列の隣とスワップ。先頭は上、末尾は下が disabled  
  - ドロップ先の車両の位置へ挿入。ハンドルは `.car-drag-handle`

### 4.4 選手カード（省スペース）

- 出欠／名前／**同乗ピル横並び**／**`＋同乗`**（0人時は入力非表示、タップで展開）  
- 指定車両セレクト（`canFitOnCar` で超過拒否）  
- 親車はマスタ（編集モーダル／新規追加）。週次リセットで消さない  

### 4.4.1 選手一覧ソート（非破壊）

ヘッダーの `<select data-action="change-child-sort">` で切替。状態は `sessionStorage` キー `cp_child_sort`。  
**`HaishaData.children` 本体は並べ替えない** — `getSortedChildrenForRender()` が `[...children].sort(...)` の shallow copy で描画する。

| mode | 並び |
|------|------|
| `default` | 登録順（`id` 昇順） |
| `grade` | 学年降順（6→1）、同学年は50音順 |
| `position` | 守備位置順（投手→捕手→内野→外野→未定/その他）、同ポジは学年降順→50音 |
| `kana` | 名前の50音順（`localeCompare(..., 'ja')`） |

ポジションスコアは `POS_ORDER`（投手/ピッチャー=1 … 未定=9）の完全一致、なければ部分一致。

### 4.5 初回ガイド（オンボーディング）

初回アクセス向けの3枚スライドモーダル。いつでも操作バーの「❓ 使い方」から再表示できる。

| 項目 | 仕様 |
|------|------|
| フラグ | `localStorage` キー `cp_tutorial_seen`。`"1"` なら自動表示しない |
| 自動表示 | `initApp` → `HaishaUI.maybeShowTutorialOnLaunch()`。未既読時のみ `openTutorialModal` |
| 既読化 | 「配車をはじめる！」「✕」など `close-tutorial` で `HaishaData.markTutorialSeen()` |
| 再表示 | `data-action="open-tutorial"`（操作バー）。スライドは先頭から |
| ナビ | `tutorial-prev` / `tutorial-next` / `tutorial-goto`（ドット）。最終スライドは「配車をはじめる！」 |
| 描画 | `HaishaUI` のみ（`openTutorialModal` / `closeTutorialModal` / `tutorialNext` / `tutorialPrev` / `tutorialGoto`） |
| UI | `fixed` オーバーレイ、`z-index:120`、閉じるボタン・ナビは min 44px タップ領域 |

スライド内容:

1. **毎回の基本の3ステップ** — 出勤／欠席・現地／配車を組む→LINE  
2. **現場の便利機能** — 「[母]」・「＋同乗」／道具車チェック  
3. **安心のデータ管理** — 本日リセット（名簿保護）／月1回のLINE退避  

### 4.6 iOS / PWA タッチ（HaishaApp）

- `document` 委任: click / change / keydown(Enterで同乗追加)  
- **iOS のみ** touchstart(passive) / touchmove(passive) / touchend(passive:false)。Android では touchend+`preventDefault` が縦スクロールを阻害するため登録しない  
- ボタン系は `CLICK_ACTIONS` +（iOS）touchend。`suppressNextClick` で合成 click の二重実行防止  
- input/select/textarea/label は touchend アクション対象外  
- CSS: `html/body` に `touch-action:pan-y`・`overscroll-behavior-y:none`、ボタンは `manipulation`、モーダル非表示時 `pointer-events:none`  
- **新ボタンは必ず `data-action` + `CLICK_ACTIONS` + `runClickAction` に登録**

---

## 5. 外部連携・データ入出力

### 5.1 LINE 出力フォーマット（破壊禁止）

`HaishaCarpool.copyResult` がクリップボードへ載せる文面（`lastGeneratedPlan` / `buildLinePlanText`）のみが正。  
画面プレビュー（`buildScreenPlanText` / `#resultText`）は見やすさのため改行・📌・🤢付きでもよい。

```
【連絡】本日の配車です🚗
---------------------
■ 佐藤号（父、母） 【道具車】
ゆうと、母、そうた

■ 鈴木号（父）
れん、はると

【現地集合】
大和、りく

---------------------
よろしくお願いいたします！
```

- **車両見出し**: `■ {車名}（{driverRole}、同乗…）`。運転者を括弧の先頭にし、同乗者のうち運転者と同じ名前は重ねない。運転者が空で同乗者もいなければ括弧なし。人数は出さない。`isEquipmentCar` のときのみ末尾に ` 【道具車】`（画面プレビューは ` 【道具車📦】`）。
- **乗員行（1台あたり1行）**: 選手・選手同乗・車両同乗の名前を **読点（、）区切りで横並び**。空なら `なし`。`・` 箇条書き・属性ラベル・📌・🤢は禁止。
- **現地集合**: 見出しの次行に名前を読点区切り1行（1人1行にしない）。

### 5.2 週次運用フロー（推奨）

1. （任意）バックアップ退避  
2. 「本日の配車をリセット」（`lastSessionCommit` もクリア）  
3. 出勤・出欠・同乗・指定を入力  
4. 配車実行 → 失敗なら診断どおり調整  
5. LINE コピーで履歴確定（再コピーはロールバック後に置換）  
6. 週末に再度退避  

### 5.3 クリップボード

共通 `HaishaData.copyTextToClipboard`（Clipboard API → `execCommand` フォールバック）。バックアップ JSON と LINE 文で共用。  
配車表の共有は `HaishaData.shareDispatchText`（先にクリップボードへ退避 → `window.Capacitor.Plugins.Share` → `navigator.share` → alert）。`copy-result` は履歴確定後にこれを呼ぶ。

---

## 6. モジュール責務マトリクス

| 変更内容 | 触る名前空間 | 注意 |
|----------|--------------|------|
| フィールド追加 | Data normalize + UI 描画 + Backup | migrate を書く |
| 座席定義 | Data.seatCost / carSeatSummary + Carpool.diagnose | 全箇所同時更新 |
| 配車優先度 | Carpool.generate | LINE 形式を変えない |
| ボタン追加 | UI の HTML + App.CLICK_ACTIONS | touchend 対象確認 |
| 改名・参照 | Data.renameCar* のみ経由 | 名前の直書き禁止 |
| 履歴 | Carpool.copyResult / lastSessionCommit | 配車成功時に加算しない |
| 見た目 | style.css | タップ領域・768px |
| キャッシュ | index `?v=` + sw CACHE_NAME | **必ず同一バージョン** |

---

## 7. 回帰させてはいけないチェックリスト

改修後、少なくとも次を確認する:

- [ ] 選手同乗2名で `seatCost===3`、親車・指定・自動すべてで席が減る  
- [ ] 車両同乗チップ削除で残席が戻る  
- [ ] LINE コピー文は1台1行の読点区切りで、📌・🤢・`・`箇条書き・属性ラベルが出ない  
- [ ] 配車だけでは履歴が増えず、LINE コピー後にだけ増える  
- [ ] 同セッションでコピー→組み直し→再コピーしても履歴が二重加算されない  
- [ ] 本日リセット後の初回コピーは通常どおり +1、マスタ・rideHistory は残る  
- [ ] 車両名変更で全選手の parentCar/fixedCar/rideHistory/lastCar が追随する  
- [ ] 席不足・出勤車0・未割当で診断が出て、成功時は消える  
- [ ] iPhone PWA でクイック同乗・✕・出勤・車両名編集が反応する  
- [ ] 768px+ で車｜選手の2カラム、設定は折りたためる  
- [ ] バックアップ復元で companions 配列が戻る  
- [ ] オフライン（SW 有効後）でシェルが開き、操作できる  
- [ ] `?v=` と `CACHE_NAME` が一致している  

---

## 8. 用語集

| 用語 | 意味 |
|------|------|
| 乗車 | `active && !meetOnSite` |
| 現地 | `active && meetOnSite` |
| 車両同乗 | `car.companions`（車に紐づく事前枠） |
| 選手同乗 | `child.companions`（選手とセットで席消費） |
| 親の車 | `parentCar`（マスタ、週次リセットで保持） |
| 指定車両 | `fixedCar`（本日固定、画面のみ📌） |
| 公平化 | `rideHistory` + `lastCar`（コピー確定時。セッション内はロールバック付き） |
| 名前空間 | `HaishaData` / `HaishaUI` / `HaishaCarpool` / `HaishaApp` |

---

## 9. 実装上の意図的ギャップ（理想仕様との差）

1. **個人名の `driverName` は無い** — 運転者は役割 `driverRole`。選択肢は `cp_driver_roles`、同乗チップは `cp_companion_roles`。席は消費しない。  
2. **親車・指定・履歴キーは ID ではなく車両 `name` 文字列** — ただし **`renameCarCascade` により改名時は自動同期され参照切れは発生しない**。  
3. **companions は `string[]` ではなく `{id,label}[]`**。  
4. **出欠は単一 enum ではなく `active`×`meetOnSite`**。  
5. **最低2人はハード失敗にしない**。避けられる1名乗車は -1000 と警告、席不足だけを失敗にする。  
6. **PWA は導入済み**（`manifest.json` + Cache First `sw.js`）。加えて localStorage とテキスト退避でデータ耐障害を確保。  
7. **互換グローバルエイリアスが残存** — 新規コードは `Haisha*` のみ使用し、エイリアス依存を増やさない。

---

*改修者へ: 迷ったら本ファイルの契約表を先に更新方針として読み、コードを合わせよ。コードだけ先に変えて契約を放置しないこと。*
