const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const path = require('path');
const { randomBytes } = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'minha-senha-admin';

app.set('trust proxy', true);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

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

function generateToken() {
  return randomBytes(4).toString('hex');
}

let lastOpened = null;

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
        #alerta{
          display:none;
          background:#d63384;
          color:white;
          font-weight:bold;
          padding:14px;
          border-radius:10px;
          max-width:600px;
          margin:0 auto 20px auto;
          box-shadow:0 4px 16px rgba(0,0,0,0.2);
        }
      </style>
    </head>
    <body>
      <h2>💌 Painel de Mensagens</h2>
      <div id="alerta">💌 Uma mensagem foi aberta recentemente!</div>

      <form method="POST" action="/admin">
        <input type="password" name="admin_pass" placeholder="Senha admin" required>
        <input type="password" name="recipient_pass" placeholder="Senha para o destinatário" required>
        <textarea name="message" rows="10" placeholder="Escreva sua mensagem (HTML permitido)"></textarea>
        <button type="submit">Salvar mensagem</button>
      </form>

      <script>
        async function checkOpened(){
          try {
            const res = await fetch('/last-opened');
            const data = await res.json();
            if(data.new){
              document.getElementById('alerta').style.display = 'block';
            }
          } catch(e){}
        }
        setInterval(checkOpened, 5000);
      </script>
    </body>
    </html>
  `);
});

app.post('/admin', (req, res) => {
  const { admin_pass, recipient_pass, message } = req.body;
  if (admin_pass !== ADMIN_PASS) return res.send('<h2>Senha de admin incorreta.</h2>');

  const token = generateToken();
  db.run(
    `INSERT INTO links (token, message, recipient_pass, first_access, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [token, message, recipient_pass, 0, null],
    (err) => {
      if (err) return res.send('<h2>Erro ao salvar no banco.</h2>');
      res.send(`
        <h2>Mensagem salva com sucesso!</h2>
        <p>Link público:</p>
        <a href="/open/${token}">https://mensagem-lucas.onrender.com/open/${token}</a>
      `);
    }
  );
});

app.get('/last-opened', (req, res) => {
  if (!lastOpened) return res.json({ new: false });
  const diff = Date.now() - lastOpened.time;
  if (diff < 60000) return res.json({ new: true }); // aparece até 1 minuto depois
  res.json({ new: false });
});

app.get('/open/:token', (req, res) => {
  const { token } = req.params;
  db.get(`SELECT * FROM links WHERE token = ?`, [token], (err, row) => {
    if (!row) return res.send('<h2>Link inválido.</h2>');
    const isExpired = row.expires_at && Date.now() > row.expires_at;
    res.send(`
      <!doctype html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Mensagem Privada</title>
        <style>
          body{
            font-family:Inter,Arial,sans-serif;
            background:linear-gradient(270deg,#ffafbd,#ffc3a0,#ffafbd);
            background-size:600% 600%;
            animation:bgmove 10s ease infinite;
            min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
          }
          @keyframes bgmove{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
          .card{background:#fff;border-radius:18px;padding:26px;box-shadow:0 10px 30px rgba(15,23,42,0.08);max-width:600px;text-align:center;animation:fadein 1s ease-in}
          input{width:100%;padding:12px 14px;margin-top:10px;border:1px solid #ddd;border-radius:10px}
          button{background:#d63384;color:#fff;border:none;padding:10px 16px;border-radius:10px;margin-top:12px;cursor:pointer;font-weight:bold}
        </style>
      </head>
      <body>
        <div class="card">
          ${
            isExpired
              ? `<h2>💔 Mensagem expirada</h2><p>Desculpe, essa mensagem não está mais disponível.</p>`
              : `<h2>🔒 Mensagem privada</h2>
                 <form method="POST" action="/open/${token}">
                   <input type="password" name="pass" placeholder="Digite a senha" required>
                   <button type="submit">Abrir</button>
                 </form>`
          }
        </div>
      </body>
      </html>
    `);
  });
});

app.post('/open/:token', (req, res) => {
  const { token } = req.params, { pass } = req.body;
  db.get(`SELECT * FROM links WHERE token = ?`, [token], (err, row) => {
    if (!row) return res.send('<h2>Link inválido.</h2>');
    if (pass !== row.recipient_pass) return res.send('<h2>Senha incorreta.</h2>');

    let expiresAt = row.expires_at;
    if (!row.first_access) {
      expiresAt = Date.now() + 24 * 60 * 60 * 1000;
      db.run(`UPDATE links SET first_access = 1, expires_at = ? WHERE token = ?`, [expiresAt, token]);
    }
    if (expiresAt && Date.now() > expiresAt) return res.send('<h2>💔 Essa mensagem expirou.</h2>');

    lastOpened = { token, time: Date.now() }; // registra abertura

    res.send(`<h2>Mensagem aberta com sucesso!</h2><p>${row.message}</p>`);
  });
});

app.get('/', (req, res) => res.redirect('/admin'));
app.listen(PORT, () => console.log('Servidor rodando na porta', PORT));
