# PDOS-01　USB PD 給電・光 CAN 入力 DC サーボ制御基板

USB Type-C の USB PD（CH224K / CH221K）から受電し、専用のモータドライバ IC を使わずに、ディスクリート H ブリッジで DC モータを位置制御する基板の設計一式です。指令入力には、CAN のフレームを赤外 LED とフォトダイオードで伝送する「光 CAN」を使います。

| ファイル | 内容 |
|---|---|
| `PDOS-01_データシート.pdf` | データシート（I/O 仕様、光 CAN の物理層・タイミング・メッセージ仕様を含む） |
| `docs/設計書.md` | 設計書（部品選定の理由、定数計算、ピン割当、レイアウト指針、評価項目、要確認事項） |
| `docs/datasheet.html` | データシートの原稿 |
| `hardware/BOM.csv` | 部品表 |
| `hardware/netlist.csv` | ネットリスト（部品.ピン名。回路図 CAD へ入力するときの原本） |
| `figures/*.svg` | ブロック図、電源部・ハーフブリッジ・光 I/O の回路図、タイミング図 |
| `tools/figures.py` | 図の生成（`pip install schemdraw`） |
| `tools/build_pdf.mjs` | データシート PDF の生成（Playwright + Chromium） |

## 再生成

```sh
python3 tools/figures.py
node tools/build_pdf.mjs
```

## 状態

試作前の設計版（0.1）です。発注前に、`docs/設計書.md` §12 の要確認事項（CH224K/CH221K のピン番号と CFG 抵抗表、DMC4040SSD・AP63203WU・TSHF5210 の定格など）を、メーカーの最新データシートで照合してください。
