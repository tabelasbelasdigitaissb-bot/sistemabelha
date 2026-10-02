import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  createUserWithEmailAndPassword, updatePassword, reauthenticateWithCredential, EmailAuthProvider,
  RecaptchaVerifier, signInWithPhoneNumber, linkWithPhoneNumber, unlink
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where,
  onSnapshot, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
auth.languageCode = "pt";
const db = getFirestore(app);

/* ───────────────────────── Constantes ───────────────────────── */
const PAPEIS = { dono: "Super admin", admin: "Admin", cadastrador: "Cadastrador" };
const CATEGORIAS = ["Construtoras", "Imobiliárias", "Investidores"];
const ORDEM = { vermelho: 0, laranja: 1, verde: 2, vazia: 3, manutencao: 4, semtabela: 5 };
const ROTULO = { vermelho: "ATRASADA", laranja: "ATENÇÃO", verde: "EM DIA", vazia: "SEM DATA", manutencao: "MANUTENÇÃO", semtabela: "SEM TABELA" };
const FILTRO_ROTULO = { vermelho: "Atrasadas", laranja: "Atenção", verde: "Em dia", vazia: "Sem data", manutencao: "Manutenção", semtabela: "Sem tabela" };
const COLS_PRAZOS = [
  { k: "nome", l: "NOME / PASTA", w: 340 },
  { k: "ultimaMexida", l: "DATA ÚLT. MEXIDA", w: 170, centro: true },
  { k: "dias", l: "DIAS PARADO", w: 150 },
  { k: "prazo", l: "ATUALIZA A CADA", w: 160 },
  { k: "situacao", l: "SITUAÇÃO", w: 170 }
];
const COLS_PESSOA = [
  { k: "nome", l: "EMPRESA", t: "texto", w: 200 },
  { k: "cadastros", l: "CADASTROS", t: "numero", w: 112, centro: true },
  { k: "atualizacao", l: "ATUALIZAÇÃO", t: "data", w: 132, centro: true },
  { k: "movimento", l: "MOVIMENTO", t: "texto", w: 118, centro: true },
  { k: "conferencia", l: "CONFERÊNCIA", t: "texto", w: 138 },
  { k: "obs", l: "OBSERVAÇÃO", t: "texto", w: 190 }
];
const ONLINE_MS = 3 * 60 * 1000;
const OPCOES_PRAZO = [7, 10, 15, 20, 30];

/* ───────────────────────── Estado ───────────────────────── */
const S = {
  user: null, perfil: null, usuarios: {}, pastas: {}, empresas: {}, prazos: {}, sincronizando: false,
  rotulos: { prazos: {}, pessoa: {} }, drive: {},
  aba: null, cat: "Todas", filtro: null, busca: "", ordem: { k: "dias", dir: -1 },
  assinaturas: [], batimento: null, recemSms: false, instalando: false, confirmacao: null
};
const ehAdmin = () => S.perfil && (S.perfil.papel === "admin" || S.perfil.papel === "dono");
const ehDono = () => S.perfil && S.perfil.papel === "dono";

/* ───────────────────────── Utilidades ───────────────────────── */
const $ = id => document.getElementById(id);
const raiz = $("app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const slug = s => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 140) || "item";
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const br = s => { if (!s) return ""; const [a, m, d] = String(s).split("-"); return `${d}/${m}/${a}`; };

function lerData(v) {
  const m = String(v ?? "").match(/(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})/);
  if (!m) return "";
  let a = Number(m[3]); if (a < 100) a += 2000;
  const d = new Date(a, Number(m[2]) - 1, Number(m[1]));
  return isNaN(d) || d.getDate() !== Number(m[1]) ? "" : iso(d);
}
// A coluna Cadastros da planilha antiga está formatada como data (0 aparece como 30.12.99)
function lerCadastros(v) {
  const t = String(v ?? "").trim();
  if (!t) return "";
  const m = t.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (m) {
    let a = Number(m[3]);
    if (a < 100) a = a >= 99 ? 1899 : 1900 + a;
    return Math.round((Date.UTC(a, Number(m[2]) - 1, Number(m[1])) - Date.UTC(1899, 11, 30)) / 86400000);
  }
  const dig = t.replace(/[^\d]/g, "");
  return dig === "" ? "" : Number(dig);
}
function diasDesde(s) {
  if (!s) return null;
  const [a, m, d] = String(s).split("-").map(Number);
  const h = new Date(); h.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((h - new Date(a, m - 1, d)) / 86400000));
}
// Prazo da pasta: o que a admin escolheu no painel, senão o padrão da categoria
function prazoDe(p) {
  const id = p.driveId || p.id;
  const ajuste = S.prazos[id] && Number(S.prazos[id].dias);
  return ajuste || Number(p.periodicidade) || 15;
}
function statusDe(p) {
  if (p.situacao === "Manutenção") return "manutencao";
  if (p.situacao === "Sem tabela") return "semtabela";
  const d = diasDesde(p.ultimaMexida);
  if (d === null) return "vazia";
  const per = prazoDe(p);
  if (d > per) return "vermelho";
  if (d > per - 4) return "laranja";
  return "verde";
}
const ehCabecalho = t => /^(nome|pasta|empresa)\b|^nome\s*\/\s*pasta/.test(norm(t));
const rotulo = (tipo, c) => (S.rotulos[tipo] && S.rotulos[tipo][c.k]) || c.l;

