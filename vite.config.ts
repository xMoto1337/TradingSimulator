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
      // Web-only: replace Coinbase WebSocket with REST polling (WS blocked by origin check)
      ...(isWebBuild ? [{
        name: 'web-coinbase-polyfill',
        transformIndexHtml(html: string) {
          const script = `<script>
(function(){
  if(window.__TAURI__)return;
  var RealWS=window.WebSocket;
  window.WebSocket=function(url,protocols){
    if(url.indexOf('ws-feed.exchange.coinbase.com')===-1){
      return protocols?new RealWS(url,protocols):new RealWS(url);
    }
    var ws={readyState:0,url:url,CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3,
      bufferedAmount:0,extensions:'',protocol:'',binaryType:'blob',
      onopen:null,onmessage:null,onerror:null,onclose:null,
      _iv:[],_pids:[],_stats:{},
      addEventListener:function(){},removeEventListener:function(){},
      send:function(d){
        try{var m=JSON.parse(d);
          if(m.type==='subscribe'&&m.product_ids){this._pids=m.product_ids;this._poll();}
        }catch(e){}
      },
      close:function(){this._iv.forEach(clearInterval);this._iv=[];this.readyState=3;
        if(this.onclose)this.onclose({code:1000,reason:'',wasClean:true});},
      _poll:function(){
        var s=this;
        setTimeout(function(){
          s.readyState=1;
          var sub=JSON.stringify({type:'subscriptions',channels:[{name:'ticker',product_ids:s._pids}]});
          if(s.onmessage)s.onmessage({data:sub});
        },100);
        var tick=function(){
          s._pids.forEach(function(pid){
            fetch('https://api.exchange.coinbase.com/products/'+pid+'/ticker',{cache:'no-store'})
            .then(function(r){return r.ok?r.json():null})
            .then(function(d){
              if(!d||s.readyState!==1)return;
              var st=s._stats[pid]||{};
              var msg={type:'ticker',product_id:pid,price:d.price,
                time:d.time||new Date().toISOString(),
                open_24h:st.open||d.price,high_24h:st.high||d.price,
                low_24h:st.low||d.price,volume_24h:st.volume||d.volume||'0'};
              if(s.onmessage)s.onmessage({data:JSON.stringify(msg)});
            }).catch(function(){});
          });
        };
        var stats=function(){
          s._pids.forEach(function(pid){
            fetch('https://api.exchange.coinbase.com/products/'+pid+'/stats',{cache:'no-store'})
            .then(function(r){return r.ok?r.json():null})
            .then(function(d){if(d)s._stats[pid]=d;})
            .catch(function(){});
          });
        };
        stats();tick();
        s._iv.push(setInterval(tick,2000));
        s._iv.push(setInterval(stats,30000));
      }
    };
    setTimeout(function(){ws.readyState=1;if(ws.onopen)ws.onopen({});},50);
    return ws;
  };
  window.WebSocket.CONNECTING=0;window.WebSocket.OPEN=1;
  window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;
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
