// Roda o placa.js (o mesmo do app) nas fotos, no PC. Uso: node prototipo/testar-js.js
// sharp emprestado do app Dose de N (nao precisa instalar nada aqui).
const path = require('path'), fs = require('fs');
const sharp = require(path.join(__dirname, '../../APP dose NVER MET e MEE/node_modules/sharp'));
const Placa = require('../placa');
const geo = JSON.parse(fs.readFileSync(path.join(__dirname, '../placas/placa-24.json'), 'utf8'));
const modelo = Placa.criarModelo(geo);
const fotos = [...fs.readdirSync('Fotos Soja plaquinha').filter(f => f.endsWith('.jpeg')).map(f => 'Fotos Soja plaquinha/' + f),
  'ArcUco soja 1.jpeg', 'ArcUco soja 2.jpeg'];
(async () => {
  for (const f of fotos) {
    const { data, info } = await sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const r = Placa.contar(data, info.width, info.height, modelo);
    const nome = path.basename(f).replace('WhatsApp Image 2026-10-12 at ', '');
    if (!r.ok) { console.log(nome, 'FALHOU', r.motivo, r.marcadores.map(m => m.id)); continue; }
    const c = { ocupado: 0, vazio: 0, duvidoso: 0 }; r.furos.forEach(x => c[x.estado]++);
    console.log(`${nome.padEnd(22)} ${JSON.stringify(c)} extra: ${r.anomalias.map(a => `${a.area.toFixed(0)}mm2@${a.pertoDoFuro}`).join(', ') || '-'}` +
      `  ids ${r.enc.ids} descart ${r.enc.cantosDescartados} erro ${r.enc.erroMedio.toFixed(1)}px ${r.ms}ms`);
    const v = r.vista; await sharp(Buffer.from(v.buffer), { raw: { width: r.W, height: r.A, channels: 4 } }).jpeg().toFile(path.join(process.env.TEMP, 'js_' + nome + '.jpg'));
  }
})();