function telefoneE164(t) {
  const d = String(t ?? "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 10 || d.length === 11) return "+55" + d;
  return "+" + d;
}
const mostrarTelefone = t => {
  const d = String(t || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) return `(${d.slice(2, 4)}) ${d.slice(4, d.length - 4)}-${d.slice(-4)}`;
  return t || "";
};

let toastTimer;
function toast(t) {
  const el = $("toast"); el.textContent = t; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.hidden = true), 4000);
}
function erroTexto(e) {
  const c = (e && e.code) || "";
  const m = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/user-not-found": "E-mail ou senha incorretos.",
    "auth/invalid-login-credentials": "E-mail ou senha incorretos.",
    "auth/too-many-requests": "Muitas tentativas seguidas. Espere alguns minutos e tente de novo.",
    "auth/email-already-in-use": "Já existe uma conta com esse e-mail.",
    "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/missing-email": "Digite o e-mail.",
    "auth/invalid-phone-number": "Número de celular inválido. Use DDD e número, por exemplo 13 99999-9999.",
    "auth/missing-phone-number": "Digite o número do celular.",
    "auth/invalid-verification-code": "Código incorreto. Confira o SMS e tente de novo.",
    "auth/code-expired": "O código expirou. Peça um novo.",
    "auth/requires-recent-login": "Por segurança, digite sua senha atual (ou entre de novo) para continuar.",
    "auth/operation-not-allowed": "Esse tipo de acesso ainda não foi ativado no Firebase.",
    "auth/credential-already-in-use": "Esse celular já está ligado a outra conta.",
    "auth/provider-already-linked": "Já existe um celular ligado a esta conta.",
    "auth/quota-exceeded": "Limite de SMS atingido por hoje. Tente amanhã ou use a recuperação por e-mail.",
    "auth/billing-not-enabled": "O envio de SMS precisa do plano Blaze ativo no Firebase.",
    "auth/network-request-failed": "Sem conexão com a internet.",
    "permission-denied": "Você não tem permissão para fazer isso."
  };
  return m[c] || "Algo deu errado" + (c ? ` (${c})` : "") + ". Tente de novo.";
}

let verificador = null;
function recaptcha() {
  if (!verificador) verificador = new RecaptchaVerifier(auth, "recaptcha", { size: "invisible" });
  return verificador;
}
function zerarRecaptcha() { try { verificador && verificador.clear(); } catch (_) {} verificador = null; $("recaptcha").innerHTML = ""; }

/* ───────────────────────── Tela de login ───────────────────────── */
function telaLogin(modo = "login", msg = null) {
  pararTudo();
  if (modo === "login" && new URLSearchParams(location.search).has("instalar")) modo = "instalar";
  const aviso = msg ? `<p class="msg ${msg.ok ? "ok" : ""}">${esc(msg.t)}</p>` : "";
  const voltar = `<div class="links"><button class="link" data-modo="login">Voltar para o login</button></div>`;
  let corpo = "";
  if (modo === "login") corpo = `
    <h2>Entrar</h2>
    <form class="form" id="fLogin">
      <label>E-mail<input type="email" id="lEmail" autocomplete="username" required></label>
      <label>Senha<input type="password" id="lSenha" autocomplete="current-password" required></label>
      <button class="btn principal grande" type="submit">Entrar</button>
    </form>
    <div class="links"><button class="link" data-modo="reset">Esqueci minha senha</button>
      <button class="link" data-modo="sms">Entrar com código no celular</button></div>`;
  else if (modo === "reset") corpo = `
    <h2>Recuperar senha pelo e-mail</h2>
    <form class="form" id="fReset">
      <label>E-mail da sua conta<input type="email" id="rEmail" autocomplete="username" required></label>
      <button class="btn principal grande" type="submit">Enviar link para criar nova senha</button>
    </form>${voltar}`;
  else if (modo === "sms") corpo = S.confirmacao ? `
    <h2>Digite o código do SMS</h2>
    <form class="form" id="fCodigo">
      <label>Código de 6 dígitos<input id="sCodigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
      <button class="btn principal grande" type="submit">Entrar</button>
    </form>${voltar}` : `
    <h2>Entrar com código no celular</h2>
    <p class="ajuda">Funciona para quem já cadastrou o celular em “Minha conta”. Depois de entrar você pode criar uma senha nova.</p>
    <form class="form" id="fSms" style="margin-top:12px">
      <label>Celular com DDD<input type="tel" id="sTel" autocomplete="tel" placeholder="13 99999-9999" required></label>
      <button class="btn principal grande" type="submit">Enviar código por SMS</button>
    </form>${voltar}`;
  else if (modo === "instalar") corpo = `
    <h2>Primeiro acesso: criar a conta do super admin</h2>
    <p class="ajuda">Só funciona uma vez. Essa conta fica acima de todas as outras.</p>
    <form class="form" id="fInstalar" style="margin-top:12px">
      <label>Seu nome<input id="iNome" required></label>
      <label>E-mail<input type="email" id="iEmail" autocomplete="username" required></label>
      <label>Senha<input type="password" id="iSenha" autocomplete="new-password" minlength="6" required></label>
      <label>Repita a senha<input type="password" id="iSenha2" autocomplete="new-password" minlength="6" required></label>
      <button class="btn principal grande" type="submit">Criar conta do super admin</button>
    </form>`;

  raiz.innerHTML = `<div class="tela-login"><div class="cartao-login">
    <div class="marca"><img class="logo" src="logo.png" alt=""><div><h1>Gestão Abelha</h1><span>Tabelas e cadastradores</span></div></div>
    ${aviso}${corpo}</div></div>`;

  raiz.querySelectorAll("[data-modo]").forEach(b => b.onclick = () => { S.confirmacao = null; telaLogin(b.dataset.modo); });
  const ocupado = (f, sim) => f.querySelectorAll("button,input").forEach(x => (x.disabled = sim));

  const fLogin = $("fLogin");
  if (fLogin) fLogin.onsubmit = async e => {
    e.preventDefault(); ocupado(fLogin, true);
    try { await signInWithEmailAndPassword(auth, $("lEmail").value.trim(), $("lSenha").value); }
    catch (err) { telaLogin("login", { t: erroTexto(err) }); }
  };
  const fReset = $("fReset");
  if (fReset) fReset.onsubmit = async e => {
    e.preventDefault(); ocupado(fReset, true);
    try {
      await sendPasswordResetEmail(auth, $("rEmail").value.trim());
      telaLogin("login", { t: "Se esse e-mail tiver conta, chegou um link para criar a nova senha. Confira também o spam.", ok: true });
    } catch (err) { telaLogin("reset", { t: erroTexto(err) }); }
  };
  const fSms = $("fSms");
  if (fSms) fSms.onsubmit = async e => {
    e.preventDefault(); ocupado(fSms, true);
    try {
      S.confirmacao = await signInWithPhoneNumber(auth, telefoneE164($("sTel").value), recaptcha());
      telaLogin("sms", { t: "Enviamos um código por SMS.", ok: true });
    } catch (err) { zerarRecaptcha(); telaLogin("sms", { t: erroTexto(err) }); }
  };
  const fCodigo = $("fCodigo");
  if (fCodigo) fCodigo.onsubmit = async e => {
    e.preventDefault(); ocupado(fCodigo, true);
    try { S.recemSms = true; await S.confirmacao.confirm($("sCodigo").value.trim()); S.confirmacao = null; }
    catch (err) { S.recemSms = false; telaLogin("sms", { t: erroTexto(err) }); }
  };
  const fInstalar = $("fInstalar");
  if (fInstalar) fInstalar.onsubmit = async e => {
    e.preventDefault();
    if ($("iSenha").value !== $("iSenha2").value) { telaLogin("instalar", { t: "As senhas não são iguais." }); return; }
    ocupado(fInstalar, true);
    const nome = $("iNome").value.trim(), email = $("iEmail").value.trim();
    S.instalando = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, $("iSenha").value);
      const lote = writeBatch(db);
      lote.set(doc(db, "users", cred.user.uid), { nome, email, papel: "dono", telefone: "", ativo: true, online: true, criadoEm: serverTimestamp() });
      lote.set(doc(db, "config", "instalacao"), { dono: cred.user.uid, em: serverTimestamp() });
      try { await lote.commit(); }
      catch (err) {
        await cred.user.delete().catch(() => {});
        S.instalando = false;
        telaLogin("instalar", { t: "O sistema já tem um super admin. Entre pelo login normal." });
        return;
      }
      S.instalando = false;
      history.replaceState(null, "", location.pathname);
      await entrar(cred.user);
    } catch (err) { S.instalando = false; telaLogin("instalar", { t: erroTexto(err) }); }
  };
}

