/* ============================================================
   StemSplit audio engine
   - Pure DSP functions (no DOM, no Web Audio): fully testable in Node.
   - Browser helpers (decode, playback render, download) guarded for window.
   Separation method: mid/side (center-channel) decomposition.
   Vocals  = center channel (mid)      -> dual mono
   Music   = wide channel (side)       -> L-mid / R-mid
   Property: vocals + music reconstructs the original exactly,
   so a custom mix at 100/100 equals the source.
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else { root.StemSplitEngine = api; }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- mid/side stem separation (pure) ---------------- */
  // left, right: Float32Array (equal length). Returns { vocals:[l,r], music:[l,r] }
  function separateStems(left, right) {
    var n = Math.min(left.length, right.length);
    var vL = new Float32Array(n), vR = new Float32Array(n);
    var mL = new Float32Array(n), mR = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var mid = (left[i] + right[i]) * 0.5;
      vL[i] = mid; vR[i] = mid;
      mL[i] = left[i] - mid;
      mR[i] = right[i] - mid;
    }
    return { vocals: [vL, vR], music: [mL, mR] };
  }

  // Mix two stems with independent gains (pure). Gains 1,1 => original.
  function mixStems(vocals, music, vGain, mGain) {
    var n = Math.min(vocals[0].length, music[0].length);
    var outL = new Float32Array(n), outR = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      outL[i] = vocals[0][i] * vGain + music[0][i] * mGain;
      outR[i] = vocals[1][i] * vGain + music[1][i] * mGain;
    }
    return [outL, outR];
  }

  // Slice channels to [startSample, endSample) (pure)
  function sliceChannels(channels, startSample, endSample) {
    startSample = Math.max(0, Math.floor(startSample));
    endSample = Math.min(channels[0].length, Math.ceil(endSample));
    return channels.map(function (ch) { return ch.slice(startSample, endSample); });
  }

  // Concatenate a list of channel-arrays (pure). All entries: [l, r] or [mono].
  function concatChannels(list) {
    if (!list.length) return [new Float32Array(0)];
    var chans = list[0].length;
    var total = 0, i, c;
    for (i = 0; i < list.length; i++) total += list[i][0].length;
    var out = [];
    for (c = 0; c < chans; c++) {
      out[c] = new Float32Array(total);
      var off = 0;
      for (i = 0; i < list.length; i++) {
        var src = list[i][Math.min(c, list[i].length - 1)];
        out[c].set(src, off);
        off += src.length;
      }
    }
    return out;
  }

  /* ---------------- WAV encoding (pure) ---------------- */
  function writeStr(view, offset, str) {
    for (var i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }
  // channels: Array<Float32Array> (1 or 2). Returns Uint8Array of a 16-bit PCM WAV.
  function encodeWav(channels, sampleRate) {
    var numChannels = channels.length;
    var n = channels[0].length;
    var blockAlign = numChannels * 2;
    var dataSize = n * blockAlign;
    var buffer = new ArrayBuffer(44 + dataSize);
    var v = new DataView(buffer);
    writeStr(v, 0, 'RIFF');
    v.setUint32(4, 36 + dataSize, true);
    writeStr(v, 8, 'WAVE');
    writeStr(v, 12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, numChannels, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * blockAlign, true);
    v.setUint16(32, blockAlign, true);
    v.setUint16(34, 16, true);
    writeStr(v, 36, 'data');
    v.setUint32(40, dataSize, true);
    var offset = 44;
    for (var i = 0; i < n; i++) {
      for (var c = 0; c < numChannels; c++) {
        var s = channels[c][i];
        if (s > 1) s = 1; else if (s < -1) s = -1;
        v.setInt16(offset, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7FFF), true);
        offset += 2;
      }
    }
    return new Uint8Array(buffer);
  }

  /* ---------------- FFT (pure, radix-2) ---------------- */
  function fft(re, im) {
    var n = re.length, i, j, k, len;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len;
      var wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        var cRe = 1, cIm = 0;
        for (k = 0; k < len / 2; k++) {
          var uRe = re[i + k], uIm = im[i + k];
          var aRe = re[i + k + len / 2], aIm = im[i + k + len / 2];
          var tRe = cRe * aRe - cIm * aIm;
          var tIm = cRe * aIm + cIm * aRe;
          re[i + k] = uRe + tRe; im[i + k] = uIm + tIm;
          re[i + k + len / 2] = uRe - tRe; im[i + k + len / 2] = uIm - tIm;
          var nRe = cRe * wRe - cIm * wIm;
          cIm = cRe * wIm + cIm * wRe;
          cRe = nRe;
        }
      }
    }
  }

  /* ---------------- waveform peaks (pure) ---------------- */
  function peaksForWaveform(channel, buckets) {
    var n = channel.length, out = new Float32Array(buckets);
    var per = Math.max(1, Math.floor(n / buckets));
    for (var b = 0; b < buckets; b++) {
      var start = b * per, end = Math.min(n, start + per), peak = 0;
      for (var i = start; i < end; i += 4) {
        var a = Math.abs(channel[i]);
        if (a > peak) peak = a;
      }
      out[b] = peak;
    }
    return out;
  }

  function formatTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---------------- tempo (BPM) detection (pure) ---------------- */
  // Energy-flux onset envelope + autocorrelation. Best on rhythmic material.
  function downmixMono(channels) {
    if (channels.length === 1) return channels[0];
    var n = channels[0].length, out = new Float32Array(n);
    for (var i = 0; i < n; i++) out[i] = (channels[0][i] + channels[1][i]) * 0.5;
    return out;
  }

  function detectBPM(mono, sampleRate) {
    var hop = 512;
    var frames = Math.floor(mono.length / hop);
    if (frames < 128) return null;
    var flux = new Float32Array(frames), prev = 0, mean = 0, f, i;
    for (f = 0; f < frames; f++) {
      var e = 0, start = f * hop;
      for (i = 0; i < hop; i++) { var s = mono[start + i]; e += s * s; }
      e = Math.sqrt(e / hop);
      var d = e - prev;
      flux[f] = d > 0 ? d : 0;
      prev = e; mean += flux[f];
    }
    mean /= frames;
    var fps = sampleRate / hop;
    var minLag = Math.max(2, Math.floor(fps * 60 / 210));
    var maxLag = Math.min(frames - 1, Math.ceil(fps * 60 / 50));
    var bestLag = 0, bestVal = -Infinity;
    for (var lag = minLag; lag <= maxLag; lag++) {
      var sum = 0;
      for (f = 0; f + lag < frames; f++) sum += (flux[f] - mean) * (flux[f + lag] - mean);
      // mild preference for the musically common 95..175 bpm band
      var bpmGuess = 60 * fps / lag;
      var weight = (bpmGuess >= 95 && bpmGuess <= 175) ? 1.12 : 1.0;
      if (sum * weight > bestVal) { bestVal = sum * weight; bestLag = lag; }
    }
    if (bestLag === 0) return null;
    var bpm = 60 * fps / bestLag;
    while (bpm < 80) bpm *= 2;
    while (bpm > 200) bpm /= 2;
    return Math.round(bpm);
  }

  /* ---------------- key detection (pure) ---------------- */
  // Chromagram via STFT + Krumhansl-Schmuckler key profiles.
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  var MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

  function correlate(a, b) {
    var n = a.length, ma = 0, mb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    var num = 0, da = 0, db = 0;
    for (i = 0; i < n; i++) {
      var x = a[i] - ma, y = b[i] - mb;
      num += x * y; da += x * x; db += y * y;
    }
    return (da === 0 || db === 0) ? 0 : num / Math.sqrt(da * db);
  }

  function detectKey(mono, sampleRate) {
    var N = 4096, hop = 2048;
    if (mono.length < N * 2) return null;
    var chroma = new Float64Array(12);
    var re = new Float64Array(N), im = new Float64Array(N);
    var hann = new Float64Array(N), i, k;
    for (i = 0; i < N; i++) hann[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
    for (var start = 0; start + N <= mono.length; start += hop) {
      for (i = 0; i < N; i++) { re[i] = mono[start + i] * hann[i]; im[i] = 0; }
      fft(re, im);
      for (k = 1; k < N / 2; k++) {
        var mag = re[k] * re[k] + im[k] * im[k];
        if (mag < 1e-9) continue;
        var freq = k * sampleRate / N;
        if (freq < 55 || freq > 2093) continue;
        var midi = Math.round(69 + 12 * (Math.log(freq / 440) / Math.LN2));
        var pc = ((midi % 12) + 12) % 12;
        chroma[pc] += Math.sqrt(mag);
      }
    }
    var best = { name: '?', mode: '', score: -2 };
    for (var root = 0; root < 12; root++) {
      var rotMaj = [], rotMin = [];
      for (i = 0; i < 12; i++) {
        rotMaj.push(MAJOR_PROFILE[(i - root + 12) % 12]);
        rotMin.push(MINOR_PROFILE[(i - root + 12) % 12]);
      }
      var sMaj = correlate(chroma, rotMaj), sMin = correlate(chroma, rotMin);
      if (sMaj > best.score) best = { name: NOTE_NAMES[root], mode: 'major', score: sMaj };
      if (sMin > best.score) best = { name: NOTE_NAMES[root], mode: 'minor', score: sMin };
    }
    best.confidence = Math.max(0, Math.min(1, (best.score + 0.2) / 1.0));
    return best;
  }

  /* ---------------- browser-only helpers ---------------- */
  var _ctx = null;
  function getContext() {
    if (typeof window === 'undefined') throw new Error('Web Audio is browser-only');
    if (!_ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      _ctx = new AC();
    }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  function decodeFile(arrayBuffer) {
    var ctx = getContext();
    return ctx.decodeAudioData(arrayBuffer.slice(0));
  }

  function bufferToChannels(audioBuffer) {
    var out = [];
    for (var c = 0; c < audioBuffer.numberOfChannels; c++) {
      out.push(new Float32Array(audioBuffer.getChannelData(c)));
    }
    if (out.length === 1) out.push(new Float32Array(out[0])); // mono -> dual
    return [out[0], out[1]];
  }

  function channelsToBuffer(channels, sampleRate) {
    var ctx = getContext();
    var buf = ctx.createBuffer(channels.length, channels[0].length, sampleRate);
    for (var c = 0; c < channels.length; c++) buf.getChannelData(c).set(channels[c]);
    return buf;
  }

  // Render channels through an OfflineAudioContext at a playback rate
  // (tape-style: pitch and tempo move together).
  function renderAtRate(channels, sampleRate, rate) {
    var offline = new OfflineAudioContext(2, Math.ceil(channels[0].length / rate), sampleRate);
    var src = offline.createBufferSource();
    var tmp = offline.createBuffer(2, channels[0].length, sampleRate);
    tmp.getChannelData(0).set(channels[0]);
    tmp.getChannelData(1).set(channels[1].length ? channels[1] : channels[0]);
    src.buffer = tmp;
    src.playbackRate.value = rate;
    src.connect(offline.destination);
    src.start(0);
    return offline.startRendering().then(function (rendered) {
      return [new Float32Array(rendered.getChannelData(0)), new Float32Array(rendered.getChannelData(1))];
    });
  }

  function downloadWav(channels, sampleRate, filename) {
    var bytes = encodeWav(channels, sampleRate);
    var blob = new Blob([bytes.buffer], { type: 'audio/wav' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename || 'stemsplit.wav';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 800);
  }

  function downloadZip(files) {
    // files: [{name, channels, sampleRate}]. Requires JSZip from CDN.
    if (typeof JSZip === 'undefined') return Promise.reject(new Error('JSZip not loaded'));
    var zip = new JSZip();
    files.forEach(function (f) {
      zip.file(f.name, encodeWav(f.channels, f.sampleRate).buffer);
    });
    return zip.generateAsync({ type: 'blob' }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'stemsplit-stems.zip';
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 800);
    });
  }

  return {
    separateStems: separateStems,
    mixStems: mixStems,
    sliceChannels: sliceChannels,
    concatChannels: concatChannels,
    encodeWav: encodeWav,
    fft: fft,
    peaksForWaveform: peaksForWaveform,
    downmixMono: downmixMono,
    detectBPM: detectBPM,
    detectKey: detectKey,
    formatTime: formatTime,
    NOTE_NAMES: NOTE_NAMES,
    // browser-only
    getContext: getContext,
    decodeFile: decodeFile,
    bufferToChannels: bufferToChannels,
    channelsToBuffer: channelsToBuffer,
    renderAtRate: renderAtRate,
    downloadWav: downloadWav,
    downloadZip: downloadZip
  };
});
