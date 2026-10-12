/* StemSplit tool pages: pitch shifter, BPM/key finder, cutter, joiner, speed.
   Each page calls StemSplitTools.init('<name>') on DOMContentLoaded. */
(function () {
  'use strict';
  var E = window.StemSplitEngine;

  function $(id) { return document.getElementById(id); }
  function status(msg, cls) {
    var el = $('statusMsg');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'status-msg' + (cls ? ' ' + cls : '');
  }

  /* ---------- tiny player ---------- */
  var ctx = null, src = null;
  function player() {
    if (!ctx) ctx = E.getContext();
    return ctx;
  }
  function playChannels(channels, sampleRate, offset, dur) {
    stopPlay();
    var c = player();
    src = c.createBufferSource();
    src.buffer = E.channelsToBuffer(channels, sampleRate);
    src.connect(c.destination);
    src.start(0, offset || 0, dur);
    return src;
  }
  function stopPlay() {
    if (src) { try { src.stop(); } catch (e) {} src = null; }
  }

  /* ---------- shared file loading ---------- */
  function loadFirstFile(files, cb) {
    var f = files[0];
    if (!f) return;
    status('Loading…');
    f.arrayBuffer().then(function (ab) {
      return E.decodeFile(ab);
    }).then(function (decoded) {
      var chans = E.bufferToChannels(decoded);
      cb({ channels: chans, sampleRate: decoded.sampleRate, duration: decoded.duration, name: f.name.replace(/\.[^.]+$/, '') });
      status('');
    }).catch(function () { status('Could not decode that file. Try MP3, WAV, M4A or OGG.', 'err'); });
  }

  function showFileChip(info) {
    var chip = $('fileChip');
    if (!chip) return;
    chip.style.display = '';
    $('fileName').textContent = info.name;
    $('fileMeta').textContent = E.formatTime(info.duration) + ' · ' + info.sampleRate + ' Hz';
  }

  function drawWave(canvas, channels, color, sel) {
    if (!canvas || !channels) return;
    var W = canvas.width = canvas.offsetWidth * 2;
    var H = canvas.height = 300;
    var g = canvas.getContext('2d');
    g.clearRect(0, 0, W, H);
    var mono = E.downmixMono(channels);
    var peaks = E.peaksForWaveform(mono, Math.floor(W / 3));
    var bw = W / peaks.length;
    g.fillStyle = color || '#22d3ee';
    for (var i = 0; i < peaks.length; i++) {
      var h = Math.max(2, peaks[i] * H * 0.92);
      g.globalAlpha = 0.35 + peaks[i] * 0.65;
      g.fillRect(i * bw, (H - h) / 2, Math.max(1, bw * 0.62), h);
    }
    g.globalAlpha = 1;
    if (sel) {
      var n = mono.length;
      var x1 = (sel[0] / n) * W, x2 = (sel[1] / n) * W;
      g.fillStyle = 'rgba(139,92,246,.22)';
      g.fillRect(x1, 0, x2 - x1, H);
      g.fillStyle = '#8b5cf6';
      g.fillRect(x1 - 1, 0, 2, H); g.fillRect(x2 - 1, 0, 2, H);
    }
  }

  /* ================= PITCH ================= */
  function initPitch() {
    var info = null, rendered = null, rate = 1;
    function currentRate() { return Math.pow(2, parseFloat($('semitoneRange').value) / 12); }
    function refreshLabel() {
      var st = parseFloat($('semitoneRange').value);
      $('semitoneVal').textContent = (st > 0 ? '+' : '') + st + ' st';
      rate = currentRate();
    }
    async function ensureRendered() {
      var r = currentRate();
      if (!rendered || Math.abs(r - rate) > 1e-9) {
        rate = r;
        status('Rendering pitched audio…');
        rendered = await E.renderAtRate(info.channels, info.sampleRate, rate);
        status('');
      }
      return rendered;
    }
    StemSplitSite.setupDropzone($('dropzone'), $('fileInput'), function (files) {
      loadFirstFile(files, function (res) {
        info = res; rendered = null;
        $('workspace').hidden = false;
        showFileChip(info);
        drawWave($('waveCanvas'), info.channels, '#8b5cf6');
        refreshLabel();
      });
    });
    $('semitoneRange').addEventListener('input', refreshLabel);
    $('pitchPlay').addEventListener('click', async function () {
      if (!info) return;
      stopPlay();
      if (this.dataset.playing === '1') { this.dataset.playing = ''; this.textContent = '▶ Preview'; return; }
      var ch = await ensureRendered();
      var s = playChannels(ch, info.sampleRate);
      this.dataset.playing = '1'; this.textContent = '⏸ Stop';
      s.onended = () => { this.dataset.playing = ''; this.textContent = '▶ Preview'; };
    });
    $('pitchDownload').addEventListener('click', async function () {
      if (!info) return;
      var ch = await ensureRendered();
      E.downloadWav(ch, info.sampleRate, info.name + '-pitch.wav');
      status('Downloaded.', 'ok');
    });
  }

  /* ================= BPM + KEY ================= */
  function initBpm() {
    StemSplitSite.setupDropzone($('dropzone'), $('fileInput'), function (files) {
      loadFirstFile(files, function (info) {
        $('workspace').hidden = false;
        showFileChip(info);
        drawWave($('waveCanvas'), info.channels, '#22d3ee');
        status('Analyzing tempo & key…');
        setTimeout(function () {
          var mono = E.downmixMono(info.channels);
          var bpm = E.detectBPM(mono, info.sampleRate);
          var key = E.detectKey(mono, info.sampleRate);
          $('bpmBig').textContent = bpm ? bpm + ' BPM' : '—';
          $('keyBig').textContent = key ? key.name + ' ' + key.mode : '—';
          $('keyConf').textContent = key ? 'confidence ' + Math.round(key.confidence * 100) + '%' : '';
          $('bpmMeta').textContent = 'Analyzed ' + E.formatTime(info.duration) + ' of audio on your device.';
          status(bpm ? 'Analysis complete.' : 'Not enough rhythmic material to lock a tempo.', bpm ? 'ok' : '');
        }, 40);
      });
    });
  }

  /* ================= CUTTER ================= */
  function initCutter() {
    var info = null, sel = [0, 0], dragging = false;
    var canvas = $('waveCanvas');
    function selSeconds() {
      var n = info.channels[0].length;
      return [sel[0] / info.sampleRate, sel[1] / info.sampleRate];
    }
    function syncInputs() {
      var s = selSeconds();
      $('startTime').value = s[0].toFixed(2);
      $('endTime').value = s[1].toFixed(2);
      $('selectionInfo').textContent = 'Selection: ' + E.formatTime(s[0]) + ' → ' + E.formatTime(s[1]) +
        ' (' + (s[1] - s[0]).toFixed(2) + 's)';
    }
    function redraw() { drawWave(canvas, info.channels, '#8b5cf6', [Math.floor(sel[0]), Math.ceil(sel[1])]); }
    function canvasToSample(e) {
      var rect = canvas.getBoundingClientRect();
      var ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      return Math.floor(ratio * info.channels[0].length);
    }
    canvas.addEventListener('mousedown', function (e) {
      if (!info) return;
      dragging = true;
      var p = canvasToSample(e);
      sel = [p, p]; redraw();
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging || !info) return;
      var p = canvasToSample(e);
      sel = [Math.min(sel[0], p), Math.max(sel[0], p)];
      redraw(); syncInputs();
    });
    window.addEventListener('mouseup', function () { dragging = false; });
    function applyInputs() {
      if (!info) return;
      var n = info.channels[0].length;
      var a = Math.max(0, Math.min(n, Math.floor(parseFloat($('startTime').value) * info.sampleRate)));
      var b = Math.max(0, Math.min(n, Math.ceil(parseFloat($('endTime').value) * info.sampleRate)));
      if (b <= a) { status('End time must be after start time.', 'err'); return; }
      sel = [a, b]; redraw(); syncInputs();
    }
    $('startTime').addEventListener('change', applyInputs);
    $('endTime').addEventListener('change', applyInputs);

    StemSplitSite.setupDropzone($('dropzone'), $('fileInput'), function (files) {
      loadFirstFile(files, function (res) {
        info = res;
        sel = [0, info.channels[0].length];
        $('workspace').hidden = false;
        showFileChip(info);
        redraw(); syncInputs();
      });
    });
    $('cutPlay').addEventListener('click', function () {
      if (!info) return;
      stopPlay();
      if (this.dataset.playing === '1') { this.dataset.playing = ''; this.textContent = '▶ Preview selection'; return; }
      var part = E.sliceChannels(info.channels, sel[0], sel[1]);
      var s = playChannels(part, info.sampleRate);
      this.dataset.playing = '1'; this.textContent = '⏸ Stop';
      s.onended = () => { this.dataset.playing = ''; this.textContent = '▶ Preview selection'; };
    });
    $('cutDownload').addEventListener('click', function () {
      if (!info) return;
      var part = E.sliceChannels(info.channels, sel[0], sel[1]);
      E.downloadWav(part, info.sampleRate, info.name + '-cut.wav');
      status('Downloaded.', 'ok');
    });
    window.addEventListener('resize', function () { if (info) redraw(); });
  }

  /* ================= JOINER ================= */
  function initJoiner() {
    var tracks = []; // {channels, sampleRate, duration, name}
    function renderList() {
      var list = $('trackList');
      list.innerHTML = '';
      var total = 0;
      tracks.forEach(function (t, i) {
        total += t.duration;
        var row = document.createElement('div');
        row.className = 'file-chip';
        row.innerHTML = '<span class="f-icon">🎵</span><span class="f-meta"><span class="f-name"></span><span class="f-sub"></span></span><button title="Remove">✕</button>';
        row.querySelector('.f-name').textContent = (i + 1) + '. ' + t.name;
        row.querySelector('.f-sub').textContent = E.formatTime(t.duration);
        row.querySelector('button').addEventListener('click', function () { tracks.splice(i, 1); renderList(); });
        list.appendChild(row);
      });
      $('totalTime').textContent = tracks.length ? 'Total: ' + E.formatTime(total) + ' across ' + tracks.length + ' tracks' : 'No tracks yet — add at least two.';
      var has = tracks.length >= 1;
      $('joinPlay').disabled = !has;
      $('joinDownload').disabled = tracks.length < 1;
      $('workspace').hidden = tracks.length === 0;
    }
    function addFiles(files) {
      status('Loading ' + files.length + ' file(s)…');
      var pending = files.length;
      Array.from(files).forEach(function (f) {
        f.arrayBuffer().then(function (ab) { return E.decodeFile(ab); }).then(function (decoded) {
          // resample to first track's rate if needed via OfflineAudioContext
          var chans = E.bufferToChannels(decoded);
          var targetRate = tracks.length ? tracks[0].sampleRate : decoded.sampleRate;
          function push(ch, rate) {
            tracks.push({ channels: ch, sampleRate: rate, duration: ch[0].length / rate, name: f.name.replace(/\.[^.]+$/, '') });
            if (--pending === 0) { status(''); renderList(); }
          }
          if (decoded.sampleRate === targetRate) { push(chans, targetRate); }
          else {
            var off = new OfflineAudioContext(2, Math.ceil(chans[0].length * targetRate / decoded.sampleRate), targetRate);
            var srcb = off.createBufferSource();
            srcb.buffer = E.channelsToBuffer(chans, decoded.sampleRate);
            srcb.connect(off.destination); srcb.start(0);
            off.startRendering().then(function (r) {
              push([new Float32Array(r.getChannelData(0)), new Float32Array(r.getChannelData(1))], targetRate);
            });
          }
        }).catch(function () {
          if (--pending === 0) { status(''); renderList(); }
          status('One file could not be decoded and was skipped.', 'err');
        });
      });
    }
    StemSplitSite.setupDropzone($('dropzone'), $('fileInput'), addFiles);
    $('addMoreBtn').addEventListener('click', function () { $('fileInput').click(); });
    function joined() { return E.concatChannels(tracks.map(function (t) { return t.channels; })); }
    $('joinPlay').addEventListener('click', function () {
      if (!tracks.length) return;
      stopPlay();
      if (this.dataset.playing === '1') { this.dataset.playing = ''; this.textContent = '▶ Preview mix'; return; }
      var s = playChannels(joined(), tracks[0].sampleRate);
      this.dataset.playing = '1'; this.textContent = '⏸ Stop';
      s.onended = () => { this.dataset.playing = ''; this.textContent = '▶ Preview mix'; };
    });
    $('joinDownload').addEventListener('click', function () {
      if (!tracks.length) return;
      E.downloadWav(joined(), tracks[0].sampleRate, 'stemsplit-joined.wav');
      status('Downloaded.', 'ok');
    });
    renderList();
  }

  /* ================= SPEED ================= */
  function initSpeed() {
    var info = null, rendered = null, rate = 1;
    function refreshLabel() {
      rate = parseFloat($('speedRange').value);
      $('speedVal').textContent = rate.toFixed(2) + '×';
      document.querySelectorAll('.speed-preset').forEach(function (b) {
        b.classList.toggle('active', Math.abs(parseFloat(b.dataset.speed) - rate) < 0.001);
      });
    }
    async function ensureRendered() {
      var r = parseFloat($('speedRange').value);
      if (!rendered || Math.abs(r - rate) > 1e-9) {
        rate = r;
        status('Rendering…');
        rendered = await E.renderAtRate(info.channels, info.sampleRate, rate);
        status('');
      }
      return rendered;
    }
    StemSplitSite.setupDropzone($('dropzone'), $('fileInput'), function (files) {
      loadFirstFile(files, function (res) {
        info = res; rendered = null;
        $('workspace').hidden = false;
        showFileChip(info);
        drawWave($('waveCanvas'), info.channels, '#22d3ee');
        refreshLabel();
      });
    });
    $('speedRange').addEventListener('input', refreshLabel);
    document.querySelectorAll('.speed-preset').forEach(function (b) {
      b.addEventListener('click', function () { $('speedRange').value = b.dataset.speed; refreshLabel(); });
    });
    $('speedPlay').addEventListener('click', async function () {
      if (!info) return;
      stopPlay();
      if (this.dataset.playing === '1') { this.dataset.playing = ''; this.textContent = '▶ Preview'; return; }
      var ch = await ensureRendered();
      var s = playChannels(ch, info.sampleRate);
      this.dataset.playing = '1'; this.textContent = '⏸ Stop';
      s.onended = () => { this.dataset.playing = ''; this.textContent = '▶ Preview'; };
    });
    $('speedDownload').addEventListener('click', async function () {
      if (!info) return;
      var ch = await ensureRendered();
      E.downloadWav(ch, info.sampleRate, info.name + '-' + rate.toFixed(2) + 'x.wav');
      status('Downloaded.', 'ok');
    });
  }

  var inits = { pitch: initPitch, bpm: initBpm, cutter: initCutter, joiner: initJoiner, speed: initSpeed };
  window.StemSplitTools = {
    init: function (name) {
      document.addEventListener('DOMContentLoaded', function () {
        if (inits[name]) inits[name]();
      });
    }
  };
})();