/* ───────────────────────── Sessão ───────────────────────── */
onAuthStateChanged(auth, async u => {
  if (S.instalando) return;
  if (!u) { S.user = null; S.perfil = null; telaLogin(); return; }
  await entrar(u);
});

async function entrar(u) {
  S.user = u;
  let snap;
  try { snap = await getDoc(doc(db, "users", u.uid)); } catch (_) { snap = null; }
  if (!snap || !snap.exists()) {
    const soCelular = u.providerData.every(p => p.providerId === "phone");
    if (soCelular) {
      await u.delete().catch(() => signOut(auth));
      telaLogin("sms", { t: "Esse celular não está ligado a nenhuma conta. Entre com e-mail e senha e cadastre o celular em “Minha conta”." });
    } else {
      await signOut(auth);
      telaLogin("login", { t: "Seu acesso ainda não foi liberado. Fale com o administrador." });
    }
    return;
  }
  if (snap.data().ativo !== true) { await signOut(auth); telaLogin("login", { t: "Seu acesso está bloqueado. Fale com o administrador." }); return; }
  S.perfil = snap.data();
  iniciarPainel();
}

function pararTudo() {
  S.assinaturas.forEach(f => { try { f(); } catch (_) {} });
  S.assinaturas = [];
  clearInterval(S.batimento); S.batimento = null;
}

async function sair() {
  try { await updateDoc(doc(db, "users", S.user.uid), { online: false }); } catch (_) {}
  pararTudo();
  S.recemSms = false; S.usuarios = {}; S.pastas = {}; S.empresas = {};
  await signOut(auth);
}

function batimento() {
  if (!S.user) return;
  updateDoc(doc(db, "users", S.user.uid), { online: true, ultimoAcesso: serverTimestamp() }).catch(() => {});
}

function iniciarPainel() {
  pararTudo();
  const uid = S.user.uid;
  S.aba = ehAdmin() ? "prazos" : "minhas";

  raiz.innerHTML = `
    <header class="topo">
      <div class="marca"><img class="logo" src="logo.png" alt="">
        <div><h1>Gestão Abelha</h1><div class="estado" id="quem"></div></div></div>
      <div class="acoes-topo"><button class="btn" id="btnSair">Sair</button></div>
    </header>
    <nav class="secoes" role="tablist" id="abas"></nav>
    <main id="conteudo"></main>`;
  $("btnSair").onclick = sair;

  batimento();
  S.batimento = setInterval(batimento, 60 * 1000);

  const vigiar = (alvo, fn) => S.assinaturas.push(onSnapshot(alvo, fn, err => console.warn(err)));
  vigiar(doc(db, "users", uid), snap => {
    if (!snap.exists() || snap.data().ativo !== true) { sair(); return; }
    S.perfil = snap.data(); pedirDesenho();
  });
  vigiar(doc(db, "config", "colunas"), snap => {
    const d = snap.exists() ? snap.data() : {};
    S.rotulos = { prazos: { ...(d.prazos || {}) }, pessoa: { ...(d.pessoa || {}) } };
    pedirDesenho();
  });
  const paraMapa = snap => { const m = {}; snap.forEach(d => (m[d.id] = d.data())); return m; };
  if (ehAdmin()) {
    vigiar(doc(db, "config", "drive"), snap => { S.drive = snap.exists() ? snap.data() : {}; pedirDesenho(); });
    vigiar(collection(db, "pastas"), snap => { S.pastas = paraMapa(snap); pedirDesenho(); });
    vigiar(collection(db, "empresas"), snap => { S.empresas = paraMapa(snap); pedirDesenho(); });
    vigiar(collection(db, "users"), snap => { S.usuarios = paraMapa(snap); pedirDesenho(); });
    vigiar(collection(db, "prazos"), snap => { S.prazos = paraMapa(snap); pedirDesenho(); });
  } else {
    vigiar(query(collection(db, "empresas"), where("responsavelUid", "==", uid)), snap => { S.empresas = paraMapa(snap); pedirDesenho(); });
  }
  // atualiza "dias parado" e o status online sem precisar recarregar
  S.assinaturas.push((() => { const t = setInterval(pedirDesenho, 60 * 1000); return () => clearInterval(t); })());
  desenhar();
}

