const fs = require('fs');
const appPath = process.argv[2];
const batchPath = process.argv[3];

let appSrc = fs.readFileSync(appPath, 'utf8');
let batchSrc = fs.readFileSync(batchPath, 'utf8');

// Extract the array literal body from the batch file (between the first '[' after 'var NEWQ =' and the matching '];' before module.exports)
const startMarker = 'var NEWQ = [';
const startIdx = batchSrc.indexOf(startMarker) + startMarker.length;
const endMarker = '\n];\nmodule.exports';
const endIdx = batchSrc.indexOf(endMarker);
if (startIdx < 0 || endIdx < 0) throw new Error('markers not found in batch file');
const batchBody = batchSrc.slice(startIdx, endIdx).trim(); // starts with "\n{id:81..." ... ends with "...}}"

// Find Q array boundaries in app.html: "var Q = [" ... first "\n];" after it
const qStart = appSrc.indexOf('var Q = [');
if (qStart < 0) throw new Error('var Q = [ not found');
const qArrayContentStart = qStart + 'var Q = ['.length;
const qEndRel = appSrc.indexOf('\n];', qArrayContentStart);
if (qEndRel < 0) throw new Error('closing ]; not found for Q array');

const before = appSrc.slice(0, qEndRel); // up to (not including) the "\n];"
const after = appSrc.slice(qEndRel); // "\n];" + rest of file

// before ends with the last existing question object, e.g. "...}}"; no trailing comma.
// We add a comma, then the new batch body, then keep 'after' as-is.
const newSrc = before + ',\n\n' + batchBody + after;

fs.writeFileSync(appPath, newSrc, 'utf8');
console.log('Inserted', (batchBody.match(/\{id:/g) || []).length, 'new questions into', appPath);
