import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { builtinModules } from "module";

const watch = process.argv[2] === "watch";
// Optional: Test-Vaults, in die nach jedem Build kopiert wird (<vault>/.obsidian/plugins/stellar-graph).
// Quelle: Umgebungsvariable STELLAR_GRAPH_VAULT (mehrere Pfade mit path.delimiter getrennt)
// oder die Datei deploy-vaults.txt (ein Pfad pro Zeile, nicht im Repo).
const listFile = "deploy-vaults.txt";
const vaults = (process.env.STELLAR_GRAPH_VAULT
  ? process.env.STELLAR_GRAPH_VAULT.split(path.delimiter)
  : fs.existsSync(listFile) ? fs.readFileSync(listFile, "utf8").split("\n") : []
).map((v) => v.trim()).filter(Boolean);

const deploy = () => {
  for (const vault of vaults) {
    const out = path.join(vault, ".obsidian", "plugins", "stellar-graph");
    fs.mkdirSync(out, { recursive: true });
    for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(f, path.join(out, f));
  }
};

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
  format: "cjs",
  target: "es2020",
  outfile: "main.js",
  minify: !watch,
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  plugins: [{ name: "deploy", setup(build) { build.onEnd(deploy); } }],
});

if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