/* ───────────────────────── Desenho ───────────────────────── */
let pendente = false;
const editando = () => {
  const a = document.activeElement;
  if (a && a.closest && a.closest(".grade, .caixa form") && a.matches("input,select,button")) return true;
  return [...document.querySelectorAll(".caixa form input")].some(i => i.value);
};
function pedirDesenho() { if (editando()) { pendente = true; return; } desenhar(); }
document.addEventListener("focusout", () => setTimeout(() => { if (pendente && !editando()) { pendente = false; desenhar(); } }, 0));

let grades = {};
function desenhar(foco) {
  if (!S.perfil || !$("conteudo")) return;
  grades = {};
  $("quem").innerHTML = `${esc(S.perfil.nome)}<span class="papel">${PAPEIS[S.perfil.papel] || ""}</span>`;

  const atrasadas = Object.values(S.pastas).filter(p => statusDe(p) === "vermelho").length;
  const online = Object.values(S.usuarios).filter(estaOnline).length;
  const abas = ehAdmin()
    ? [["prazos", `Pastas do Drive${atrasadas ? `<span class="alerta">${atrasadas}</span>` : ""}`],
       ["divisao", "Divisão por cadastrador"], ["equipe", `Equipe <small style="font-weight:500">(${online} online)</small>`], ["conta", "Minha conta"]]
    : [["minhas", "Minhas empresas"], ["conta", "Minha conta"]];
  $("abas").innerHTML = abas.map(([id, t]) => `<button class="secao-btn" role="tab" data-aba="${id}" aria-selected="${S.aba === id}">${t}</button>`).join("");

  const telas = { prazos: telaPrazos, divisao: telaDivisao, equipe: telaEquipe, conta: telaConta, minhas: telaMinhas };
  $("conteudo").innerHTML = (telas[S.aba] || telaConta)();
  ligarFormularios();
  if (foco) focar(foco.g, foco.id, foco.c);
}
function focar(g, id, c) {
  const alvo = [...document.querySelectorAll(".grade [data-g]")].find(el => el.dataset.g === g && el.dataset.id === id && el.dataset.c === String(c));
  if (alvo) { alvo.focus(); if (alvo.select) alvo.select(); }
}
function estaOnline(u) {
  if (!u || !u.online || !u.ultimoAcesso || !u.ultimoAcesso.toMillis) return false;
  return Date.now() - u.ultimoAcesso.toMillis() < ONLINE_MS;
}

/* ───── Pastas do Drive (só leitura; quem escreve é o Apps Script) ───── */
function telaPrazos() {
  const todas = Object.entries(S.pastas).map(([id, p]) => ({ id, ...p, status: statusDe(p), dias: diasDesde(p.ultimaMexida) }));
  const base = todas.filter(p => S.cat === "Todas" || p.categoria === S.cat);
  const termo = norm(S.busca);
  const { k, dir } = S.ordem;
  const chave = p => k === "dias" ? (p.dias ?? -1) : k === "prazo" ? prazoDe(p) : k === "situacao" ? ORDEM[p.status] : k === "ultimaMexida" ? (p.ultimaMexida || "") : norm(p[k]);
  const linhas = base.filter(p => !S.filtro || p.status === S.filtro).filter(p => !termo || norm(p.nome).includes(termo))
    .sort((a, b) => { const x = chave(a), y = chave(b); return (x < y ? -1 : x > y ? 1 : 0) * dir || a.nome.localeCompare(b.nome, "pt-BR"); });

  const ult = S.drive.ultimaLeitura ? new Date(S.drive.ultimaLeitura) : null;
  const velha = !ult || Date.now() - ult.getTime() > 2 * 60 * 60 * 1000;
  const info = ult
    ? `Última leitura do Drive: ${ult.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}. A leitura é automática a cada ${S.drive.intervaloMinutos || 10} minutos.`
    : "O Drive ainda não foi lido. Confira se o Apps Script de sincronização está instalado.";

  const cab = COLS_PRAZOS.map(c => {
    const seta = S.ordem.k === c.k ? (S.ordem.dir > 0 ? "▲" : "▼") : "⇅";
    return `<th style="width:${c.w}px"><div class="cab">
      <input class="cab-input" data-rotulo="prazos:${c.k}" value="${esc(rotulo("prazos", c))}" aria-label="Nome da coluna" title="Clique para renomear">
      <button class="ordem-btn" data-ordem="${c.k}" title="Ordenar">${seta}</button></div></th>`;
  }).join("");
  const corpo = linhas.map((p, r) => `<tr class="s-${p.status}">
      <td class="num-linha">${r + 1}</td>
      <td>${p.link ? `<a class="valor" style="display:flex;align-items:center;height:32px;padding:0 8px;color:inherit" href="${esc(p.link)}" target="_blank" rel="noopener">${esc(p.nome)}</a>` : `<span class="valor">${esc(p.nome)}</span>`}</td>
      <td class="centro"><span class="valor">${esc(br(p.ultimaMexida)) || "—"}</span></td>
      <td class="forte-${p.status}"><div class="ro">${p.dias === null ? "—" : p.dias + (p.dias === 1 ? " dia" : " dias")}</div></td>
      <td class="centro">${celulaPrazo(p)}</td>
      <td class="forte-${p.status}"><div class="ro">${ROTULO[p.status]}</div></td></tr>`).join("");
  const largura = 36 + COLS_PRAZOS.reduce((t, c) => t + c.w, 0);

  return `
    <div class="barra-filtros">
      <div class="grupo"><span class="grupo-titulo">Categoria</span>
        ${["Todas", ...CATEGORIAS].map(c => `<button class="chip" data-cat="${esc(c)}" aria-pressed="${c === S.cat}">${esc(c)} ${c === "Todas" ? todas.length : todas.filter(p => p.categoria === c).length}</button>`).join("")}
      </div>
    </div>
    <div class="barra-filtros" style="padding-top:0">
      <div class="grupo">${Object.keys(ORDEM).map(s => { const n = base.filter(p => p.status === s).length; if (!n && s === "vazia") return "";
        return `<button class="chip" data-filtro="${s}" aria-pressed="${S.filtro === s}"><i class="forte-${s}"></i>${FILTRO_ROTULO[s]} ${n}</button>`; }).join("")}</div>
      <input class="busca" type="search" id="campoBusca" placeholder="Procurar pasta" value="${esc(S.busca)}">
    </div>
    <div class="barra-drive"><button class="btn peq principal" data-acao="sincronizar" ${S.sincronizando ? "disabled" : ""}>${S.sincronizando ? "Lendo o Drive…" : "Sincronizar agora"}</button>
      <span class="drive-info ${velha && ult ? "aviso-leitura" : ""}">${esc(info)}${velha && ult ? " Faz mais de 2 horas: a leitura automática pode ter parado." : ""}</span></div>
    <div class="rolagem"><table class="grade" style="width:${largura}px">
      <thead><tr><th style="width:36px"></th>${cab}</tr></thead>
      <tbody>${corpo || `<tr><td colspan="6" style="padding:14px;color:var(--suave)">Nenhuma pasta aqui.</td></tr>`}</tbody></table></div>`;
}

