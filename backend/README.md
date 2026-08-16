# CriaFácilAI API

Backend com provedores intercambiáveis para manter todas as credenciais fora do aplicativo Flutter.

## Execução local

No PowerShell, defina as variáveis somente na sessão atual:

```powershell
$env:Path="D:\node-v24.19.0-win-x64\node-v24.19.0-win-x64;$env:Path"
$env:OPENAI_API_KEY="sua-chave"
$env:CLOUDFLARE_API_TOKEN="seu-token"
$env:CLOUDFLARE_ACCOUNT_ID="sua-conta"
$env:IMAGE_PROVIDER="cloudflare"
$env:ALLOWED_ORIGIN="http://localhost:porta-do-flutter-web"
$env:PORT="8080"
D:\node-v24.19.0-win-x64\node-v24.19.0-win-x64\npm.cmd start
```

Não use `setx` durante o desenvolvimento: a variável da sessão atual evita deixar a
chave persistida no perfil do usuário. Em produção, configure todas as credenciais no
gerenciador de segredos da plataforma e defina `ALLOWED_ORIGIN` com a origem HTTPS
exata do frontend. O arquivo `.env.example` contém apenas nomes e valores de exemplo.

## Provedores de imagem

Cloudflare Workers AI é o padrão e usa `@cf/black-forest-labs/flux-1-schnell`.
A rota pública permanece `POST /v1/images/generate` e sempre responde com
`{ "imageBase64": "..." }`.

Selecione o provedor exclusivamente por variável de ambiente:

```powershell
$env:IMAGE_PROVIDER="cloudflare" # padrão de desenvolvimento
$env:IMAGE_PROVIDER="openai"     # alternativa premium
```

Os modelos podem ser sobrescritos no servidor com `CLOUDFLARE_IMAGE_MODEL` e
`OPENAI_IMAGE_MODEL`. Não envie essas configurações nem credenciais pelo Flutter.

## Validação e testes

```powershell
$env:Path="D:\node-v24.19.0-win-x64\node-v24.19.0-win-x64;$env:Path"
D:\node-v24.19.0-win-x64\node-v24.19.0-win-x64\npm.cmd run check
D:\node-v24.19.0-win-x64\node-v24.19.0-win-x64\npm.cmd test
```

O aplicativo deve ser compilado apontando para uma URL HTTPS pública:

```powershell
flutter build apk --debug --dart-define=API_BASE_URL=https://seu-servidor.example
```

Nunca salve tokens ou chaves no Flutter, no APK, em logs ou em arquivos enviados ao Git.
