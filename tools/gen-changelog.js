#!/usr/bin/env node
/**
 * gen-changelog.js
 * Genera CHANGELOG.md con esquema de versión 0.MAJOR.COMMITS
 *
 * Uso:
 *   node tools/gen-changelog.js             → genera entrada con commits nuevos
 *   node tools/gen-changelog.js --new-major → sube el MAJOR y reinicia el contador
 *   node tools/gen-changelog.js --init      → inicializa majorStartHash al HEAD actual
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, '.version-config.json');
const CHANGELOG_FILE = path.join(ROOT, 'CHANGELOG.md');

// ── Helpers ────────────────────────────────────────────────────────────────

function git(cmd) {
  return execSync(`git -C "${ROOT}" ${cmd}`, { encoding: 'utf8' }).trim();
}

function headHash() {
  return git('rev-parse HEAD');
}

function commitsBetween(fromHash, toHash = 'HEAD') {
  const range = fromHash ? `${fromHash}..${toHash}` : toHash;
  const raw = git(`log ${range} --format="%H|||%s|||%ai" --no-merges`);
  return raw.split('\n').filter(Boolean).map(line => {
    const [hash, subject, date] = line.split('|||');
    return { hash: hash.substring(0, 7), subject: (subject || '').trim(), date: (date || '').split(' ')[0] };
  });
}

function countCommits(fromHash) {
  if (!fromHash) {
    return parseInt(git('rev-list --count HEAD'), 10);
  }
  return parseInt(git(`rev-list --count ${fromHash}..HEAD`), 10);
}

function cleanSubject(subject) {
  return subject
    .replace(/^(feat|fix|chore|refactor|docs|style|test|perf|build|ci)(\([^)]+\))?!?:\s*/i, '')
    .trim();
}

function today() {
  return new Date().toISOString().split('T')[0];
}

function updatePackageVersions(version) {
  ['server', 'client'].forEach(pkg => {
    const pkgFile = path.join(ROOT, pkg, 'package.json');
    if (!fs.existsSync(pkgFile)) return;
    const json = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    json.version = version;
    fs.writeFileSync(pkgFile, JSON.stringify(json, null, 2) + '\n');
  });
}

// ── Main ───────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const isNewMajor = args.includes('--new-major');
const isInit = args.includes('--init');

const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
let { major, majorStartHash, lastHash } = config;
const head = headHash();

// ── --init: establece el punto de inicio del major actual ──────────────────
if (isInit) {
  config.majorStartHash = head;
  config.lastHash = head;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  console.log(`✅ Inicializado: major=${major}, hash base=${head.substring(0, 7)}`);
  process.exit(0);
}

// ── --new-major: sube el MAJOR y reinicia contadores ──────────────────────
if (isNewMajor) {
  major += 1;
  config.major = major;
  config.majorStartHash = head;
  config.lastHash = head;
  const version = `0.${major}.0`;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
  updatePackageVersions(version);

  // Añade entrada al changelog marcando el nuevo hito
  const header = '# Changelog\n\n';
  const existing = fs.existsSync(CHANGELOG_FILE) ? fs.readFileSync(CHANGELOG_FILE, 'utf8') : header;
  const body = existing.startsWith(header) ? existing.slice(header.length) : existing;
  const entry = `## [${version}] - ${today()}\n\n> Inicio del ciclo ${version}\n\n`;
  fs.writeFileSync(CHANGELOG_FILE, header + entry + body);

  console.log(`✅ Nuevo major → v${version}`);
  console.log(`   Actualiza .version-config.json y haz commit para registrar el hito.`);
  process.exit(0);
}

// ── Generación normal ──────────────────────────────────────────────────────

// Si no hay hash base, usar todos los commits
const deltaCommits = commitsBetween(lastHash || null);

if (deltaCommits.length === 0) {
  console.log('ℹ️  No hay commits nuevos desde la última entrada del changelog.');
  process.exit(0);
}

// Patch = total commits desde inicio del major
const patchCount = countCommits(majorStartHash || null);
const version = `0.${major}.${patchCount}`;

// Agrupar por tipo
const feats = deltaCommits.filter(c => /^feat/i.test(c.subject));
const fixes = deltaCommits.filter(c => /^fix/i.test(c.subject));
const others = deltaCommits.filter(c => !/^(feat|fix|chore|ci|build)/i.test(c.subject));

// Construir entrada
let entry = `## [${version}] - ${today()}\n\n`;
if (feats.length) {
  entry += `### Nuevas Funcionalidades\n\n`;
  feats.forEach(c => { entry += `* ${cleanSubject(c.subject)} (${c.hash})\n`; });
  entry += '\n';
}
if (fixes.length) {
  entry += `### Correcciones\n\n`;
  fixes.forEach(c => { entry += `* ${cleanSubject(c.subject)} (${c.hash})\n`; });
  entry += '\n';
}
if (others.length) {
  entry += `### Otros cambios\n\n`;
  others.forEach(c => { entry += `* ${cleanSubject(c.subject)} (${c.hash})\n`; });
  entry += '\n';
}

// Prepend al changelog
const header = '# Changelog\n\n';
const existing = fs.existsSync(CHANGELOG_FILE) ? fs.readFileSync(CHANGELOG_FILE, 'utf8') : header;
const body = existing.startsWith(header) ? existing.slice(header.length) : existing;
fs.writeFileSync(CHANGELOG_FILE, header + entry + body);

// Actualizar package.json de server y client
updatePackageVersions(version);

// Guardar estado
config.lastHash = head;
fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');

console.log(`✅ Changelog actualizado → v${version}`);
console.log(`   ${feats.length} features, ${fixes.length} fixes, ${others.length} otros`);
console.log(`   ${deltaCommits.length} commit(s) incluidos en esta entrada`);