function celulaPrazo(p) {
  const id = p.driveId || p.id;
  const atual = prazoDe(p);
  const ajustado = !!(S.prazos[id] && Number(S.prazos[id].dias));
  const opcoes = [...new Set([...OPCOES_PRAZO, atual])].sort((a, b) => a - b);
  return `<select data-prazo="${esc(id)}" aria-label="Atualiza a cada quantos dias: ${esc(p.nome)}" title="${ajustado ? "Ajustado no painel" : "Padrão da categoria"}"
    style="${ajustado ? "font-weight:700" : ""}">${opcoes.map(d => `<option value="${d}" ${d === atual ? "selected" : ""}>${d} dias</option>`).join("")}</select>`;
}

/* ───── Grades de empresas ───── */
const cadastradores = () => Object.entries(S.usuarios).filter(([, u]) => u.papel === "cadastrador")
  .map(([uid, u]) => ({ uid, ...u })).sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "pt-BR"));

function telaDivisao() {
  const pessoas = cadastradores();
  const uids = new Set(pessoas.map(p => p.uid));
  const empresas = Object.entries(S.empresas).map(([id, e]) => ({ id, ...e }));
  const orfas = empresas.filter(e => !uids.has(e.responsavelUid));
  if (!pessoas.length) return `<p class="dica" style="padding-top:20px">Cadastre os cadastradores na aba “Equipe” para montar as grades.</p>`;
  const blocos = pessoas.filter(p => p.ativo !== false || empresas.some(e => e.responsavelUid === p.uid)).map(p => {
    const minhas = empresas.filter(e => e.responsavelUid === p.uid).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    const g = "p:" + p.uid;
    grades[g] = { ids: minhas.map(e => e.id), uid: p.uid };
    const imoveis = minhas.reduce((t, e) => t + (Number(e.cadastros) || 0), 0);
    return `<section class="bloco"><div class="bloco-topo"><h2><span class="ponto ${estaOnline(p) ? "on" : ""}" title="${estaOnline(p) ? "Online" : "Offline"}"></span>${esc(p.nome)}${p.ativo === false ? " (bloqueado)" : ""}</h2>
      <span>${minhas.length} ${minhas.length === 1 ? "empresa" : "empresas"}, ${imoveis} imóveis</span></div>${grade(g, minhas, true)}</section>`;
  });
  if (orfas.length) {
    grades["orfas"] = { ids: orfas.map(e => e.id), uid: "" };
    blocos.push(`<section class="bloco sem-resp"><div class="bloco-topo"><h2>Sem responsável</h2><span>${orfas.length} empresas</span></div>${grade("orfas", orfas, true, true)}</section>`);
  }
  return `<p class="legenda" style="padding-top:16px"><b>Movimento:</b> ALT = alteração, E = entrada de imóvel novo, S = saída (vendido, locado, reservado). Exemplo: <b>s1 e1 alt 4</b>. Cole na grade de cada pessoa as empresas que ficam com ela.</p>
    <div class="lado-a-lado">${blocos.join("")}</div>`;
}

