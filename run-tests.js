const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Levanta el server una sola vez (con NODE_ENV=test, para que el plugin
// trivial de games/__test__/ se registre y tests/platform/*.js pueda
// correr sin depender de Mafia), corre todos los test-*.js de
// tests/platform/ y tests/mafia/ en secuencia contra él, y lo apaga al
// final — así no hace falta arrancar "node server.js" a mano antes de cada
// test suelto.
//
// Por default recorre ambos directorios; se le puede pasar uno o más
// directorios como argumentos (ej. "node run-tests.js tests/platform") para
// correr solo un subconjunto — así es como funciona el script "test:platform".

const ROOT = __dirname;
const SERVER_READY_PATTERN = /escuchando en/i;
const SERVER_READY_TIMEOUT_MS = 10000;
const DEFAULT_TEST_DIRS = ["tests/platform", "tests/mafia"];

function findTestFiles(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => /^test-.*\.js$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, ["server.js"], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "test" },
    });
    let ready = false;
    const timer = setTimeout(() => {
      if (!ready) reject(new Error("El server no arrancó a tiempo."));
    }, SERVER_READY_TIMEOUT_MS);

    server.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(`[server] ${text}`);
      if (!ready && SERVER_READY_PATTERN.test(text)) {
        ready = true;
        clearTimeout(timer);
        resolve(server);
      }
    });
    server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));
    server.on("exit", (code) => {
      if (!ready) {
        clearTimeout(timer);
        reject(new Error(`El server se cerró antes de estar listo (código ${code}).`));
      }
    });
  });
}

function runTest(file) {
  return new Promise((resolve) => {
    console.log(`\n▶ ${file}`);
    const child = spawn(process.execPath, [file], { cwd: ROOT, stdio: "inherit" });
    child.on("exit", (code) => resolve({ file, passed: code === 0 }));
  });
}

async function main() {
  const dirs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_TEST_DIRS;
  const testFiles = dirs.flatMap(findTestFiles);
  console.log(`Encontrados ${testFiles.length} tests en [${dirs.join(", ")}]: ${testFiles.join(", ")}`);

  const server = await startServer();
  console.log("✅ Server listo.\n");

  const results = [];
  try {
    for (const file of testFiles) {
      results.push(await runTest(file));
    }
  } finally {
    server.kill();
  }

  console.log("\n=== Resumen ===");
  results.forEach((r) => console.log(`${r.passed ? "✅" : "❌"} ${r.file}`));

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} tests pasaron.`);
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("❌ Error en el runner:", err.message);
  process.exit(1);
});
