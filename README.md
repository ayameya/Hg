# 東京23区 地下通路マップ

東京23区内の地下通路（駅コンコース、地下街、ビル地下の連絡通路、公共地下道・横断地下道）を網羅的に表示するWeb地図です。日時を指定すると、その時刻に通行できる区間だけを表示します。地上の出入口がすべて閉鎖されて入れない区間も判定します。

- 地下通路の座標は OpenStreetMap（OSM）のデータをそのまま使っています。
- ベースは白地図程度の表現です（道路、水域、緑地、建物、区境）。
- 主題レイヤとして、鉄道路線（地下区間は破線）、駅、バス路線、バス停、フェリー・水上バスの航路と乗り場、国の施設、東京都の施設、区の施設、大使館・領事館を表示します。
- 地下だけで行ける経路の検索（階段を避けるオプションあり）ができます。
- 外部のタイルサーバーやCDNは使いません。`docs/` を静的に配信すれば動きます。

## 使い方

```sh
cd web
npm install
npm run build
node serve.mjs
```

`http://localhost:8080/` を開きます。PMTiles は HTTP Range リクエストで読み込むため、Range に対応したサーバーで配信してください（`python -m http.server` は非対応）。GitHub Pages で `docs/` を公開する場合はそのまま動きます。

## 通行時間の決め方

地下通路の区間ごとに、次の優先順で通行時間（OSM の `opening_hours` 書式）を決めています。

1. OSM の way に付いている `opening_hours` タグ（確度: 高）
2. `pipeline/overrides/hours.json` の個別ルール（確度は各ルールに記載）
3. 施設種別ごとの推定値（確度: 低）

| 種別 | 推定値 | 判定方法（上から順に適用） |
| --- | --- | --- |
| 地下街 | `06:00-24:00` | 地下の `shop=mall` ポリゴン内、または通路名が地下街の名称パターン（「地下街」「サブナード」「外堀地下1番通り」など）に一致 |
| 駅構内・駅コンコース | `05:00-01:00` | 通路名が駅名または「駅」「改札」「番線」などを含む |
| 地下街 | `06:00-24:00` | 半径約30m以内に地下階の店舗・飲食店が4件以上（駅ポリゴン内を除く） |
| 駅構内・駅コンコース | `05:00-01:00` | 駅ポリゴン内 |
| ビル地下・連絡通路 | `07:00-23:00` | 建物ポリゴン内 |
| 駅構内・駅コンコース | `05:00-01:00` | 駅ポリゴンから約60m以内、または駅ノードから約250m以内 |
| 公共地下道・横断地下道 | `24/7` | 上記以外 |

出入口（`railway=subway_entrance` などのノード）、エレベーター、改札・柵・扉（`barrier=*`）のノードにも利用時間を設定できます。OSM の `opening_hours` タグ、または個別ルールで設定します。ノードが閉まっている時刻は、そのノードに接する区間を通行不可として扱います。店舗などのノードの営業時間は通路の開閉には使いません。

出入口ノードが OSM 上で地下通路につながっていない場合は、40m以内の最寄りの地下通路ノードへ「仮接続」します。仮接続の通行時間は接続先の通路に準じます。

日本の祝日は `opening_hours` ライブラリの `PH` で判定します。選択した日時は日本時間として解釈されます。

### 個別ルールの追加

`pipeline/overrides/hours.json` に追記して `pipeline/underground.py` を再実行します。

- `edges`: 通路区間のルール。`match` で対象を指定します。
  - `polygon`: GeoJSON Polygon の座標配列（経度・緯度）。範囲内の区間が対象です。
  - `area_names`: OSM で同名のポリゴン（地下街など）の範囲内が対象です。
  - `ways`: OSM way ID の配列。
  - `name_regex`: 通路名の正規表現。
  - `categories`: 対象を種別（`station` / `mall` / `building` / `public`）で絞り込みます。
