# 法令Diff

日本の法令の改正を、削除と追加の差分で読むための静的サイトです。

## 仕組み

- [houritsu](https://github.com/Kohei-Wada/houritsu) は、1 改正を 1 コミットとして法令を記録した git リポジトリです。
- `scripts/build-data.mjs` がその履歴から、法令の一覧、改正の一覧、変更行数の索引を `site/data/` に書き出します。
- 差分はブラウザが該当する 2 版の条文を `raw.githubusercontent.com` から取得して計算します。全差分を事前生成すると約 1 GB になるためです。
- 見出しの深さ、添付ファイルの URL、表のタグなど、条文の変更ではない差は `site/js/normalize.js` で取り除いています。

## 手元で動かす

```sh
git clone --no-tags --single-branch https://github.com/Kohei-Wada/houritsu.git source/houritsu
git -C source/houritsu fetch --no-tags origin upcoming:upcoming
npm run build:data
npm run dev   # http://localhost:4173
npm test
```

## 毎日の自動更新

`deploy/pages.yml` を `.github/workflows/pages.yml` にコピーして push し、リポジトリの Pages の配信元を GitHub Actions にすると、毎日索引を作り直して公開します。push には `gh auth refresh -s workflow` で得られる権限が必要です。

## 出典とライセンス

出典：e-Gov法令検索（https://laws.e-gov.go.jp/）、PDL1.0（https://www.digital.go.jp/resources/open_data/public_data_license_v1.0）

法令データは [houritsu](https://github.com/Kohei-Wada/houritsu)（Kohei-Wada、CC BY 4.0）を加工して利用しています。正本は官報です。このサイトは法的助言ではありません。

アイコンは [Phosphor Icons](https://phosphoricons.com/)（MIT）です。
