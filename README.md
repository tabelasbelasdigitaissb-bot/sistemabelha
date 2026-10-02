# Gestão Abelha

Sistema com login para acompanhar as pastas de tabelas do Google Drive e a divisão de empresas entre os cadastradores.

## Níveis de acesso

| Nível | Quem | O que pode |
|---|---|---|
| **Super admin** | você | Tudo. Edita tudo, cria e bloqueia qualquer pessoa, inclusive admins, e muda o nível das pessoas. |
| **Admin** | Carol | Vê as pastas do Drive, monta a divisão, cria e bloqueia cadastradores, vê quem está online. |
| **Cadastrador** | Luana, Bruna, Igor… | Só vê a própria lista de empresas, sem editar. Não vê a lista dos outros. |

Cada pessoa entra com e-mail e senha. A senha pode ser trocada em **Minha conta**. Se esquecer, dá para recuperar pelo e-mail (link de nova senha) ou entrar com um código por SMS, para quem cadastrou o celular.

## Arquivos

```
index.html            página
logo.png / favicon.png  logo da abelha
app.js                funcionamento do painel
estilo.css            visual
firebase-config.js    dados do seu projeto Firebase (você preenche)
firestore.rules       regras de segurança do banco (quem vê e edita o quê)
apps-script/          leitura automática do Drive (vai para o Google Apps Script, não para o GitHub Pages)
```

---

## Passo a passo

Faça tudo com a conta Google **dona das pastas do Drive** (a conta onde está a pasta "Tabelas Sistema Abelha Oficial").

### 1. Criar o projeto no Firebase

1. Entre em https://console.firebase.google.com e clique em **Adicionar projeto**. Dê um nome, por exemplo `gestao-abelha`. O Google Analytics pode ficar desligado.
2. Anote o **ID do projeto** (aparece embaixo do nome, algo como `gestao-abelha-1a2b3`).

### 2. Ligar o login

1. No menu, vá em **Authentication > Começar**.
2. Em **Método de login**, ative **E-mail/senha**.
3. Se quiser a recuperação por SMS, ative também **Telefone**. O envio de SMS exige o plano **Blaze** (pago por uso; para poucas pessoas o custo é de centavos). Sem ele, a recuperação funciona só pelo e-mail.
4. Em **Templates**, você pode traduzir o e-mail de redefinição de senha para português.

### 3. Criar o banco de dados

1. Vá em **Firestore Database > Criar banco de dados**.
2. Escolha o local **southamerica-east1 (São Paulo)** e o **modo de produção**.
3. Abra a aba **Regras**, apague o que estiver lá, cole todo o conteúdo do arquivo `firestore.rules` e clique em **Publicar**.

### 4. Ligar o site ao Firebase

1. Vá em **Configurações do projeto** (engrenagem) > **Seus apps** > ícone **</>** (Web). Dê um apelido e clique em **Registrar app**. Não precisa marcar o Firebase Hosting.
2. Copie os valores de `firebaseConfig` que aparecem e cole no arquivo `firebase-config.js`, no lugar dos `COLE_AQUI`.

> Esses dados não são senha: eles só dizem qual projeto o site usa. Quem protege os dados são as regras do passo 3.

### 5. Subir para o GitHub

1. Crie um repositório no GitHub, por exemplo `gestao-abelha`.
2. Envie os arquivos `index.html`, `app.js`, `estilo.css`, `logo.png`, `favicon.png`, `firebase-config.js`, `firestore.rules` e `README.md`. A pasta `apps-script` pode ir junto, só como cópia de segurança.
3. No repositório, vá em **Settings > Pages**. Em **Branch**, escolha `main` e a pasta `/ (root)`, e salve.
4. Em alguns minutos o endereço aparece ali, algo como `https://seuusuario.github.io/gestao-abelha/`.

### 6. Autorizar o endereço no Firebase

No Firebase, vá em **Authentication > Configurações > Domínios autorizados > Adicionar domínio** e coloque `seuusuario.github.io`.

### 7. Criar a sua conta (super admin)

1. Abra o site com `?instalar=1` no final: `https://seuusuario.github.io/gestao-abelha/?instalar=1`
2. Preencha nome, e-mail e senha. Essa tela só funciona uma vez; depois disso ninguém mais consegue se cadastrar como super admin.

### 8. Criar a Carol e os cadastradores

Entre no painel, vá na aba **Equipe** e use **Novo acesso**: nome, e-mail, senha provisória e nível. Crie a Carol como **Admin** e cada cadastrador como **Cadastrador**. Passe o e-mail e a senha provisória para cada um; eles trocam em **Minha conta**.

### 9. Ligar a leitura automática do Drive

Isso faz o painel se atualizar sozinho a cada 30 minutos, mesmo com ninguém usando.

1. **Tela de consentimento.** Entre em https://console.cloud.google.com, selecione o projeto do Firebase no topo, vá em **APIs e serviços > Tela de permissão OAuth** e configure: tipo **Externo**, nome do app, seu e-mail. Em **Usuários de teste**, adicione o seu e-mail.
2. **Número do projeto.** Ainda no Google Cloud, na página inicial do projeto, anote o **Número do projeto** (só números).
3. **Criar o script.** Entre em https://script.google.com e clique em **Novo projeto**. Apague o conteúdo e cole o arquivo `apps-script/Sincronizar.gs`. Troque `COLE_AQUI_O_ID_DO_PROJETO` pelo ID do passo 1.
4. **Manifesto.** Clique na engrenagem **Configurações do projeto**, marque **Mostrar arquivo de manifesto "appsscript.json" no editor**, volte ao editor, abra `appsscript.json` e substitua pelo conteúdo do arquivo `apps-script/appsscript.json`.
5. **Ligar ao projeto do Firebase.** Em **Configurações do projeto > Projeto do Google Cloud (GCP) > Alterar projeto**, cole o **número** do passo 2.
6. **Rodar.** No editor, escolha a função `instalarGatilho` e clique em **Executar**. Autorize o acesso quando o Google pedir.

No painel, a aba **Pastas do Drive** passa a mostrar as pastas e a hora da última leitura. Se ficar mais de 2 horas sem leitura, o painel avisa em vermelho.

---

## Dúvidas comuns

**Como tirar alguém?** Na aba Equipe, clique em **Bloquear acesso**. A pessoa sai na hora e não consegue mais entrar. As empresas dela continuam na grade até você passar para outra pessoa.

**Alguém esqueceu a senha.** Ela mesma pode clicar em **Esqueci minha senha** no login, ou você clica em **Enviar link de nova senha** na aba Equipe.

**Os cadastradores veem as pastas do Drive?** Não. Eles veem só a própria lista de empresas. Se quiser liberar, é uma mudança pequena no `app.js` e no `firestore.rules`.

**Mudou uma categoria de pasta ou o prazo de 7/15 dias?** Ajuste a lista `CATEGORIAS` no topo do `Sincronizar.gs`.
