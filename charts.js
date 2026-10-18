/*
 * Versailles Vivant — charts for the Impact page
 * ---------------------------------------------------------------
 * Plain SVG, no library and no external requests. Every chart is built from the data table that sits right
 * below it in the page (<table class="data-table" data-chart="line|bar">), so the numbers exist once, are readable
 * without JavaScript, and are available to screen readers. The cell to plot is marked with `data-plot`
 * (and carries data-value); cells with data-fmt ("int" | "eur" | "pct") are formatted for the current language.
 * Charts are redrawn when the language changes or the container is resized.
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function svg(name, attrs, text) {
    var node = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (text !== undefined) node.textContent = text;
    return node;
  }
  // numbers are written by script.js (VV.formatNumber), which formats Macedonian by hand because browsers lack its data
  function fmt(kind, value) {
    if (window.VV && window.VV.formatNumber) return window.VV.formatNumber(kind, value);
    return String(value);
  }
  /* write localised numbers into the table cells */
  function formatCells(table) {
    Array.prototype.forEach.call(table.querySelectorAll('[data-fmt][data-value]'), function (cell) {
      cell.textContent = fmt(cell.getAttribute('data-fmt'), Number(cell.getAttribute('data-value')));
    });
  }
  function readTable(table) {
    var rows = [];
    Array.prototype.forEach.call(table.querySelectorAll('tbody tr'), function (tr) {
      var head = tr.querySelector('th');
      var cell = tr.querySelector('[data-plot]');
      if (!head || !cell) return;
      rows.push({ label: head.textContent.trim(), value: Number(cell.getAttribute('data-value')), text: cell.textContent.trim() });
    });
    return rows;
  }
  function niceMax(max) {
    var pow = Math.pow(10, Math.floor(Math.log(max) / Math.LN10));
    var n = max / pow;
    var step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return step * pow;
  }

  /* ----- line chart: one value per category, joined by a line ----- */
  function drawLine(target, rows, width) {
    var height = Math.max(240, Math.min(340, Math.round(width * 0.5)));
    var m = { top: 20, right: 24, bottom: 36, left: 46 };
    var w = width - m.left - m.right;
    var h = height - m.top - m.bottom;
    var max = niceMax(Math.max.apply(null, rows.map(function (r) { return r.value; })));
    var ticks = 5;
    var root = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, 'aria-hidden': 'true', focusable: 'false', 'class': 'chart-svg' });

    for (var i = 0; i <= ticks; i++) {
      var v = (max / ticks) * i;
      var y = m.top + h - (v / max) * h;
      root.appendChild(svg('line', { x1: m.left, x2: m.left + w, y1: y, y2: y, 'class': i === 0 ? 'axis' : 'grid' }));
      root.appendChild(svg('text', { x: m.left - 8, y: y + 4, 'text-anchor': 'end', 'class': 'tick' }, fmt('int', v)));
    }
    var step = rows.length > 1 ? w / (rows.length - 1) : 0;
    var skip = width < 480 ? 2 : 1;
    var points = rows.map(function (r, idx) {
      return { x: m.left + idx * step, y: m.top + h - (r.value / max) * h, r: r, idx: idx };
    });
    points.forEach(function (p) {
      if (p.idx % skip === 0 || p.idx === points.length - 1) {
        root.appendChild(svg('text', { x: p.x, y: height - 12, 'text-anchor': 'middle', 'class': 'tick' }, p.r.label));
      }
    });
    var area = 'M' + points[0].x + ' ' + (m.top + h) + ' ' + points.map(function (p) { return 'L' + p.x + ' ' + p.y; }).join(' ') + ' L' + points[points.length - 1].x + ' ' + (m.top + h) + ' Z';
    root.appendChild(svg('path', { d: area, 'class': 'area' }));
    root.appendChild(svg('polyline', { points: points.map(function (p) { return p.x + ',' + p.y; }).join(' '), 'class': 'line', fill: 'none' }));
    points.forEach(function (p) {
      var c = svg('circle', { cx: p.x, cy: p.y, r: 4, 'class': 'dot' });
      c.appendChild(svg('title', {}, p.r.label + ': ' + p.r.text));
      root.appendChild(c);
    });
    var last = points[points.length - 1];
    root.appendChild(svg('text', { x: last.x, y: last.y - 12, 'text-anchor': 'end', 'class': 'value-label' }, last.r.text));
    target.appendChild(root);
  }

  /* ----- horizontal bar chart: label above each bar, value at its end ----- */
  function drawBars(target, rows, width) {
    var rowH = 52;
    var m = { top: 6, right: 8, bottom: 6, left: 0 };
    var valueRoom = 76;
    var height = m.top + m.bottom + rows.length * rowH;
    var max = Math.max.apply(null, rows.map(function (r) { return r.value; }));
    var barMax = Math.max(40, width - m.left - m.right - valueRoom);
    var root = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, width: width, height: height, 'aria-hidden': 'true', focusable: 'false', 'class': 'chart-svg' });
    rows.forEach(function (r, idx) {
      var y = m.top + idx * rowH;
      var len = Math.max(2, (r.value / max) * barMax);
      root.appendChild(svg('text', { x: m.left, y: y + 16, 'class': 'bar-label' }, r.label));
      root.appendChild(svg('rect', { x: m.left, y: y + 24, width: barMax, height: 14, rx: 3, 'class': 'bar-track' }));
      var bar = svg('rect', { x: m.left, y: y + 24, width: len, height: 14, rx: 3, 'class': 'bar' });
      bar.appendChild(svg('title', {}, r.label + ': ' + r.text));
      root.appendChild(bar);
      root.appendChild(svg('text', { x: m.left + barMax + 10, y: y + 36, 'class': 'value-label' }, r.text));
    });
    target.appendChild(root);
  }

  function render(block) {
    var table = block.querySelector('table[data-chart]');
    var target = block.querySelector('[data-chart-target]');
    if (!table || !target) return;
    formatCells(table);
    var rows = readTable(table);
    var width = Math.floor(target.clientWidth || target.parentNode.clientWidth || 600);
    if (!rows.length || width < 120) return;
    while (target.firstChild) target.removeChild(target.firstChild);
    target.setAttribute('data-width', width);
    if (table.getAttribute('data-chart') === 'line') drawLine(target, rows, width); else drawBars(target, rows, width);
  }

  function renderAll() {
    Array.prototype.forEach.call(document.querySelectorAll('.chart-block'), render);
  }

  function start() {
    renderAll();
    document.addEventListener('vv:langchange', renderAll);
    var timer = null;
    function onResize() {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        Array.prototype.forEach.call(document.querySelectorAll('.chart-block'), function (block) {
          var target = block.querySelector('[data-chart-target]');
          if (target && Math.abs((target.clientWidth || 0) - Number(target.getAttribute('data-width') || 0)) > 1) render(block);
        });
      }, 120);
    }
    window.addEventListener('resize', onResize);
    if (window.ResizeObserver) {
      var ro = new window.ResizeObserver(onResize);
      Array.prototype.forEach.call(document.querySelectorAll('[data-chart-target]'), function (el) { ro.observe(el); });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
