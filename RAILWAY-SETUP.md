# Railway設定（重要）

このプロジェクトは GitHub リポジトリのルートに以下がある構成で使います。

- package.json
- server.js
- railway.json
- public/index.html
- public/app.js
- public/style.css

Railway:
1. GitHubリポジトリをServiceとしてDeploy
2. Root Directoryを空欄（リポジトリのルート）にする
3. Start Commandは `npm start`
4. Public DomainをこのServiceに発行
5. そのPublic Domainを開く

確認URL:
`https://あなたのRailwayドメイン/health`

`ok: true` が返れば、このNode.jsサーバーに到達しています。

注意:
GitHub Pages等でpublic/index.htmlを別公開しないでください。
ゲーム画面とSocket.IOは同じRailway Serviceから配信します。
