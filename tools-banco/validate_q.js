const fs = require('fs');
const path = require('path');
const appPath = process.argv[2];
const src = fs.readFileSync(appPath, 'utf8');
const start = src.indexOf('var Q = [');
const end = src.indexOf('\n];', start) + 3;
const snippet = src.slice(start, end);
const wrapped = snippet + '\nmodule.exports = Q;';
const outPath = path.join(__dirname, 'qcheck.js');
fs.writeFileSync(outPath, wrapped);
delete require.cache[require.resolve(outPath)];
const Q = require(outPath);
console.log('Total Q entries:', Q.length);
const ids = Q.map(q => q.id);
const seen = new Set();
const dupes = new Set();
for (const id of ids) {
  if (seen.has(id)) dupes.add(id);
  seen.add(id);
}
console.log('Duplicate ids:', [...dupes]);
const areaCounts = {};
Q.forEach(q => areaCounts[q.area] = (areaCounts[q.area] || 0) + 1);
console.log('Area counts:', areaCounts);
