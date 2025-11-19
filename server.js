const express = require('express');
app.set('trust proxy', true);
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const { randomBytes } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'minha-senha-admin';

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== Banco de dados =====
const db = new sqlite3.Database('./links.db');
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS links (
      token TEXT PRIMARY KEY,
      message TEXT,
      recipient_pass TEXT,
      first_access INTEGER,
      expires_at INTEGER
    )
  `);
});

// ===== Funções auxiliares =====
function generateToken() {
  return randomBytes(4).toString('hex');
}

// ===== Rotas =====

// Painel admin
app.get('/admin', (req, res) => {
  res.send(`
    <!doctype html>
    <html lang="pt-BR">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Painel Admin</title>
      <style>
        body{font-family:Arial,sans-serif;background:#fff5f8;margin:0;padding:40px;text-align:center;color:#444}
        form{background:white;padding:20px;border-radius:14px;max-width:600px;margin:auto;box-shadow:0 8px 24px rgba(0,0,0,0.08)}
        input,textarea{width:100%;margin:8px 0;padding:10px;border-radius:10px;border:1px solid #ddd;font-size:14px}
        button{background:#d63384;color:#fff;border:none;padding:10px 18px;border-radius:10px;cursor:pointer;font-weight:bold}
      </style>
    </head>
    <body>
      <h2>💌 Painel de Mensagens</h2>
      <form method="POST" action="https://mensagem-lucas.onrender.com/admin">
        <input type="password" name="admin_pass" placeholder="Senha admin" required>
        <input type="password" name="recipient_pass" placeholder="Senha para o destinatário" required>
        <textarea name="message" rows="8" placeholder="Escreva sua mensagem (HTML permitido)"></textarea>
        <button type="submit">Salvar mensagem</button>
      </form>
    </body>
    </html>
  `);
});

// Salvar mensagem
app.post('/admin', (req, res) => {
  const { admin_pass, recipient_pass, message } = req.body;
  if (admin_pass !== ADMIN_PASS) {
    return res.send('<h2>Senha de admin incorreta.</h2>');
  }

  const token = generateToken();
  const expiresAt = null; // define quando o link for aberto

  db.run(
    `INSERT INTO links (token, message, recipient_pass, first_access, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [token, message, recipient_pass, 0, expiresAt],
    (err) => {
      if (err) return res.send('<h2>Erro ao salvar no banco.</h2>');
      res.send(`
        <h2>Mensagem salva com sucesso!</h2>
        <p>Link público:</p>
        <a href="/open/${token}">/open/${token}</a>
      `);
    }
  );
});

// Visual bonito das páginas
app.get('/open/:token', (req, res) => {
  const { token } = req.params;

  db.get(`SELECT * FROM links WHERE token = ?`, [token], (err, row) => {
    if (!row) return res.send('<h2>Link inválido.</h2>');

    const isExpired = row.expires_at && Date.now() > row.expires_at;
    const html = `
      <!doctype html>
      <html lang="pt-BR">
      <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Mensagem Privada</title>
      <style>
        body{font-family:Inter,Arial,sans-serif;background:linear-gradient(180deg,#fbfbff,#f1f4fb);color:#111;
        min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
        .card{background:#fff;border-radius:18px;padding:26px;box-shadow:0 10px 30px rgba(15,23,42,0.08);max-width:600px}
        input{width:100%;padding:12px 14px;margin-top:10px;border:1px solid #ddd;border-radius:10px}
        button{background:#d63384;color:#fff;border:none;padding:10px 16px;border-radius:10px;margin-top:12px;cursor:pointer;font-weight:bold}
      </style>
      </head>
      <body>
        <div class="card">
          ${isExpired ? `
            <h2>💔 Mensagem expirada</h2>
            <p>Desculpe, essa mensagem não está mais disponível.</p>
          ` : `
            <h2>🔒 Mensagem privada</h2>
            <form method="POST" action="/open/${token}">
              <input type="password" name="pass" placeholder="Digite a senha" required>
              <button type="submit">Abrir</button>
            </form>
          `}
        </div>
      </body>
      </html>
    `;
    res.send(html);
  });
});

app.post('/open/:token', (req, res) => {
  const { token } = req.params;
  const { pass } = req.body;

  db.get(`SELECT * FROM links WHERE token = ?`, [token], (err, row) => {
    if (!row) return res.send('<h2>Link inválido.</h2>');
    if (pass !== row.recipient_pass) return res.send('<h2>Senha incorreta.</h2>');

    let expiresAt = row.expires_at;
    if (!row.first_access) {
      expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      db.run(`UPDATE links SET first_access = 1, expires_at = ? WHERE token = ?`, [expiresAt, token]);
    }

    const isExpired = expiresAt && Date.now() > expiresAt;
    if (isExpired) return res.send('<h2>💔 Essa mensagem expirou.</h2>');

    const message = row.message || '<i>Sem mensagem.</i>';
    res.send(`
      <!doctype html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Mensagem</title>
        <style>
          body{font-family:Arial,sans-serif;background:#fff5f8;display:flex;justify-content:center;align-items:center;
          height:100vh;margin:0;color:#333;text-align:center}
          .card{background:#fff;border-radius:18px;padding:26px;box-shadow:0 10px 30px rgba(15,23,42,0.08);
          max-width:600px}
          img{max-width:100%;border-radius:14px;margin-top:14px}
        </style>
      </head>
      <body>
        <div class="card">
          ${message}
          <p style="font-size:13px;color:#999;margin-top:12px;">Expira em 24h após o primeiro acesso.</p>
        </div>
      </body>
      </html>
    `);
  });
});

// ===== Redirecionamento da raiz =====
app.get('/', (req, res) => {
  res.redirect('/admin');
});

// ===== Inicia servidor =====
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

