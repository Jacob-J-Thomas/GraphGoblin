// Correct the QA's reference-identity comparison, using the originally captured HTTP values.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as L from './lib.mjs';
const original=JSON.parse(fs.readFileSync(path.join(L.RECORD,'format-results.json'),'utf8'));
const check=original.checks.find(c=>c.name==='valid current-format store reopens unchanged');
const {saved,reopened}=check.detail;assert.deepEqual(saved,reopened);
L.save('format-values-results.json',{passed:true,method:'deep equality of the original two complete HTTP snapshots; no rerun or product modification',saved,reopened});console.log('PASS complete current-format snapshots before and after restart are deeply identical');
