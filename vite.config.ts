import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, copyFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Read version from package.json
const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));

export default defineConfig(({ mode }) => {
  const isWebBuild = mode === 'web';

  return {
    plugins: [
      react(),
      // Web-only: inject fetch proxy to route CORS-blocked hosts through Vercel
      ...(isWebBuild ? [{
        name: 'web-fetch-proxy',
        transformIndexHtml(html: string) {
          const script = `<script>
(function(){
  if(window.__TAURI__)return;
  var real=window.fetch;
  var hosts=['api.exchange.coinbase.com'];
  window.fetch=function(input,init){
    var url=typeof input==='string'?input:input instanceof Request?input.url:String(input);
    try{var h=new URL(url,location.origin).host;
      if(hosts.indexOf(h)!==-1)return real('/api/proxy?url='+encodeURIComponent(url),init);
    }catch(e){}
    return real(input,init);
  };
})();
</script>`;
          return html.replace('</head>', script + '</head>');
        },
      }] : []),
      // Copy CHANGELOG.md to output for web builds (so /CHANGELOG.md works)
      {
        name: 'copy-changelog',
        writeBundle() {
          if (isWebBuild) {
            const src = resolve(__dirname, 'CHANGELOG.md');
            const dest = resolve(__dirname, 'dist-web', 'CHANGELOG.md');
            if (existsSync(src)) {
              copyFileSync(src, dest);
            }
          }
        },
      },
    ],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    clearScreen: false,
    server: {
      port: 1421,
      strictPort: false,
      watch: {
        ignored: ['**/src-tauri/**'],
      },
    },
    build: {
      target: ['es2021', 'chrome100', 'safari13'],
      minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
      sourcemap: !!process.env.TAURI_DEBUG,
      ...(isWebBuild && { outDir: 'dist-web' }),
    },
  };
});
