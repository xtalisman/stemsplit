/* Node test harness for the pure DSP core. Run: node test/engine-test.js */
const E = require('../js/audio-engine.js');
const SR = 44100;
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra ? ' :: ' + extra : '')); }
}
function sine(freq, n, phase) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin(2 * Math.PI * freq * i / SR + (phase || 0));
  return out;
}
function rms(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); }

// --- 1. mid/side separation ---
console.log('separateStems');
{
  const n = SR * 2;
  const vocal = sine(440, n);                       // centered "voice"
  const musicL = sine(220, n, 1), musicR = sine(220, n, 2.5); // wide "music"
  const L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = vocal[i] * 0.5 + musicL[i] * 0.5; R[i] = vocal[i] * 0.5 + musicR[i] * 0.5; }
  const { vocals, music } = E.separateStems(L, R);
  check('vocals carry the centered tone', rms(vocals[0]) > 0.3, 'rms=' + rms(vocals[0]).toFixed(3));
  check('music stem rejects most center', rms(music[0]) < rms(vocals[0]) * 0.75,
    'music rms=' + rms(music[0]).toFixed(3) + ' vocal rms=' + rms(vocals[0]).toFixed(3));
  const mixed = E.mixStems(vocals, music, 1, 1);
  let maxDiff = 0;
  for (let i = 0; i < n; i += 7) maxDiff = Math.max(maxDiff, Math.abs(mixed[0][i] - L[i]), Math.abs(mixed[1][i] - R[i]));
  check('mix(1,1) reconstructs original', maxDiff < 1e-6, 'maxDiff=' + maxDiff);
}

// --- 2. WAV roundtrip ---
console.log('encodeWav');
{
  const L = sine(440, 1000), R = sine(550, 1000);
  const bytes = E.encodeWav([L, R], SR);
  const hdr = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  check('RIFF header', hdr === 'RIFF', hdr);
  const v = new DataView(bytes.buffer);
  check('16-bit stereo 44100', v.getUint16(22, true) === 2 && v.getUint32(24, true) === SR);
  const s0 = v.getInt16(44, true) / 0x7FFF;
  check('first sample roundtrips', Math.abs(s0 - L[0]) < 0.001, 'got ' + s0);
}

// --- 3. FFT peak bin ---
console.log('fft');
{
  const N = 4096, re = new Float64Array(N), im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = Math.sin(2 * Math.PI * 440 * i / SR);
  E.fft(re, im);
  let pk = 0, pv = -1;
  for (let k = 1; k < N / 2; k++) { const m = re[k] * re[k] + im[k] * im[k]; if (m > pv) { pv = m; pk = k; } }
  check('440Hz lands near bin 41', Math.abs(pk - 41) <= 1, 'bin=' + pk);
}

// --- 4. BPM on synthetic click track ---
console.log('detectBPM');
{
  const bpmTarget = 120, secs = 10, n = SR * secs;
  const mono = new Float32Array(n);
  const period = Math.floor(SR * 60 / bpmTarget);
  for (let p = 0; p < n; p += period) for (let i = 0; i < 200 && p + i < n; i++) mono[p + i] = 0.9;
  const got = E.detectBPM(mono, SR);
  check('click track detected ~120bpm', got !== null && Math.abs(got - bpmTarget) <= 2, 'got ' + got);
}

// --- 5. Key on synthetic A-major pad ---
console.log('detectKey');
{
  const secs = 6, n = SR * secs;
  const mono = new Float32Array(n);
  [220, 277.18, 329.63].forEach(fq => { // A3 C#4 E4
    for (let i = 0; i < n; i++) mono[i] += Math.sin(2 * Math.PI * fq * i / SR) / 3;
  });
  const key = E.detectKey(mono, SR);
  check('A major detected', key && key.name === 'A' && key.mode === 'major',
    key ? key.name + ' ' + key.mode + ' (' + key.confidence.toFixed(2) + ')' : 'null');
}

// --- 6. slice / concat ---
console.log('slice+concat');
{
  const L = sine(440, SR), R = sine(440, SR);
  const part = E.sliceChannels([L, R], SR * 0.25, SR * 0.75);
  check('slice length', part[0].length === SR * 0.5, String(part[0].length));
  const joined = E.concatChannels([[L, R], [L, R]]);
  check('concat doubles length', joined[0].length === SR * 2, String(joined[0].length));
}

// --- 7. waveform peaks ---
console.log('peaks');
{
  const pk = E.peaksForWaveform(sine(440, SR), 100);
  check('100 buckets, sane peaks', pk.length === 100 && pk[0] > 0.9, 'pk[0]=' + pk[0].toFixed(2));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