function telaMinhas() {
  const minhas = Object.entries(S.empresas).map(([id, e]) => ({ id, ...e })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const imoveis = minhas.reduce((t, e) => t + (Number(e.cadastros) || 0), 0);
  return `<p class="legenda" style="padding-top:16px"><b>Movimento:</b> ALT = alteração, E = entrada de imóvel novo, S = saída (vendido, locado, reservado).</p>
    <div class="lado-a-lado"><section class="bloco"><div class="bloco-topo"><h2>Minhas empresas</h2><span>${minhas.length} empresas, ${imoveis} imóveis</span></div>
    ${minhas.length ? grade("minhas", minhas, false) : `<p class="ajuda">Nenhuma empresa foi passada para você ainda.</p>`}</section></div>`;
}

function grade(g, linhas, editavel, semNova) {
  const ro = editavel ? "" : "disabled";
  const largura = 36 + COLS_PESSOA.reduce((t, c) => t + c.w, 0) + (editavel ? 34 : 0);
  const cab = COLS_PESSOA.map(c => `<th style="width:${c.w}px"><div class="cab">
      <input class="cab-input" data-rotulo="pessoa:${c.k}" value="${esc(rotulo("pessoa", c))}" ${ehAdmin() ? "" : "disabled"} aria-label="Nome da coluna"></div></th>`).join("");
  const celula = (c, ci, e) => {
    const v = c.t === "data" ? br(e[c.k]) : (e[c.k] ?? "");
    const alerta = c.k === "movimento" && /sem tabela|manutenc/.test(norm(e.movimento)) ? "mov-alerta" : "";
    if (!editavel) return `<td class="${c.centro ? "centro" : ""} ${alerta}"><span class="valor" ${alerta ? 'style="color:var(--vermelho);font-weight:700"' : ""}>${esc(v)}</span></td>`;
    return `<td class="${c.centro ? "centro" : ""} ${alerta}"><input data-g="${esc(g)}" data-id="${esc(e.id)}" data-c="${ci}" value="${esc(v)}" ${ro}
      ${c.t === "data" ? 'placeholder="dd/mm/aaaa" inputmode="numeric"' : c.t === "numero" ? 'inputmode="numeric"' : ""} aria-label="${esc(c.l)} de ${esc(e.nome)}"></td>`;
  };
  const corpo = linhas.map((e, r) => `<tr><td class="num-linha">${r + 1}</td>${COLS_PESSOA.map((c, ci) => celula(c, ci, e)).join("")}
      ${editavel ? `<td class="apagar"><button data-acao="apagarEmpresa" data-id="${esc(e.id)}" title="Apagar linha" aria-label="Apagar ${esc(e.nome)}">×</button></td>` : ""}</tr>`).join("");
  const nova = editavel && !semNova ? `<tr class="novo"><td class="num-linha">+</td>
      <td><input data-g="${esc(g)}" data-id="novo" data-c="0" placeholder="Nova empresa ou colar aqui" aria-label="Nova empresa"></td>
      ${COLS_PESSOA.slice(1).map(() => "<td></td>").join("")}<td></td></tr>` : "";
  return `<table class="grade" style="width:${largura}px"><thead><tr><th style="width:36px"></th>${cab}${editavel ? '<th style="width:34px"></th>' : ""}</tr></thead>
    <tbody>${corpo}${nova}</tbody></table>`;
}

/* ───── Equipe ───── */
function telaEquipe() {
  const lista = Object.entries(S.usuarios).map(([uid, u]) => ({ uid, ...u }))
    .sort((a, b) => ["dono", "admin", "cadastrador"].indexOf(a.papel) - ["dono", "admin", "cadastrador"].indexOf(b.papel) || (a.nome || "").localeCompare(b.nome || "", "pt-BR"));
  const podeMexer = u => u.uid !== S.user.uid && (ehDono() ? u.papel !== "dono" : u.papel === "cadastrador");
  const linhas = lista.map(u => {
    const ultimo = u.ultimoAcesso && u.ultimoAcesso.toDate ? u.ultimoAcesso.toDate().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "nunca";
    const papelCel = ehDono() && podeMexer(u)
      ? `<select data-papel="${u.uid}">${["admin", "cadastrador"].map(p => `<option value="${p}" ${u.papel === p ? "selected" : ""}>${PAPEIS[p]}</option>`).join("")}</select>`
      : PAPEIS[u.papel] || u.papel;
    return `<tr class="${u.ativo === false ? "bloqueado" : ""}">
      <td><span class="ponto ${estaOnline(u) ? "on" : ""}"></span>${estaOnline(u) ? "Online" : "Offline"}<br><small style="color:var(--suave)">visto ${esc(ultimo)}</small></td>
      <td><b>${esc(u.nome)}</b>${u.uid === S.user.uid ? " (você)" : ""}<br><small>${esc(u.email)}</small></td>
      <td>${papelCel}</td>
      <td>${esc(mostrarTelefone(u.telefone)) || "—"}</td>
      <td>${podeMexer(u) ? `<div class="botoes">
        <button class="btn peq" data-acao="${u.ativo === false ? "liberar" : "bloquear"}" data-uid="${u.uid}">${u.ativo === false ? "Liberar acesso" : "Bloquear acesso"}</button>
        <button class="btn peq" data-acao="resetSenha" data-email="${esc(u.email)}">Enviar link de nova senha</button></div>` : ""}</td></tr>`;
  }).join("");
  return `<div class="painel">
    <section class="caixa"><h2>Pessoas com acesso</h2>
      <div class="rolagem" style="padding:0"><table class="tabela"><thead><tr><th>Status</th><th>Nome</th><th>Nível</th><th>Celular</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>
      <p class="ajuda" style="margin-top:10px">Bloquear tira o acesso na hora. As empresas da pessoa continuam na grade dela até você passar para outra.</p>
    </section>
    <section class="caixa"><h2>Novo acesso</h2>
      <form class="grade-form form" id="fNovo">
        <label>Nome<input id="nNome" required></label>
        <label>E-mail<input type="email" id="nEmail" required></label>
        <label>Senha provisória<input type="text" id="nSenha" minlength="6" required autocomplete="off"></label>
        <label>Nível<select id="nPapel">${(ehDono() ? ["cadastrador", "admin"] : ["cadastrador"]).map(p => `<option value="${p}">${PAPEIS[p]}</option>`).join("")}</select></label>
        <button class="btn principal" type="submit">Criar acesso</button>
      </form>
      <p class="ajuda" style="margin-top:10px">Passe o e-mail e a senha provisória para a pessoa. Ela pode trocar a senha em “Minha conta”.</p>
    </section></div>`;
}

/* ───── Minha conta ───── */
function telaConta() {
  const temCel = S.user.providerData.some(p => p.providerId === "phone");
  const recente = S.recemSms || (Date.now() - new Date(S.user.metadata.lastSignInTime).getTime() < 4 * 60 * 1000);
  return `<div class="painel">
    <section class="caixa"><h2>Seus dados</h2>
      <p style="margin:0">${esc(S.perfil.nome)}<br><span class="ajuda">${esc(S.perfil.email)} · ${PAPEIS[S.perfil.papel]}</span></p></section>
    <section class="caixa"><h2>Trocar senha</h2>
      <form class="form" id="fSenha" style="max-width:360px">
        ${recente ? "" : `<label>Senha atual<input type="password" id="cAtual" autocomplete="current-password" required></label>`}
        <label>Nova senha<input type="password" id="cNova" autocomplete="new-password" minlength="6" required></label>
        <label>Repita a nova senha<input type="password" id="cNova2" autocomplete="new-password" minlength="6" required></label>
        <button class="btn principal" type="submit">Salvar nova senha</button>
      </form></section>
    <section class="caixa"><h2>Celular para recuperar o acesso</h2>
      <p class="ajuda" style="margin-bottom:12px">${temCel ? `Celular cadastrado: <b>${esc(mostrarTelefone(S.perfil.telefone || S.user.phoneNumber))}</b>. Se esquecer a senha, use “Entrar com código no celular” na tela de login.` : "Cadastre seu celular para poder entrar com um código por SMS se esquecer a senha."}</p>
      ${S.confirmacaoCel ? `
        <form class="form" id="fCelCodigo" style="max-width:360px">
          <label>Código recebido por SMS<input id="cCelCodigo" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>
          <button class="btn principal" type="submit">Confirmar celular</button></form>` : `
        <form class="form" id="fCel" style="max-width:360px">
          <label>${temCel ? "Novo celular" : "Celular"} com DDD<input type="tel" id="cCel" placeholder="13 99999-9999" required></label>
          <button class="btn principal" type="submit">Enviar código</button></form>`}
    </section></div>`;
}

/* ───────────────────────── Formulários das telas ───────────────────────── */
function ligarFormularios() {
  const fSenha = $("fSenha");
  if (fSenha) fSenha.onsubmit = async e => {
    e.preventDefault();
    if ($("cNova").value !== $("cNova2").value) { toast("As senhas novas não são iguais."); return; }
    try {
      if ($("cAtual")) await reauthenticateWithCredential(S.user, EmailAuthProvider.credential(S.user.email, $("cAtual").value));
      await updatePassword(S.user, $("cNova").value);
      S.recemSms = false; fSenha.reset(); toast("Senha alterada.");
    } catch (err) { toast(erroTexto(err)); }
  };
  const fCel = $("fCel");
  if (fCel) fCel.onsubmit = async e => {
    e.preventDefault();
    const tel = telefoneE164($("cCel").value);
    try {
      if (S.user.providerData.some(p => p.providerId === "phone")) await unlink(S.user, "phone");
      S.confirmacaoCel = await linkWithPhoneNumber(S.user, tel, recaptcha());
      S.telPendente = tel; toast("Enviamos um código por SMS."); desenhar();
    } catch (err) { zerarRecaptcha(); toast(erroTexto(err)); }
  };
  const fCelCodigo = $("fCelCodigo");
  if (fCelCodigo) fCelCodigo.onsubmit = async e => {
    e.preventDefault();
    try {
      await S.confirmacaoCel.confirm($("cCelCodigo").value.trim());
      await updateDoc(doc(db, "users", S.user.uid), { telefone: S.telPendente });
      S.confirmacaoCel = null; toast("Celular confirmado."); desenhar();
    } catch (err) { toast(erroTexto(err)); }
  };
  const fNovo = $("fNovo");
  if (fNovo) fNovo.onsubmit = async e => {
    e.preventDefault();
    const nome = $("nNome").value.trim(), email = $("nEmail").value.trim(), senha = $("nSenha").value, papel = $("nPapel").value;
    fNovo.querySelectorAll("input,button,select").forEach(x => (x.disabled = true));
    // cria a conta numa instância separada para o administrador continuar logado
    const app2 = initializeApp(firebaseConfig, "criacao-" + Date.now());
    try {
      const auth2 = getAuth(app2);
      const cred = await createUserWithEmailAndPassword(auth2, email, senha);
      await signOut(auth2);
      await setDoc(doc(db, "users", cred.user.uid), { nome, email, papel, telefone: "", ativo: true, online: false, criadoEm: serverTimestamp(), criadoPor: S.user.uid });
      toast(`Acesso criado para ${nome}.`);
      fNovo.reset();
    } catch (err) { toast(erroTexto(err)); }
    finally { deleteApp(app2).catch(() => {}); fNovo.querySelectorAll("input,button,select").forEach(x => (x.disabled = false)); }
  };
}

/* ───────────────────────── Empresas: gravar e colar ───────────────────────── */
function gravarEmpresa(id, dados) {
  S.empresas[id] = dados;
  return setDoc(doc(db, "empresas", id), dados).catch(err => toast(erroTexto(err)));
}
function novoIdEmpresa(nome) {
  let base = slug(nome), id = base, i = 2;
  while (S.empresas[id]) id = `${base}-${i++}`;
  return id;
}
function valor(col, txt) {
  if (col.t === "data") return lerData(txt);
  if (col.t === "numero") return lerCadastros(txt);
  return String(txt ?? "").trim();
}
async function receberEmpresas(uid, linhas) {
  let novas = 0, movidas = 0;
  for (const cel of linhas) {
    if (!cel[0] || !cel[0].trim() || ehCabecalho(cel[0])) continue;
    const campos = {};
    cel.forEach((t, j) => { const c = COLS_PESSOA[j]; if (c) campos[c.k] = valor(c, t); });
    const id = Object.keys(S.empresas).find(k => norm(S.empresas[k].nome) === norm(campos.nome));
    if (id) {
      if (S.empresas[id].responsavelUid !== uid) movidas++;
      await gravarEmpresa(id, { ...S.empresas[id], ...campos, responsavelUid: uid });
    } else {
      await gravarEmpresa(novoIdEmpresa(campos.nome), { cadastros: "", atualizacao: "", movimento: "", conferencia: "", obs: "", ...campos, responsavelUid: uid });
      novas++;
    }
  }
  const partes = [];
  if (novas) partes.push(`${novas} ${novas === 1 ? "empresa adicionada" : "empresas adicionadas"}`);
  if (movidas) partes.push(`${movidas} ${movidas === 1 ? "veio" : "vieram"} de outro cadastrador`);
  if (partes.length) toast(partes.join(", ") + ".");
}

let enterNaNova = false;
document.addEventListener("change", async e => {
  const el = e.target;
  if (el.dataset.rotulo && ehAdmin()) {
    const [tipo, k] = el.dataset.rotulo.split(":");
    const padrao = (tipo === "prazos" ? COLS_PRAZOS : COLS_PESSOA).find(c => c.k === k).l;
    const novo = el.value.trim().toUpperCase() || padrao;
    el.value = novo;
    S.rotulos = { ...S.rotulos, [tipo]: { ...S.rotulos[tipo], [k]: novo } };
    setDoc(doc(db, "config", "colunas"), S.rotulos).catch(err => toast(erroTexto(err)));
    return;
  }
  if (el.dataset.prazo && ehAdmin()) {
    const dias = Number(el.value);
    S.prazos[el.dataset.prazo] = { dias };
    setDoc(doc(db, "prazos", el.dataset.prazo), { dias, alteradoPor: S.user.uid, em: serverTimestamp() })
      .then(() => toast(`Prazo alterado para ${dias} dias.`)).catch(err => toast(erroTexto(err)));
    el.blur(); desenhar();
    return;
  }
  if (el.dataset.papel && ehDono()) {
    updateDoc(doc(db, "users", el.dataset.papel), { papel: el.value }).then(() => toast("Nível alterado.")).catch(err => toast(erroTexto(err)));
    return;
  }
  if (!el.dataset.g || !ehAdmin()) return;
  const gr = grades[el.dataset.g];
  if (!gr) return;
  if (el.dataset.id === "novo") {
    const txt = el.value.trim();
    if (!txt) return;
    el.value = "";
    await receberEmpresas(gr.uid, [[txt]]);
    desenhar();
    if (enterNaNova) { enterNaNova = false; focar(el.dataset.g, "novo", 0); }
    return;
  }
  const atual = S.empresas[el.dataset.id];
  if (!atual) return;
  const col = COLS_PESSOA[Number(el.dataset.c)];
  const v = valor(col, el.value);
  if (col.k === "nome" && !v) { el.value = atual.nome; return; }
  if (col.t === "data" && el.value.trim() && !v) { toast("Data não reconhecida. Use dd/mm/aaaa."); el.value = br(atual[col.k]); return; }
  if (col.t === "data") el.value = br(v);
  gravarEmpresa(el.dataset.id, { ...atual, [col.k]: v });
  pedirDesenho();
});

document.addEventListener("paste", async e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.g || !ehAdmin()) return;
  const texto = (e.clipboardData || window.clipboardData).getData("text/plain");
  if (!texto || (!texto.includes("\t") && !texto.replace(/\r?\n$/, "").includes("\n"))) return;
  e.preventDefault();
  const gr = grades[el.dataset.g];
  const linhas = texto.replace(/\r/g, "").split("\n").filter(l => l.trim() !== "").map(l => l.split("\t"));
  const c0 = Number(el.dataset.c);
  if (c0 === 0 && (el.dataset.id === "novo" || linhas.length > 1)) {
    toast(`Colando ${linhas.length} linhas…`);
    await receberEmpresas(gr.uid, linhas);
  } else {
    const r0 = gr.ids.indexOf(el.dataset.id);
    if (r0 < 0) return;
    let n = 0;
    for (let i = 0; i < linhas.length && r0 + i < gr.ids.length; i++) {
      const id = gr.ids[r0 + i], atual = S.empresas[id];
      if (!atual) continue;
      const campos = {};
      linhas[i].forEach((t, j) => { const c = COLS_PESSOA[c0 + j]; if (c && !(c.k === "nome" && !t.trim())) campos[c.k] = valor(c, t); });
      await gravarEmpresa(id, { ...atual, ...campos }); n++;
    }
    toast(`${n} ${n === 1 ? "linha preenchida" : "linhas preenchidas"}.`);
  }
  desenhar({ g: el.dataset.g, id: el.dataset.id, c: el.dataset.c });
});

