const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Levanta el server una sola vez, corre todos los test-*.js de la raíz en
// secuencia contra él, y lo apaga al final — así no hace falta arrancar
// "node server.js" a mano antes de cada test suelto.

const ROOT = __dirname;
const SERVER_READY_PATTERN = /escuchando en/i;
const SERVER_READY_TIMEOUT_MS = 10000;

function findTestFiles() {
  return fs
    .readdirSync(ROOT)
    .filter((f) => /^test-.*\.js$/.test(f))
    .sort();
}

function startServer() {
  return new Promise((resolve, reject) => {
    const server = spawn(process.execPath, ["server.js"], { cwd: ROOT });
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
  const testFiles = findTestFiles();
  console.log(`Encontrados ${testFiles.length} tests: ${testFiles.join(", ")}`);

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
