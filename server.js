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

let lastOpened = null; // 🆕 Guarda o último acesso confirmado

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
        #toast{
          position:fixed;bottom:30px;right:30px;background:#d63384;color:white;
          padding:14px 22px;border-radius:10px;box-shadow:0 6px 18px rgba(0,0,0,0.2);
          opacity:0;transform:translateY(20px);transition:all .5s ease;font-weight:bold;z-index:9999;
        }
        #toast.show{opacity:1;transform:translateY(0);}
      </style>
    </head>
    <body>
      <h2>💌 Painel de Mensagens</h2>
      <form method="POST" action="/admin">
        <input type="password" name="admin_pass" placeholder="Senha admin" required>
        <input type="password" name="recipient_pass" placeholder="Senha para o destinatário" required>
        <textarea name="message" rows="10" placeholder="Escreva sua mensagem (HTML permitido)"></textarea>
        <button type="submit">Salvar mensagem</button>
      </form>

      <div id="toast">💌 Uma mensagem foi aberta agora!</div>

      <script>
        async function checkOpened(){
          try {
            const res = await fetch('/last-opened');
            const data = await res.json();
            if(data.new){
              const toast = document.getElementById('toast');
              toast.classList.add('show');
              setTimeout(()=>toast.classList.remove('show'),5000);
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
  // Endpoint que o admin checa a cada 5s
  if (!lastOpened) return res.json({ new: false });
  const diff = Date.now() - lastOpened.time;
  if (diff < 6000) return res.json({ new: true }); // se abriu há menos de 6s
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
          @keyframes fadein{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
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

    // 🆕 Marca como "aberta" para o painel admin
    lastOpened = { token, time: Date.now() };

    res.send(`
      <!doctype html>
      <html lang="pt-BR">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Mensagem</title>
        <style>
          body{
            font-family:Arial,sans-serif;
            background:linear-gradient(270deg,#ffafbd,#ffc3a0,#ffafbd);
            background-size:600% 600%;
            animation:bgmove 15s ease infinite;
            margin:0;color:#333;text-align:left;
          }
          @keyframes bgmove{0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}
          .card{
            background:#fff;border-radius:18px;padding:26px;box-shadow:0 10px 30px rgba(15,23,42,0.08);
            max-width:800px;width:90%;margin:40px auto;white-space:pre-line;line-height:1.6;animation:fadein 1.5s ease-in;
          }
          @keyframes fadein{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
          img{width:100%;max-height:450px;object-fit:cover;border-radius:18px 18px 0 0;margin-bottom:20px;animation:fadein 2s ease-in}
          .audio-btn{display:block;margin:10px auto 20px auto;padding:10px 20px;font-size:18px;background:#d63384;color:#fff;border:none;border-radius:10px;cursor:pointer;transition:all 0.3s}
          .audio-btn.playing{animation:pulse 1.5s infinite;background:#e84393}
          @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(214,51,132,0.4)}70%{box-shadow:0 0 0 10px rgba(214,51,132,0)}100%{box-shadow:0 0 0 0 rgba(214,51,132,0)}}
        </style>
      </head>
      <body>
        <div class="card">
          <img src="/images/WhatsApp Image 2025-11-20 at 17.14.20.jpeg" alt="Foto">
          <button class="audio-btn" id="toggleMusic" onclick="toggleMusic()">🎵 Tocar música</button>
          ${row.message || '<i>Sem mensagem.</i>'}
          <audio id="bgmusic1" src="/music/MC Kako - Ísis (734 Acústico) [rmYCuGJcQAY].mp3"></audio>
          <audio id="bgmusic2" src="/music/Kako - Sozinha (OCANV) [2pD75RmaKJo].mp3"></audio>
          <audio id="bgmusic3" src="/music/MC Kako - Quadro (734 Acústico) [ugZcLcfe8ZQ].mp3"></audio>
        </div>
        <script>
          const musics=[bgmusic1,bgmusic2,bgmusic3];
          let current=0,playing=false;
          musics.forEach((m,i)=>{m.volume=0.2;m.addEventListener('ended',()=>{current=(i+1)%musics.length;musics[current].play();});});
          const btn=document.getElementById('toggleMusic');
          function toggleMusic(){
            if(playing){musics[current].pause();btn.textContent="🎵 Tocar música";btn.classList.remove('playing');playing=false;}
            else{musics[current].play();btn.textContent="⏸️ Pausar música";btn.classList.add('playing');playing=true;}
          }
        </script>
      </body>
      </html>
    `);
  });
});

app.get('/', (req, res) => res.redirect('/admin'));
app.listen(PORT, () => console.log('Servidor rodando na porta', PORT));
