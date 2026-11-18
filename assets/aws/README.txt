AWS アイコンの置き場所
======================

1. SVG をこのフォルダに置く（例: assets/aws/ec2.svg）
2. data/services.json の該当サービスに "icon" を追加する

   { "id": "ec2", "name": "EC2", ..., "icon": "assets/aws/ec2.svg" }

"icon" が無いサービスは、サービス色の四角いバッジで表示されます。
（存在しない画像を読みに行かないよう、icon を書いたものだけ読み込みます）

公式のアイコン（AWS Architecture Icons）は AWS のサイトから入手できます。
利用の条件は AWS のアイコン利用規約を確認してください。
