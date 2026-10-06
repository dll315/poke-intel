import test from 'node:test';
import assert from 'node:assert/strict';
import {translateLocation} from '../server/location-zh.mjs';

test('location names preserve source meaning across regions and exact phenomenon points',()=>{
  assert.equal(translateLocation('Route 203','sinnoh'),'203号道路');
  assert.equal(translateLocation('Abundant Shrine · (Bottom Center)','unova'),'丰饶之祠 · （下方中间）');
  assert.equal(translateLocation('Lighthouse','johto'),'光辉灯塔');
  assert.equal(translateLocation('Lighthouse','hoenn'),'Lighthouse');
  assert.equal(translateLocation('Unknown New Location','unova'),'Unknown New Location');
});
