// Gera os ícones do app (e o logo dos e-mails) a partir de public/logo.svg: `node scripts/icones.mjs`.
import { copyFileSync, readFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("public/logo.svg", "utf8");
// Lado do viewBox (quadrado): a densidade é calculada para rasterizar em 4× o tamanho final e reduzir (bordas nítidas).
const lado = Number(svg.match(/viewBox="0 0 ([\d.]+)/)[1]);
const densidade = (px) => (72 * px * 4) / lado;
copyFileSync("public/logo.svg", "src/app/icon.svg");
// iOS arredonda sozinho: o apple-icon vai sem cantos (fundo cheio).
await sharp(Buffer.from(svg.replace(/rx="[^"]*"/, 'rx="0"')), { density: densidade(180) })
  .resize(180, 180)
  .png()
  .toFile("src/app/apple-icon.png");
// E-mails: PNG 96×96 (exibido a 36 px, nítido em telas 2x/3x) servido em /logo.png.
await sharp(Buffer.from(svg), { density: densidade(96) }).resize(96, 96).png().toFile("public/logo.png");
console.log("icon.svg, apple-icon.png e public/logo.png gerados.");
