/**
 * Replays archived transcripts through the sounding license Jaccard logic
 * to produce the distribution used to re-derive SUSTAINED_THRESHOLD (ticket 142).
 *
 * Reads transcript .md files from archives and eval directories,
 * extracts user turns, computes content-word and raw-word adjacent Jaccard
 * over every 3-turn sliding window, and prints percentile tables.
 *
 * Usage: bun run scripts/analyze-sounding-license.ts
 *
 * Read-only, never writes to archives/ or eval/.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Mirrors src/index/lexical.ts TOKEN_RE and STOPWORDS exactly.
const STOPWORDS = new Set([
  'a','an','the','and','or','but','if','because','as','until','while','of','at','by','for',
  'with','about','against','between','into','through','during','before','after','above','below',
  'to','from','in','out','on','off','over','under','again','further','then','once','here',
  'there','when','where','why','how','all','both','each','few','more','most','other','some',
  'such','no','nor','not','only','own','same','so','than','too','very','s','t','can','will',
  'just','don','should','now','d','ll','m','o','re','ve','y','ain','aren','couldn','didn',
  'doesn','hadn','hasn','haven','isn','ma','mightn','mustn','needn','shan','shouldn','wasn',
  'weren','won','wouldn','i','me','my','myself','we','our','ours','ourselves','you','your',
  'yours','yourself','yourselves','he','him','his','himself','she','her','hers','herself',
  'it','its','itself','they','them','their','theirs','themselves','what','which','who','whom',
  'this','that','these','those','am','is','are','was','were','be','been','being','have','has',
  'had','having','do','does','did','doing','would','could','should','might','shall','may',
  'can','will','ought','used','need','dare','get','got','gets','getting','go','goes','went',
  'going','make','made','makes','making','take','took','takes','taking','see','saw','seen',
  'seeing','know','knew','known','knowing','think','thought','thinking','say','said','says',
  'saying','come','came','comes','coming','want','wants','wanting','look','looks','looked',
  'looking','like','likes','liked','liking','feel','feels','felt','feeling','seem','seems',
  'seemed','seeming','let','lets','put','puts','putting','give','gave','given','giving',
  'tell','told','telling','ask','asked','asking','try','tried','trying','use','used','using',
  'keep','keeps','kept','keeping','find','found','finding','work','works','working','call',
  'called','calling','still','even','also','really','actually','quite','rather','almost',
  'enough','perhaps','maybe','always','never','sometimes','usually','often','thing','things',
  'way','ways','lot','lots','bit','bits','kind','kinds','sort','sorts','part','parts','day',
  'days','time','times','year','years','something','anything','nothing','everything','one',
  'two','three','first','second','last','next','many','much','any','every','little','big',
  'right','left','well','back','around','away','down','up','yeah','yes','ok','okay','oh',
  'uh','um','er','ah','hm','hmm','wow','hey','hi','hello','please','thank','thanks',
  'sorry','right','wrong','sure','really','else',
]);

const TOKEN_RE = /[a-zA-Z0-9]+(?:[''-][a-zA-Z0-9]+)*/g;

