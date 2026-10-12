/* StemSplit shared site behaviour: mobile nav, FAQ accordion, year, dropzones */
(function () {
  'use strict';

  // Mobile nav
  document.addEventListener('DOMContentLoaded', function () {
    var toggle = document.querySelector('.mobile-toggle');
    var nav = document.querySelector('.nav');
    if (toggle && nav) {
      toggle.addEventListener('click', function () { nav.classList.toggle('open'); });
    }

    // FAQ accordion
    document.querySelectorAll('.faq-item').forEach(function (item) {
      var q = item.querySelector('.faq-q');
      var a = item.querySelector('.faq-a');
      if (!q || !a) return;
      q.addEventListener('click', function () {
        var open = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(function (o) {
          o.classList.remove('open');
          o.querySelector('.faq-a').style.maxHeight = null;
        });
        if (!open) {
          item.classList.add('open');
          a.style.maxHeight = a.scrollHeight + 'px';
        }
      });
    });

    // Footer year
    document.querySelectorAll('[data-year]').forEach(function (el) {
      el.textContent = new Date().getFullYear();
    });
  });

  // Drag & drop helper. onFiles(files: FileList)
  function setupDropzone(zone, input, onFiles) {
    if (!zone) return;
    zone.addEventListener('click', function (e) {
      if (e.target.closest('button') || e.target.closest('input')) return;
      input.click();
    });
    input.addEventListener('change', function () {
      if (input.files.length) onFiles(input.files);
      input.value = '';
    });
    ['dragenter', 'dragover'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('dragover'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('dragover'); });
    });
    zone.addEventListener('drop', function (e) {
      if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files);
    });
  }

  // Paste-audio-from-URL helper with CORS-friendly fetch
  function fetchAudioFromUrl(url, onData, onError) {
    fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(onData).catch(function (err) {
      onError(err && err.message ? 'Could not load that URL (' + err.message + '). The host may block cross-site downloads — try uploading the file instead.' : 'Could not load that URL.');
    });
  }

  window.StemSplitSite = { setupDropzone: setupDropzone, fetchAudioFromUrl: fetchAudioFromUrl };
})();
