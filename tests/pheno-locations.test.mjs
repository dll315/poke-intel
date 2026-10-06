import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../server/db.mjs';
import {createPhenoLocations} from '../server/pheno-locations.mjs';
import {buildApp} from '../server/app.mjs';

test('pheno location sync keeps source area, type and exact point together and retains cache after failure',async()=>{
  const db=openDb(':memory:');let fail=false;
  const fetchImpl=async url=>{assert.match(String(url),/\/api\/pheno-spawn-data$/);if(fail)throw new Error('temporary upstream failure');return Response.json({
    'Abundant Shrine':{Water:{'Specific Locations':[{'Specific Location':'(Bottom Center)','Map Link':'https://i.imgur.com/example.png'},{'Specific Location':'(Top Center)'}]},Grass:{'Specific Locations':[{'Specific Location':'(Middle Left)'}]}},
    'Chargestone Cave':{Dust:{'Specific Locations':[{'Specific Location':'B1F (Top)'}]}},
  });};
  const source=createPhenoLocations({db,enabled:true,permissionConfirmed:true,fetchImpl,autoStart:false,now:()=>Date.parse('2026-10-06T05:00:00Z')});
  assert.deepEqual(await source.refresh(),{imported:4});
  assert.deepEqual(source.list().items.map(x=>[x.area,x.type,x.detail]),[
    ['Abundant Shrine','grass','(Middle Left)'],['Abundant Shrine','water','(Bottom Center)'],['Abundant Shrine','water','(Top Center)'],['Chargestone Cave','dust','B1F (Top)'],
  ]);
  assert.equal(source.list().items[1].mapUrl,'https://i.imgur.com/example.png');
  assert.equal(source.list().items[1].areaZh,'丰饶之祠');
  assert.equal(source.list().items[1].detailZh,'（下方中间）');
  fail=true;await assert.rejects(()=>source.refresh(),/temporary upstream failure/);
  assert.equal(source.list().items.length,4);assert.match(source.list().lastError,/temporary upstream failure/);
  source.close();db.close();
});

test('public pheno locations endpoint serves cached source points without exposing unrelated data',async t=>{
  const app=await buildApp({dbPath:':memory:',catalog:{enabled:true,permissionConfirmed:true,autoStart:false,fetchImpl:async()=>Response.json({'Route 3':{Grass:{'Specific Locations':[{'Specific Location':'Near Day Care'}]}}})}});
  t.after(()=>app.close());
  await app.phenoLocations.refresh();
  const response=await app.inject('/api/v1/pheno-locations');
  assert.equal(response.statusCode,200);
  assert.deepEqual(response.json().items,[{area:'Route 3',areaZh:'3号道路',type:'grass',detail:'Near Day Care',detailZh:'Near Day Care',mapUrl:null}]);
  assert.equal(response.json().enabled,true);
});