interface Token {
  word: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    tokens.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

function contentWordsOf(text: string): Set<string> {
  return new Set(tokenize(text).filter(function(t) { return !STOPWORDS.has(t.word); }).map(function(t) { return t.word; }));
}

function allWordsOf(text: string): Set<string> {
  return new Set(tokenize(text).map(function(t) { return t.word; }));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  var intersection = new Set(Array.from(a).filter(function(x) { return b.has(x); }));
  var union = new Set([...Array.from(a), ...Array.from(b)]);
  return intersection.size / union.size;
}

// Transcript discovery

function findAllTranscripts(dir: string, maxDepth: number): string[] {
  if (maxDepth <= 0) return [];
  var results: string[] = [];
  try {
    var entries = readdirSync(dir);
    for (var _i = 0; _i < entries.length; _i++) {
      var entry = entries[_i];
      var full = join(dir, entry);
      try {
        var st = statSync(full);
        if (st.isDirectory() && entry !== 'node_modules') {
          if (entry === 'transcripts') {
            var mdFiles = readdirSync(full).filter(function(f) { return f.endsWith('.md'); });
            for (var _j = 0; _j < mdFiles.length; _j++) {
              results.push(join(full, mdFiles[_j]));
            }
          } else {
            var sub = findAllTranscripts(full, maxDepth - 1);
            for (var _k = 0; _k < sub.length; _k++) results.push(sub[_k]);
          }
        }
      } catch (_e) { /* skip unreadable */ }
    }
  } catch (_e) { /* skip unreadable dir */ }
  return results;
}

function parseTranscript(path: string): string[] {
  try {
    var content = readFileSync(path, 'utf-8');
    var userTurns: string[] = [];
    var lines = content.split('\n');
    var inUser = false;
    var currentTurn: string[] = [];

    for (var _i = 0; _i < lines.length; _i++) {
      var trimmed = lines[_i].trim();
      if (trimmed === '## user') {
        inUser = true;
        if (currentTurn.length > 0) {
          userTurns.push(currentTurn.join(' ').trim());
          currentTurn = [];
        }
      } else if (trimmed === '## agent' || trimmed === '---') {
        if (inUser && currentTurn.length > 0) {
          userTurns.push(currentTurn.join(' ').trim());
          currentTurn = [];
        }
        inUser = false;
      } else if (inUser && trimmed) {
        currentTurn.push(trimmed);
      }
    }
    if (inUser && currentTurn.length > 0) {
      userTurns.push(currentTurn.join(' ').trim());
    }
    return userTurns;
  } catch (_e) {
    return [];
  }
}

// Analysis

interface Session {
  file: string;
  turns: number;
  maxCW: number;
  maxRaw: number;
  cwValues: number[];
  rawValues: number[];
}

var ROOT = process.cwd();
var transcriptFiles = findAllTranscripts(ROOT, 8);

var allCW: number[] = [];
var allRaw: number[] = [];
var sessions: Session[] = [];
var turnCounts: number[] = [];

for (var _i = 0; _i < transcriptFiles.length; _i++) {
  var file = transcriptFiles[_i];
  var turns = parseTranscript(file);
  if (turns.length < 3) continue;

  turnCounts.push(turns.length);
  var cwValues: number[] = [];
  var rawValues: number[] = [];

  for (var w = 0; w <= turns.length - 3; w++) {
    var w0 = turns[w], w1 = turns[w+1], w2 = turns[w+2];
    var j01 = jaccard(contentWordsOf(w0), contentWordsOf(w1));
    var j12 = jaccard(contentWordsOf(w1), contentWordsOf(w2));
    cwValues.push((j01 + j12) / 2);

    var r01 = jaccard(allWordsOf(w0), allWordsOf(w1));
    var r12 = jaccard(allWordsOf(w1), allWordsOf(w2));
    rawValues.push((r01 + r12) / 2);

    allCW.push((j01 + j12) / 2);
    allRaw.push((r01 + r12) / 2);
  }

  sessions.push({
    file: file.replace(ROOT + '/', ''),
    turns: turns.length,
    maxCW: cwValues.length ? Math.max.apply(null, cwValues) : 0,
    maxRaw: rawValues.length ? Math.max.apply(null, rawValues) : 0,
    cwValues: cwValues,
    rawValues: rawValues,
  });
}

// Output

function percentile(arr: number[], pc: number): number {
  var idx = Math.floor(arr.length * pc / 100);
  return arr[Math.min(idx, arr.length - 1)];
}

var cwSorted = allCW.slice().sort(function(a,b){return a-b;});
var rawSorted = allRaw.slice().sort(function(a,b){return a-b;});
var tcSorted = turnCounts.slice().sort(function(a,b){return a-b;});

console.log('Transcripts: ' + transcriptFiles.length + ' total, ' + sessions.length + ' with 3+ user turns\n');

console.log('### Session Turn Counts');
console.log('  min=' + tcSorted[0] + '  p25=' + percentile(tcSorted, 25) + '  p50=' + percentile(tcSorted, 50) + '  p75=' + percentile(tcSorted, 75) + '  max=' + tcSorted[tcSorted.length - 1] + '\n');

console.log('### Content-Word Jaccard Distribution');
console.log('  windows=' + allCW.length);
console.log('  p5=' + percentile(cwSorted, 5).toFixed(4) + '  p10=' + percentile(cwSorted, 10).toFixed(4) + '  p25=' + percentile(cwSorted, 25).toFixed(4) + '  p50=' + percentile(cwSorted, 50).toFixed(4) + '  p75=' + percentile(cwSorted, 75).toFixed(4) + '  p90=' + percentile(cwSorted, 90).toFixed(4) + '  p95=' + percentile(cwSorted, 95).toFixed(4) + '  max=' + cwSorted[cwSorted.length - 1].toFixed(4));

var thresholds = [0.03, 0.05, 0.07, 0.10, 0.12, 0.15, 0.20];
for (var _t = 0; _t < thresholds.length; _t++) {
  var th = thresholds[_t];
  var count = cwSorted.filter(function(v) { return v >= th; }).length;
  console.log('  >=' + th.toFixed(2) + ': ' + count + ' windows (' + (count / cwSorted.length * 100).toFixed(1) + '%)');
}

console.log('\n### Raw-Word Jaccard Distribution (function words included)');
console.log('  p5=' + percentile(rawSorted, 5).toFixed(4) + '  p10=' + percentile(rawSorted, 10).toFixed(4) + '  p25=' + percentile(rawSorted, 25).toFixed(4) + '  p50=' + percentile(rawSorted, 50).toFixed(4) + '  p75=' + percentile(rawSorted, 75).toFixed(4) + '  p90=' + percentile(rawSorted, 90).toFixed(4) + '  p95=' + percentile(rawSorted, 95).toFixed(4));

console.log('\n### Sessions Achieving Sustained at Threshold');
for (var _t2 = 0; _t2 < thresholds.length - 1; _t2++) {
  var th2 = thresholds[_t2];
  var sc = sessions.filter(function(s) { return s.maxCW >= th2; }).length;
  console.log('  CW >=' + th2.toFixed(2) + ': ' + sc + '/' + sessions.length + ' sessions (' + (sc / sessions.length * 100).toFixed(1) + '%)');
}

console.log('\n### Top 10 Sessions by Max Content-Word Jaccard');
var topSessions = sessions.slice().sort(function(a,b){return b.maxCW - a.maxCW;}).slice(0, 10);
for (var _t3 = 0; _t3 < topSessions.length; _t3++) {
  var s = topSessions[_t3];
  var vals = s.cwValues.map(function(v){return v.toFixed(3);}).join(',');
  console.log('  ' + s.file + ': ' + s.turns + 't  maxCW=' + s.maxCW.toFixed(4) + '  maxRaw=' + s.maxRaw.toFixed(4) + '  vals=[' + vals + ']');
}
