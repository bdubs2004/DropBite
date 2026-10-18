// A tiny local mail server for the end-to-end run: Supabase Auth sends its
// emails here (password resets), and each one is saved to $E2E_MAIL_DIR as
// <n>.eml for the checks to open, the way a person opens their inbox.
//
// Speaks just enough SMTP for Auth's mailer: EHLO, AUTH (anything accepted),
// MAIL, RCPT, DATA, QUIT. Nothing leaves the machine.
//
// It also serves supabase/templates/ over HTTP on $E2E_TEMPLATE_PORT, which is
// how Auth loads custom email templates, so the run sends the exact reset
// email production sends.
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';

const PORT = Number(process.env.E2E_SMTP_PORT);
const DIR = process.env.E2E_MAIL_DIR;
fs.mkdirSync(DIR, { recursive: true });
let count = 0;

net
  .createServer((sock) => {
    let buf = '';
    let inData = false;
    let authStep = 0;
    let data = [];
    let rcpt = [];
    const say = (line) => sock.write(line + '\r\n');
    say('220 e2e-smtp ready');
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (authStep) {
          authStep -= 1;
          say(authStep ? '334 UGFzc3dvcmQ6' : '235 OK');
          continue;
        }
        if (inData) {
          if (line === '.') {
            inData = false;
            const file = path.join(DIR, `${String(++count).padStart(3, '0')}.eml`);
            fs.writeFileSync(file, `X-E2E-To: ${rcpt.join(', ')}\r\n` + data.join('\r\n'));
            data = [];
            rcpt = [];
            say('250 OK saved');
          } else {
            data.push(line.startsWith('..') ? line.slice(1) : line);
          }
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') {
          say('250-e2e-smtp');
          say('250-AUTH PLAIN LOGIN');
          say('250 8BITMIME');
        } else if (cmd === 'HELO') say('250 e2e-smtp');
        else if (cmd === 'AUTH') {
          // AUTH LOGIN asks for the user, then the password, on lines of their own.
          if (/^AUTH LOGIN\s*$/i.test(line)) {
            authStep = 2;
            say('334 VXNlcm5hbWU6');
          } else say('235 OK');
        } else if (cmd === 'MAIL') say('250 OK');
        else if (cmd === 'RCPT') {
          rcpt.push(line.replace(/^RCPT TO:\s*/i, ''));
          say('250 OK');
        } else if (cmd === 'DATA') {
          inData = true;
          say('354 go ahead');
        } else if (cmd === 'RSET' || cmd === 'NOOP') say('250 OK');
        else if (cmd === 'QUIT') {
          say('221 bye');
          sock.end();
        } else say('250 OK');
      }
    });
    sock.on('error', () => {});
  })
  .listen(PORT, '127.0.0.1', () => console.log(`smtp sink on ${PORT}, saving to ${DIR}`));

if (process.env.E2E_TEMPLATE_PORT) {
  const TEMPLATES = process.env.E2E_TEMPLATES_DIR;
  http
    .createServer((req, res) => {
      const name = path.basename(decodeURIComponent(req.url.split('?')[0]));
      const file = path.join(TEMPLATES, name);
      if (!/^[\w-]+\.html$/.test(name) || !fs.existsSync(file)) {
        res.writeHead(404);
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(file));
    })
    .listen(Number(process.env.E2E_TEMPLATE_PORT), '127.0.0.1');
}
