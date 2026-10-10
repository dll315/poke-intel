import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const main=fileURLToPath(new URL('../server/main.mjs',import.meta.url));

function launch(origin) {
  return new Promise((resolve,reject)=>{
    const env={...process.env,NODE_ENV:'production',ORIGIN:origin,HOST:'127.0.0.1',PORT:'0',DB_PATH:':memory:',ALPHAPEDIA_ENABLED:'0',ALPHA_MONITOR_ENABLED:'0'};
    const child=spawn(process.execPath,[main],{env,stdio:['ignore','pipe','pipe']});
    let output='';
    const timer=setTimeout(()=>{child.kill();reject(new Error(`Startup timed out: ${output}`));},5000);
    function finish(result){clearTimeout(timer);child.kill();resolve(result);}
    child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('Poke 情报站已启动'))finish({started:true,output});});
    child.stderr.on('data',chunk=>{output+=chunk;});
    child.on('exit',code=>{if(code!==null)finish({started:false,output});});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
  });
}

test('production starts with loopback HTTP for local-only installation',async()=>{
  const result=await launch('http://localhost:3001');
  assert.equal(result.started,true,result.output);
});

test('production still refuses public HTTP origins',async()=>{
  const result=await launch('http://8.8.8.8:3001');
  assert.equal(result.started,false);
  assert.match(result.output,/Production requires/);
});
