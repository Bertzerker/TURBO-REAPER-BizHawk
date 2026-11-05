// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';import {readFile,writeFile} from 'node:fs/promises';
const read=async name=>JSON.parse(await readFile(new URL('../test-output/'+name+'.json',import.meta.url),'utf8'));
const stock=await read('harness-stock'),reports=await Promise.all(['harness','harness-320','harness-512','harness-stress'].map(read));
for(const r of [stock,...reports])for(const row of r.rows){assert.equal(row.state,r.rows[0].state);assert.equal(row.output,r.rows[0].output);}
assert.equal(stock.rows[0].state,reports[0].rows[0].state);assert.equal(stock.rows[0].output,reports[0].rows[0].output);
assert.deepEqual(reports.slice(0,3).map(r=>r.rows[0].width),[256,320,512]);assert.equal(reports[3].stress.limited,15);assert(reports[3].stress.leftClipping&&reports[3].stress.validBlank);
const summary={ok:true,stockEquality:true,widths:[256,320,512],spriteLimit:true,leftClipping:true,blankLayer:true,observerRows:reports[0].rows};await writeFile(new URL('../test-output/harness-summary.json',import.meta.url),JSON.stringify(summary,null,2));console.log(JSON.stringify({...summary,observerRows:undefined}));