- `entrances`: 出入口のルール。`center` から `radius_m` 以内にあり、出口番号が `refs` に含まれる出入口が対象です。出口番号は `ref` タグ、なければ名前（「大手町 C1」など）から読み取ります。`station` を指定すると、名前にその駅名を含む出入口（名前がない場合は最寄り駅がその駅のもの）に限定します。

各ルールには `source`（出典URL）、`confidence`（`high` / `medium` / `low`）、`note` を書きます。地図上で区間や出入口をクリックすると表示されます。

## データの再生成

```sh
python3 -m venv ../venv && ../venv/bin/pip install osmium shapely numpy
sudo apt-get install osmium-tool
# tippecanoe は https://github.com/felt/tippecanoe からビルド
PY=../venv/bin/python FONTS_DIR=/path/to/basemaps-assets/fonts pipeline/build.sh
```

`pipeline/build.sh` は、AWS Open Data の OSM planet（`s3://osm-pds/planet-latest.osm.pbf`、約95GB）をストリーミングし、23区より広い範囲（経度139.45〜140.05、緯度35.40〜35.95）だけを切り出します。区境界の海上部分や海岸線が範囲外で切れないよう、切り出し範囲は広めにとっています。タイルは23区と周辺約2kmの範囲、ズーム8〜15で生成し、それ以上は拡大表示します（z15 でもタイル内の座標分解能は約0.25m）。ダウンロード済みの `tokyo.osm.pbf` が作業ディレクトリ（`WORK`、既定は `/home/user/data`）にあればそれを使います。

| スクリプト | 出力 |
| --- | --- |
| `pipeline/wards.py` | 23区の境界（OSM `admin_level=7`） |
| `pipeline/layers.py` | 白地図と主題レイヤ（GeoJSONSeq） |
| `pipeline/underground.py` | `docs/data/network.json`（地下歩行者ネットワークと通行時間） |
| `tippecanoe` | `docs/data/base.pmtiles` |

### 地下通路として抽出する条件

`highway=footway|pedestrian|path|corridor|steps|elevator|…` の way のうち、次のいずれかに当てはまるものです。

- `layer` が負
- `level` がすべて負（`B1` 表記にも対応）
- `location=underground`
- `tunnel=yes`（地下道・横断地下道）

ただし、名前に「親水」「テラス」「遊歩道」などを含む屋外の通路と、`tunnel` も `indoor` もない `highway=path|track` は除きます。

さらに、これらにつながる150m未満の階段・エレベーター・エスカレーターを「地上との接続」として加えます。地上の道路・歩道と共有しているノード、出入口タグのノード、行き止まりになっている接続階段の上端を「地上接続点」とします。23区の境界内に1点でもかかる区間を対象にしています。

面で描かれた地下の広場・コンコース（`area=yes` など）は `docs/data/areas.json` に出力し、背景として表示します（経路計算には使いません）。

## 既知の制約

- 通路の網羅性と座標精度は OSM の整備状況に依存します。23区の主要駅や地下街は詳細に描かれていますが、描かれていないビル地下の連絡通路もあります。
- 通行時間の多くは推定値です。鉄道事業者の構内図・バリアフリーマップ、地下街の公式サイトに記載された時間は、このリポジトリを作成した環境からはアクセスできず、取り込めていません。
- 改札内と改札外は区別していません。改札内を通る経路が表示されることがあります。
- 種別ごとの推定値は、施設ごとに異なる夜間の閉鎖時刻を1つの値で近似したものです。終電・始発の時刻は曜日によって変わりますが、推定値では固定しています。
- バス路線は OSM の `route=bus` リレーションに基づくため、全系統を網羅していません。

## ライセンス

- 地図データ: © OpenStreetMap contributors（[ODbL](https://www.openstreetmap.org/copyright)）
- フォント: Noto Sans（SIL Open Font License、`docs/fonts/OFL.txt`）
- ソースコード: `LICENSE` を参照
