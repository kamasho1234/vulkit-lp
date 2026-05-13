# VULKIT メール通知設定

メール通知登録後の初回挨拶メールは、Vercel環境変数にメール送信サービスのAPIキーを設定すると有効になります。

## 推奨環境変数

- `RESEND_API_KEY`: ResendのAPIキー
- `EMAIL_FROM`: `KamaCrafy <ikemen@kamacrafy.com>`

## 迷惑メール対策

送信元を `ikemen@kamacrafy.com` にする場合、メール送信サービス側で `kamacrafy.com` ドメインを認証してください。

- SPF
- DKIM
- DMARC

上記のDNS認証が未設定の場合、Gmailや携帯キャリアメールで迷惑メールに入る可能性が高くなります。

## LP上の案内

メール登録フォーム、登録完了ポップアップ、初回挨拶メール内で、ユーザーに `ikemen@kamacrafy.com` の受信許可を案内しています。
