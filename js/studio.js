/* StemSplit Studio — upload/record, separate, preview, mix, download.
   Requires: js/audio-engine.js (StemSplitEngine), js/site.js (StemSplitSite),
   and JSZip via CDN for the "all stems" zip. */
(function () {
  'use strict';
  var E = window.StemSplitEngine;
  var MAX_SECONDS = 600; // 10-minute cap keeps browser memory safe

  var S = {
    fileName: 'audio', sampleRate: 44100, duration: 0,
    orig: null, vocals: null, music: null,
    bufVocals: null, bufMusic: null,
    stem: 'original', vGain: 0.8, mGain: 0.8
  };

  var ctx = null, vocalGain = null, musicGain = null;
  var vocalSrc = null, musicSrc = null;
  var playing = false, startCtxTime = 0, startOffset = 0, rafId = null;
  var mediaRecorder = null, recChunks = [];

  function $(id) { return document.getElementById(id); }
  function setStatus(msg, cls) {
    var el = $('statusMsg');
    el.textContent = msg || '';
    el.className = 'status-msg' + (cls ? ' ' + cls : '');
  }
  function setProgress(label, pct) {
    var w = $('progressWrap');
    if (!label) { w.classList.remove('show'); return; }
    w.classList.add('show');
    $('progressLabel').textContent = label;
    $('progressFill').style.width = Math.round(pct) + '%';
  }

  /* ---------- audio graph ---------- */
  function ensureGraph() {
    if (ctx) return;
    ctx = E.getContext();
    var master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
    vocalGain = ctx.createGain();
    musicGain = ctx.createGain();
    vocalGain.connect(master);
    musicGain.connect(master);
  }

  function gainsForStem() {
    switch (S.stem) {
      case 'vocals': return [1, 0];
      case 'music': return [0, 1];
      case 'custom': return [S.vGain, S.mGain];
      default: return [1, 1];
    }
  }

  function stopSources() {
    [vocalSrc, musicSrc].forEach(function (s) {
      if (s) { try { s.onended = null; s.stop(); } catch (e) {} }
    });
    vocalSrc = musicSrc = null;
  }

  function currentPos() {
    if (!playing || !ctx) return startOffset;
    return Math.min(S.duration, startOffset + (ctx.currentTime - startCtxTime));
  }

  function play(offset) {
    if (!S.bufVocals) return;
    ensureGraph();
    stopSources();
    offset = Math.max(0, Math.min(S.duration - 0.05, offset || 0));
    vocalSrc = ctx.createBufferSource(); vocalSrc.buffer = S.bufVocals;
    musicSrc = ctx.createBufferSource(); musicSrc.buffer = S.bufMusic;
    var g = gainsForStem();
    vocalGain.gain.setTargetAtTime(g[0], ctx.currentTime, 0.015);
    musicGain.gain.setTargetAtTime(g[1], ctx.currentTime, 0.015);
    vocalSrc.connect(vocalGain); musicSrc.connect(musicGain);
    vocalSrc.start(0, offset); musicSrc.start(0, offset);
    startCtxTime = ctx.currentTime; startOffset = offset; playing = true;
    $('playBtn').textContent = '⏸';
    var ended = false;
    vocalSrc.onended = function () {
      if (!ended && playing && currentPos() >= S.duration - 0.15) {
        ended = true; pause(true);
      }
    };
    tick();
  }

  function pause(atEnd) {
    stopSources();
    playing = false;
    startOffset = atEnd ? 0 : currentPos();
    $('playBtn').textContent = '▶';
    if (rafId) cancelAnimationFrame(rafId);
    drawWaveform();
  }

  function togglePlay() {
    if (!S.bufVocals) return;
    if (playing) pause(false);
    else play(startOffset);
  }

  function tick() {
    if (!playing) return;
    var pos = currentPos();
    $('timeRead').textContent = E.formatTime(pos) + ' / ' + E.formatTime(S.duration);
    drawPlayhead(pos);
    if (pos >= S.duration - 0.05) { pause(true); return; }
    rafId = requestAnimationFrame(tick);
  }

  /* ---------- waveform ---------- */
  var waveCanvas = null, waveCtx2d = null, waveCache = null;
  var STEM_COLORS = { original: '#22d3ee', vocals: '#8b5cf6', music: '#fbbf24', custom: '#34d399' };

  function stemChannels() {
    if (S.stem === 'vocals') return S.vocals;
    if (S.stem === 'music') return S.music;
    return S.orig;
  }

  // Full render is done rarely (load / stem switch / resize) into an
  // offscreen canvas; per-frame playhead updates just blit + draw a line.
  function drawWaveform() {
    if (!waveCanvas || !S.orig) return;
    var W = waveCanvas.width = waveCanvas.offsetWidth * 2;
    var H = waveCanvas.height = 300;
    waveCache = document.createElement('canvas');
    waveCache.width = W; waveCache.height = H;
    var g = waveCache.getContext('2d');
    var mono = E.downmixMono(stemChannels());
    var peaks = E.peaksForWaveform(mono, Math.floor(W / 3));
    var color = STEM_COLORS[S.stem] || '#22d3ee';
    var bw = W / peaks.length;
    g.fillStyle = color;
    for (var i = 0; i < peaks.length; i++) {
      var h = Math.max(2, peaks[i] * H * 0.92);
      g.globalAlpha = 0.35 + peaks[i] * 0.65;
      g.fillRect(i * bw, (H - h) / 2, Math.max(1, bw * 0.62), h);
    }
    g.globalAlpha = 1;
    drawPlayhead(currentPos());
  }

  function drawPlayhead(pos) {
    if (!waveCanvas || !waveCache) return;
    var W = waveCanvas.width, H = waveCanvas.height;
    var g = waveCtx2d;
    g.clearRect(0, 0, W, H);
    g.drawImage(waveCache, 0, 0);
    var x = (pos / S.duration) * W;
    g.fillStyle = '#ffffff';
    g.fillRect(x - 1, 0, 2, H);
  }

  function seekFromEvent(e) {
    if (!S.orig) return;
    var rect = waveCanvas.getBoundingClientRect();
    var ratio = (e.clientX - rect.left) / rect.width;
    var pos = Math.max(0, Math.min(S.duration, ratio * S.duration));
    if (playing) play(pos);
    else { startOffset = pos; $('timeRead').textContent = E.formatTime(pos) + ' / ' + E.formatTime(S.duration); drawWaveform(); }
  }

  /* ---------- loading & separation ---------- */
  function handleFileData(arrayBuffer, name) {
    setStatus(''); setProgress('Decoding audio…', 15);
    $('studioWorkspace').hidden = true;
    setTimeout(function () {
      E.decodeFile(arrayBuffer).then(function (decoded) {
        if (decoded.duration > MAX_SECONDS) {
          setProgress(null);
          setStatus('That file is ' + Math.round(decoded.duration / 60) + ' minutes long. This browser version handles up to 10 minutes per file — try a shorter clip.', 'err');
          return;
        }
        setProgress('Separating vocals & music…', 55);
        setTimeout(function () {
          try {
            var chans = E.bufferToChannels(decoded);
            S.sampleRate = decoded.sampleRate;
            S.duration = decoded.duration;
            S.fileName = (name || 'audio').replace(/\.[^.]+$/, '');
            S.orig = chans;
            var stems = E.separateStems(chans[0], chans[1]);
            S.vocals = stems.vocals; S.music = stems.music;
            S.bufVocals = E.channelsToBuffer(S.vocals, S.sampleRate);
            S.bufMusic = E.channelsToBuffer(S.music, S.sampleRate);
            S.stem = 'original'; startOffset = 0;
            setProgress(null);
            showWorkspace();
            setStatus('Done — preview each stem, or blend them in Custom Mix.', 'ok');
          } catch (err) {
            setProgress(null);
            setStatus('Separation failed: ' + err.message, 'err');
          }
        }, 40);
      }).catch(function () {
        setProgress(null);
        setStatus('Could not decode that file. Try MP3, WAV, M4A, OGG or MP4.', 'err');
      });
    }, 40);
  }

  function handleFiles(files) {
    var f = files[0];
    if (!f) return;
    if (f.size > 400 * 1024 * 1024) { setStatus('File is too large (400 MB max).', 'err'); return; }
    var reader = new FileReader();
    reader.onload = function () { handleFileData(reader.result, f.name); };
    reader.onerror = function () { setStatus('Could not read that file.', 'err'); };
    setProgress('Reading file…', 5);
    reader.readAsArrayBuffer(f);
  }

  function showWorkspace() {
    $('studioWorkspace').hidden = false;
    $('fileName').textContent = S.fileName;
    $('fileMeta').textContent = E.formatTime(S.duration) + ' · ' + S.sampleRate + ' Hz · separated on your device';
    document.querySelectorAll('.stem-tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.stem === S.stem);
    });
    $('mixerSection').style.display = S.stem === 'custom' ? '' : 'none';
    $('timeRead').textContent = '0:00 / ' + E.formatTime(S.duration);
    drawWaveform();
    $('studioWorkspace').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- recording ---------- */
  function toggleRecord() {
    var btn = $('recordBtn');
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      btn.innerHTML = '🎙️ Record audio';
      return;
    }
    if (!window.MediaRecorder || !navigator.mediaDevices) {
      setStatus('Recording is not supported in this browser — try uploading a file instead.', 'err');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recChunks = [];
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = function (e) { if (e.data.size) recChunks.push(e.data); };
      mediaRecorder.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); });
        var blob = new Blob(recChunks, { type: mediaRecorder.mimeType });
        blob.arrayBuffer().then(function (ab) { handleFileData(ab, 'recording'); });
      };
      mediaRecorder.start();
      btn.innerHTML = '⏹ Stop recording';
      setStatus('Recording… speak or play audio near your mic, then stop.', '');
    }).catch(function () {
      setStatus('Microphone access was denied.', 'err');
    });
  }

  /* ---------- downloads ---------- */
  function baseName(suffix) { return S.fileName + '-' + suffix + '.wav'; }
  function dl(kind) {
    if (!S.orig) return;
    try {
      if (kind === 'vocals') E.downloadWav(S.vocals, S.sampleRate, baseName('vocals'));
      else if (kind === 'music') E.downloadWav(S.music, S.sampleRate, baseName('music'));
      else if (kind === 'original') E.downloadWav(S.orig, S.sampleRate, baseName('original'));
      else if (kind === 'mix') {
        var mixed = E.mixStems(S.vocals, S.music, S.vGain, S.mGain);
        E.downloadWav(mixed, S.sampleRate, baseName('custom-mix'));
      } else if (kind === 'all') {
        setStatus('Packing stems into a zip…', '');
        E.downloadZip([
          { name: baseName('vocals'), channels: S.vocals, sampleRate: S.sampleRate },
          { name: baseName('music'), channels: S.music, sampleRate: S.sampleRate },
          { name: baseName('original'), channels: S.orig, sampleRate: S.sampleRate }
        ]).then(function () { setStatus('Zip downloaded.', 'ok'); })
          .catch(function () { setStatus('Zip failed — download stems individually instead.', 'err'); });
      }
    } catch (err) { setStatus('Download failed: ' + err.message, 'err'); }
  }

  /* ---------- init ---------- */
  function init() {
    waveCanvas = $('waveCanvas');
    if (waveCanvas) waveCtx2d = waveCanvas.getContext('2d');

    StemSplitSite.setupDropzone($('dropzone'), $('fileInput'), handleFiles);

    $('urlBtn').addEventListener('click', function () {
      var url = $('urlInput').value.trim();
      if (!url) { setStatus('Paste a direct link to an audio file first.', 'err'); return; }
      setProgress('Downloading…', 8);
      StemSplitSite.fetchAudioFromUrl(url,
        function (ab) {
          var name = url.split('/').pop().split('?')[0] || 'audio';
          handleFileData(ab, name);
        },
        function (msg) { setProgress(null); setStatus(msg, 'err'); });
    });

    $('recordBtn').addEventListener('click', toggleRecord);
    $('newFileBtn').addEventListener('click', function () {
      pause(false); startOffset = 0;
      $('studioWorkspace').hidden = true; setStatus('');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    document.querySelectorAll('.stem-tab').forEach(function (t) {
      t.addEventListener('click', function () {
        var wasPlaying = playing, pos = currentPos();
        if (wasPlaying) pause(false);
        S.stem = t.dataset.stem;
        document.querySelectorAll('.stem-tab').forEach(function (x) { x.classList.toggle('active', x === t); });
        $('mixerSection').style.display = S.stem === 'custom' ? '' : 'none';
        drawWaveform();
        if (wasPlaying) play(pos);
      });
    });

    $('playBtn').addEventListener('click', togglePlay);
    waveCanvas.addEventListener('click', seekFromEvent);

    function bindMix(id, outId, key) {
      var r = $(id);
      r.addEventListener('input', function () {
        S[key] = r.value / 100;
        $(outId).textContent = r.value + '%';
        if (playing && S.stem === 'custom') {
          var g = gainsForStem();
          vocalGain.gain.setTargetAtTime(g[0], ctx.currentTime, 0.02);
          musicGain.gain.setTargetAtTime(g[1], ctx.currentTime, 0.02);
        }
      });
    }
    bindMix('mixVocals', 'mixVocalsVal', 'vGain');
    bindMix('mixMusic', 'mixMusicVal', 'mGain');

    $('dlVocals').addEventListener('click', function () { dl('vocals'); });
    $('dlMusic').addEventListener('click', function () { dl('music'); });
    $('dlOriginal').addEventListener('click', function () { dl('original'); });
    $('dlMix').addEventListener('click', function () { dl('mix'); });
    $('dlAll').addEventListener('click', function () { dl('all'); });

    window.addEventListener('resize', function () { if (S.orig) drawWaveform(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
