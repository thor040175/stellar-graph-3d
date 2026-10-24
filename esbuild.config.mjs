import esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { builtinModules } from "module";

const watch = process.argv[2] === "watch";
// Optional: Pfad zu einem Vault. Dann wird nach jedem Build in <vault>/.obsidian/plugins/galaxy-graph-3d kopiert.
const vault = process.env.GALAXY_GRAPH_VAULT;

const deploy = () => {
  if (!vault) return;
  const out = path.join(vault, ".obsidian", "plugins", "galaxy-graph-3d");
  fs.mkdirSync(out, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(f, path.join(out, f));
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
