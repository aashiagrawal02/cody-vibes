// Bundles the browser code in /client into /public/js using esbuild.
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: ['client/landing.js', 'client/dashboard.js', 'client/room.js'],
  bundle: true,
  outdir: 'public/js',
  format: 'esm',
  target: ['es2022'],
  minify: !watch,
  sourcemap: watch,
  logLevel: 'info',
};

(async () => {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
  } else {
    await esbuild.build(options);
  }
})().catch(() => process.exit(1));
