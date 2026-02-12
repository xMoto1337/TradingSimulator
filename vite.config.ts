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
  var L='[WS-Poly] ';
  var RealWS=window.WebSocket;
  console.log(L+'Coinbase WebSocket polyfill active');
  window.WebSocket=function(url,protocols){
    if(url.indexOf('ws-feed.exchange.coinbase.com')===-1){
      return protocols?new RealWS(url,protocols):new RealWS(url);
    }
    console.log(L+'Intercepting Coinbase WS connection');
    var ws={readyState:0,url:url,CONNECTING:0,OPEN:1,CLOSING:2,CLOSED:3,
      bufferedAmount:0,extensions:'',protocol:'',binaryType:'blob',
      onopen:null,onmessage:null,onerror:null,onclose:null,
      _iv:[],_pids:[],_stats:{},_tc:0,
      addEventListener:function(t,fn){if(t==='message')this.onmessage=fn;if(t==='open')this.onopen=fn;if(t==='close')this.onclose=fn;if(t==='error')this.onerror=fn;},
      removeEventListener:function(){},
      send:function(d){
        var self=this;
        try{var m=JSON.parse(d);
          if(m.type==='subscribe'&&m.product_ids){
            console.log(L+'Subscribe:',m.product_ids);
            self._pids=m.product_ids;self._poll();
          }
        }catch(e){console.error(L+'send parse error:',e);}
      },
      close:function(){console.log(L+'close() called');this._iv.forEach(clearInterval);this._iv=[];this.readyState=3;
        if(this.onclose)this.onclose({code:1000,reason:'',wasClean:true});},
      _poll:function(){
        var s=this;
        console.log(L+'Starting REST polling for',s._pids);
        setTimeout(function(){
          s.readyState=1;
          var sub=JSON.stringify({type:'subscriptions',channels:[{name:'ticker',product_ids:s._pids}]});
          console.log(L+'Sending subscription confirmation');
          if(s.onmessage)s.onmessage({data:sub});
          else console.warn(L+'onmessage is null at subscription time!');
        },100);
        var tick=function(){
          s._pids.forEach(function(pid){
            fetch('https://api.exchange.coinbase.com/products/'+pid+'/ticker')
            .then(function(r){
              if(!r.ok){console.error(L+'Ticker HTTP',r.status,'for',pid);return null;}
              return r.json();
            })
            .then(function(d){
              if(!d){console.warn(L+'No ticker data for',pid);return;}
              if(s.readyState!==1){console.warn(L+'readyState is',s.readyState,', skipping');return;}
              s._tc++;
              var st=s._stats[pid]||{};
              var msg={type:'ticker',product_id:pid,price:d.price,
                time:d.time||new Date().toISOString(),
                open_24h:st.open||d.price,high_24h:st.high||d.price,
                low_24h:st.low||d.price,volume_24h:st.volume||d.volume||'0'};
              if(s._tc<=3)console.log(L+'Ticker #'+s._tc+':',pid,d.price);
              if(s.onmessage){s.onmessage({data:JSON.stringify(msg)});}
              else{console.warn(L+'onmessage is null, cannot deliver ticker!');}
            }).catch(function(e){console.error(L+'Ticker fetch error for',pid,':',e);});
          });
        };
        var stats=function(){
          s._pids.forEach(function(pid){
            fetch('https://api.exchange.coinbase.com/products/'+pid+'/stats')
            .then(function(r){return r.ok?r.json():null})
            .then(function(d){if(d){s._stats[pid]=d;console.log(L+'Stats loaded for',pid);}})
            .catch(function(e){console.error(L+'Stats fetch error:',e);});
          });
        };
        stats();tick();
        s._iv.push(setInterval(tick,2000));
        s._iv.push(setInterval(stats,30000));
      }
    };
    setTimeout(function(){
      ws.readyState=1;
      console.log(L+'Firing onopen, onmessage handler:',!!ws.onmessage);
      if(ws.onopen)ws.onopen({});
    },50);
    return ws;
  };
  window.WebSocket.CONNECTING=0;window.WebSocket.OPEN=1;
  window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;
})();
</script>`;
          return html.replace('</head>', () => script + '</head>');
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