document.addEventListener("keydown", e => {
  const el = e.target;
  if (!el.dataset || !el.dataset.g || el.tagName !== "INPUT") return;
  let passo = 0;
  if (e.key === "Enter") passo = e.shiftKey ? -1 : 1;
  else if (e.key === "ArrowDown") passo = 1;
  else if (e.key === "ArrowUp") passo = -1;
  if (!passo) return;
  e.preventDefault();
  if (el.dataset.id === "novo" && e.key === "Enter") { enterNaNova = true; el.blur(); return; }
  const gr = grades[el.dataset.g];
  const r = el.dataset.id === "novo" ? gr.ids.length : gr.ids.indexOf(el.dataset.id);
  const destino = r + passo;
  if (destino < 0) return;
  if (destino >= gr.ids.length) focar(el.dataset.g, "novo", 0);
  else focar(el.dataset.g, gr.ids[destino], el.dataset.c);
});

document.addEventListener("click", async e => {
  const t = e.target.closest("button");
  if (!t || !S.perfil) return;
  if (t.dataset.aba) { S.aba = t.dataset.aba; S.confirmacaoCel = null; desenhar(); return; }
  if (t.dataset.cat !== undefined) { S.cat = t.dataset.cat; desenhar(); return; }
  if (t.dataset.filtro) { S.filtro = S.filtro === t.dataset.filtro ? null : t.dataset.filtro; desenhar(); return; }
  if (t.dataset.ordem) {
    const k = t.dataset.ordem;
    S.ordem = S.ordem.k === k ? { k, dir: -S.ordem.dir } : { k, dir: k === "dias" ? -1 : 1 };
    desenhar(); return;
  }
  const acao = t.dataset.acao;
  if (acao === "sincronizar" && ehAdmin()) {
    if (!S.drive.urlSincronizar) { toast("O botão ainda não está ligado ao Apps Script. A leitura automática continua funcionando."); return; }
    S.sincronizando = true; desenhar();
    try { await fetch(S.drive.urlSincronizar, { mode: "no-cors" }); toast("Drive lido. As pastas foram atualizadas."); }
    catch (_) { toast("Não consegui pedir a leitura agora. Tente de novo em instantes."); }
    S.sincronizando = false; desenhar();
    return;
  }
  if (acao === "apagarEmpresa" && ehAdmin()) {
    const atual = S.empresas[t.dataset.id];
    if (atual && confirm(`Apagar "${atual.nome}"?`)) {
      delete S.empresas[t.dataset.id];
      deleteDoc(doc(db, "empresas", t.dataset.id)).catch(err => toast(erroTexto(err)));
      desenhar();
    }
  } else if ((acao === "bloquear" || acao === "liberar") && ehAdmin()) {
    const u = S.usuarios[t.dataset.uid];
    if (acao === "bloquear" && !confirm(`Bloquear o acesso de ${u.nome}?`)) return;
    updateDoc(doc(db, "users", t.dataset.uid), { ativo: acao === "liberar", ...(acao === "bloquear" ? { online: false } : {}) })
      .then(() => toast(acao === "liberar" ? "Acesso liberado." : "Acesso bloqueado.")).catch(err => toast(erroTexto(err)));
  } else if (acao === "resetSenha" && ehAdmin()) {
    sendPasswordResetEmail(auth, t.dataset.email).then(() => toast("Link de nova senha enviado para " + t.dataset.email)).catch(err => toast(erroTexto(err)));
  }
});

document.addEventListener("input", e => {
  if (e.target.id !== "campoBusca") return;
  S.busca = e.target.value;
  const pos = e.target.selectionStart;
  desenhar();
  const b = $("campoBusca"); if (b) { b.focus(); b.setSelectionRange(pos, pos); }
});

document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") batimento(); });
