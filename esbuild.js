const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

async function main() {
  const targets = [
    { ...common, entryPoints: ['src/extension.ts'], outfile: 'out/extension.js' },
    { ...common, entryPoints: ['test/**/*.test.ts'], outdir: 'out-test', minify: false },
  ];

  if (watch) {
    for (const options of targets) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
    }
    return;
  }
  for (const options of targets) {
    await esbuild.build(options);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
