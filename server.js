const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bodyParser = require('body-parser');
const { randomBytes } = require('crypto');
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

// CONFIGURAÇÕES INICIAIS - altere se quiser antes de rodar
const ADMIN_PASS = process.env.ADMIN_PASS || 'minha-senha-admin'; // senha para o painel admin
const PORT = process.env.PORT || 3000;
const TOKEN = process.env.LINK_TOKEN || randomBytes(12).toString('hex'); // token do link que você irá enviar

// inicializa app
const app = express();
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// banco sqlite (arquivo links.db na pasta)
const db = new sqlite3.Database(path.join(__dirname, 'links.db'));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS link (
    token TEXT PRIMARY KEY,
    recipient_pass TEXT,
    message TEXT,
    created_at INTEGER,
    first_access INTEGER,
    expires_at INTEGER
  )`);
  // garante que exista registro para o TOKEN (cria vazio)
  db.get(`SELECT token FROM link WHERE token = ?`, [TOKEN], (err,row) => {
    if (!row) {
      const now = Date.now();
      db.run(`INSERT INTO link(token, recipient_pass, message, created_at, first_access, expires_at) VALUES(?,?,?,?,?,?)`,
        [TOKEN, null, null, now, null, null]);
      console.log('Link criado com token:', TOKEN);
    } else {
      console.log('Link já existente com token:', TOKEN);
    }
  });
});

// ---------- PÁGINA PÚBLICA (o link que você envia) ----------
// mostra formulário para entrar a senha do destinatário
app.get('/open/:token', (req,res) => {
  const token = req.params.token;
  db.get(`SELECT * FROM link WHERE token = ?`, [token], (err,row) => {
    if (err || !row) return res.status(404).send('<h1>Link inválido</h1>');
    // se message ainda não definido, mostra aviso (visível apenas depois que você adicionar pelo admin)
    const html = `
      <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Mensagem</title>
      <style>body{font-family:Arial,Helvetica,sans-serif;margin:24px} .box{max-width:640px;margin:0 auto}</style></head><body>
      <div class="box">
        <h2>Mensagem privada</h2>
        ${row.expires_at && Date.now() > row.expires_at ? '<p>Esta mensagem já expirou 💔</p>' : `
          <p>Insira a senha para visualizar a mensagem:</p>
          <form method="POST" action="/open/${token}">
            <input name="pass" type="password" placeholder="Senha" style="padding:8px;width:100%;max-width:300px"/>
            <div style="margin-top:12px">
              <button type="submit" style="padding:8px 14px">Abrir</button>
            </div>
          </form>
          ${row.message ? `<p style="margin-top:12px;color:#666">A mensagem já está pronta — insira a senha para visualizar.</p>` : `<p style="margin-top:12px;color:#999">Aguardando você adicionar a mensagem (você receberá instruções de como).</p>`}
        `}
      </div>
      </body></html>`;
    res.send(html);
  });
});

// processa senha submetida e mostra mensagem (se correta e não expirado)
app.post('/open/:token', (req,res) => {
  const token = req.params.token;
  const pass = req.body.pass || '';
  db.get(`SELECT * FROM link WHERE token = ?`, [token], (err,row) => {
    if (err || !row) return res.status(404).send('<h1>Link inválido</h1>');
    // já expirado?
    if (row.expires_at && Date.now() > row.expires_at) {
      return res.send('<h1>Esta mensagem expirou 💔</h1>');
    }
    // senha ainda não configurada pelo admin?
    if (!row.recipient_pass) {
      return res.send('<h1>Senha não configurada. Peça ao remetente para definir a senha.</h1>');
    }
    if (pass !== row.recipient_pass) {
      return res.send('<h1>Senha incorreta</h1><p><a href="/open/' + token + '">Tentar novamente</a></p>');
    }
    // se chegou aqui: senha correta. Se primeiro acesso, define primeiro_access e expires_at = agora + 24h
    if (!row.first_access) {
      const now = Date.now();
      const expires = now + 24*60*60*1000; // 24h
      db.run(`UPDATE link SET first_access = ?, expires_at = ? WHERE token = ?`, [now, expires, token]);
    }
    // exibe a mensagem (escape para evitar XSS)
   const message = row.message
  ? row.message  // não escapa HTML
  : '<i>Mensagem ainda não definida pelo remetente.</i>';
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sua mensagem</title>
      <style>body{font-family:Arial;margin:24px}</style></head><body>
      <div style="max-width:720px;margin:0 auto"><h2>Sua mensagem</h2><div style="padding:12px;border:1px solid #ddd;background:#fafafa">${message}</div></div>
      </body></html>`;
    res.send(html);
  });
});

// ---------- PAINEL ADMIN (configurar senha do destinatário e a mensagem) ----------
// simples autenticação via POST com ADMIN_PASS (env var)
app.get('/admin', (req,res) => {
  const html = `
    <!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Admin</title>
    <style>body{font-family:Arial;margin:24px} label{display:block;margin-top:12px}</style></head><body>
    <h2>Painel Admin</h2>
    <form method="POST" action="/admin/save">
      <label>Senha do admin: <input name="admin" type="password" /></label>
      <label>Senha do destinatário: <input name="recipient_pass" type="text" /></label>
      <label>Mensagem (texto): <textarea name="message" rows="8" style="width:100%"></textarea></label>
      <div style="margin-top:12px">
        <button type="submit">Salvar</button>
      </div>
    </form>
    <p style="margin-top:18px">Link público (envie este link para a pessoa): <strong>${req.protocol}://${req.get('host')}/open/${TOKEN}</strong></p>
    <p>Obs: o primeiro acesso acionará a contagem de 24h.</p>
    </body></html>
  `;
  res.send(html);
});

app.post('/admin/save', (req,res) => {
  const admin = req.body.admin || '';
  if (admin !== ADMIN_PASS) return res.send('<h1>Senha de admin incorreta</h1><p><a href="/admin">Voltar</a></p>');
  const recipient_pass = req.body.recipient_pass || null;
  const message = req.body.message || null;
  db.run(`UPDATE link SET recipient_pass = ?, message = ? WHERE token = ?`, [recipient_pass, message, TOKEN], (err) => {
    if (err) return res.status(500).send('Erro ao salvar');
    res.send(`<h1>Salvo com sucesso</h1><p>Link público: <a href="/open/${TOKEN}">${req.protocol}://${req.get('host')}/open/${TOKEN}</a></p><p><a href="/admin">Voltar</a></p>`);
  });
});

// inicializa servidor
app.get('/', (req, res) => {
  res.send(`
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Mensagem Lucas 💌</title>
      <style>
        body{font-family:Arial,sans-serif;text-align:center;padding:60px;background:#fff5f8;color:#444}
        h1{color:#d63384;}
        a{display:inline-block;margin-top:20px;padding:10px 18px;background:#d63384;color:#fff;text-decoration:none;border-radius:10px}
      </style>
    </head>
    <body>
      <h1>Bem-vindo 💌</h1>
      <p>Este site é usado para enviar mensagens privadas e que expiram.</p>
      <a href="/admin">Ir para o painel</a>
    </body>
    </html>
  `);
});

app.get('/', (req, res) => {
  res.redirect('/admin');
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(`Link público (env var OVERVIEW): http://localhost:${PORT}/open/${TOKEN}`);
  console.log(`Acesse /admin para configurar (senha admin = ADMIN_PASS env var)`);

});
