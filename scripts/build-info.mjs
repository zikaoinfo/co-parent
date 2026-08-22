// Génère les métadonnées de version à partir de git : numéro de build (nombre
// de commits de la branche, donc incrémenté à chaque fusion sur main), commit
// court déployé et date de ce commit.
//
// Deux sorties, mêmes valeurs : src/environments/build-info.ts (affichage dans
// l'écran Réglages) et public/version.json (copié à la racine du site, pour
// vérifier la version en ligne sans ouvrir l'app).
//
// Lancé automatiquement par npm (postinstall, prestart, prebuild) : le fichier
// n'est pas versionné, il est régénéré à chaque installation et à chaque build.
// Usage manuel : node scripts/build-info.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_TS = join(ROOT, 'src', 'environments', 'build-info.ts');
const OUT_JSON = join(ROOT, 'public', 'version.json');

/** Sortie d'une commande git, ou '' si git est absent / hors dépôt. */
function git(...args) {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

// Quiconque construit hors dépôt git (archive, tarball) obtient build 0 / 'dev'
// plutôt qu'un échec : le build ne doit jamais dépendre de la présence de git.
const build = Number(git('rev-list', '--count', 'HEAD')) || 0;
const commit = git('rev-parse', '--short', 'HEAD') || 'dev';
const date = git('log', '-1', '--format=%cI');

// Les valeurs viennent de git (hexadécimal, entier, date ISO) : on interdit
// malgré tout tout caractère hors liste blanche avant de les écrire en source.
const safe = (value) => value.replace(/[^\w.:+-]/g, '');

mkdirSync(dirname(OUT_TS), { recursive: true });
writeFileSync(
  OUT_TS,
  `// Fichier généré par scripts/build-info.mjs — ne pas modifier à la main,
// ni versionner (voir .gitignore). Régénéré à chaque install et à chaque build.
export const BUILD_INFO = {
  /** Nombre de commits : incrémenté à chaque fusion sur main. 0 hors dépôt git. */
  build: ${build},
  /** Commit court effectivement déployé, 'dev' si indéterminé. */
  commit: '${safe(commit)}',
  /** Date du commit (ISO 8601), '' si indéterminée. */
  date: '${safe(date)}',
} as const;
`,
  'utf8',
);

mkdirSync(dirname(OUT_JSON), { recursive: true });
writeFileSync(
  OUT_JSON,
  `${JSON.stringify({ build, commit: safe(commit), date: safe(date) }, null, 2)}\n`,
  'utf8',
);

console.log(`build-info : build ${build}, commit ${commit}${date ? `, ${date}` : ''}`);
