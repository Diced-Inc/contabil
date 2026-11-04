// Gera os ícones do app a partir de public/logo.svg: `node scripts/icones.mjs`.
import { copyFileSync, readFileSync } from "node:fs";
import sharp from "sharp";

const svg = readFileSync("public/logo.svg", "utf8");
copyFileSync("public/logo.svg", "src/app/icon.svg");
// iOS arredonda sozinho: o apple-icon vai sem cantos (fundo cheio).
await sharp(Buffer.from(svg.replace(/rx="[^"]*"/, 'rx="0"')), { density: 72 * 180 / 32 })
  .resize(180, 180)
  .png()
  .toFile("src/app/apple-icon.png");
console.log("icon.svg e apple-icon.png gerados.");
