const express = require('express');
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
      <form method="POST" action="/admin">
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
    `INSERT INTO links (toke

