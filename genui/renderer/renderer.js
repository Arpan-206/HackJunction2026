/* Renders an Apprentice page spec (catalog/page.schema.json) into the DOM.
   Load with ?spec=<name> to fetch ../specs/<name>.json. Unknown components render an error card, never crash the page. */
(function () {
  'use strict';

  var FINGER = ['', 'Thumb', 'Index', 'Middle', 'Ring', 'Little'];
  var ROMAN = ['I', 'II', 'III', 'IV', 'V'];
  var stageListeners = [];

  /** Creates an element with attributes and children. */
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') n.textContent = attrs[k];
      else if (k === 'class') n.className = attrs[k];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), attrs[k]);
      else n.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }

  function svg(tag, attrs) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function card(title, children, extra) {
    return el('section', { class: 'card' }, [title ? el('div', { class: 'row-head' }, [el('h2', { text: title }), extra]) : null].concat(children));
  }

  function handStage(c) {
    var canvas = el('canvas', { role: 'img', 'aria-label': '3D study of the glove hands. Drag to turn.' });
    var badge = el('div', { class: 'badge', text: c.hands === 'both' ? 'Two gloves live' : (c.hands === 'left' ? 'Left' : 'Right') + ' glove live' });
    var label = el('span');
    var mark = el('div', { class: 'mark', 'aria-hidden': 'true' });
    mark.innerHTML = '<svg width="56" height="56" viewBox="0 0 56 56" fill="none" stroke="#FFFFFF" stroke-width="1.6"><path d="M28 5c13 0 23 9 23 22 0 14-10 24-23 24C14 51 5 41 5 28 5 15 14 6 29 6"/></svg>';
    mark.appendChild(label);
    mark.style.display = 'none';
    var fig = el('figure', { class: 'stage', 'data-component': 'hand_stage' }, [canvas, el('div', { class: 'frame', 'aria-hidden': 'true' }), mark, badge]);
    var handle = null;
    var view = { showJoints: c.show_joints !== false, showTrails: c.show_trails !== false };
    function toggle(key, name) {
      var b = el('button', { type: 'button', 'aria-pressed': String(view[key]), text: name });
      b.addEventListener('click', function () {
        view[key] = !view[key];
        b.setAttribute('aria-pressed', String(view[key]));
        var patch = {}; patch[key] = view[key];
        if (handle) handle.set(patch);
      });
      return b;
    }
    fig.appendChild(el('div', { class: 'toggles', role: 'group', 'aria-label': 'Study overlays' }, [toggle('showJoints', 'Joints'), toggle('showTrails', 'Trails')]));
    fig.appendChild(el('figcaption', { text: c.caption }));
    requestAnimationFrame(function () {
      if (!window.Hand3D || !window.THREE) { fig.appendChild(el('div', { class: 'error', text: '3D engine failed to load.' })); return; }
      handle = window.Hand3D.mount(canvas, {
        hands: c.hands, prop: c.prop, motion: c.motion, focusFinger: c.focus_finger || 0,
        showJoints: view.showJoints, showTrails: view.showTrails, preserveDrawingBuffer: true,
        onTick: function (info) {
          var tip = info.active >= 0 ? info.tips[info.active] : null;
          if (tip && c.motion.kind === 'finger_sequence') {
            mark.style.display = '';
            mark.style.left = Math.round(tip.x - 28) + 'px';
            mark.style.top = Math.round(tip.y - 28) + 'px';
            label.textContent = (info.active + 1) + ', ' + FINGER[info.active + 1].toLowerCase();
          } else {
            mark.style.display = 'none';
          }
          stageListeners.forEach(function (fn) { fn(info); });
        }
      });
      window.__stage = handle;
    });
    return fig;
  }

  function stepTimeline(c) {
    var ol = el('ol', { class: 'steps', 'aria-label': c.title });
    ol.style.gridTemplateColumns = 'repeat(' + c.steps.length + ', minmax(0, 1fr))';
    var items = c.steps.map(function (s) {
      var li = el('li', { title: s.detail }, [el('b', { text: s.label }), el('small', { text: s.finger ? 'finger ' + s.finger : s.detail })]);
      ol.appendChild(li);
      return li;
    });
    var last = -1;
    stageListeners.push(function (info) {
      var i = info.step % items.length;
      if (i === last) return;
      if (last >= 0) items[last].classList.remove('on');
      items[i].classList.add('on');
      last = i;
    });
    var detail = el('p', { class: 'hint', text: c.steps.map(function (s) { return s.label + ': ' + s.detail; }).join(' · ') });
    return card(c.title, [ol, detail]);
  }

  function fingerLanes(c) {
    var N = 90;
    var rows = c.fingers.map(function (f) {
      var buf = []; for (var i = 0; i < N; i++) buf.push(0);
      var line = svg('polyline', { fill: 'none', stroke: '#5C5F6B', 'stroke-width': '1.6', 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' });
      var s = svg('svg', { viewBox: '0 0 900 36', preserveAspectRatio: 'none', role: 'img', 'aria-label': FINGER[f] + ' flexion over time' });
      s.appendChild(svg('line', { x1: 0, y1: 31, x2: 900, y2: 31, stroke: '#C9CAC4', 'vector-effect': 'non-scaling-stroke' }));
      s.appendChild(line);
      return { f: f, buf: buf, line: line, node: el('div', { class: 'lane' }, [el('span', { class: 'lbl' }, [el('b', { text: String(f) }), FINGER[f]]), s]) };
    });
    stageListeners.push(function (info) {
      rows.forEach(function (r) {
        r.buf.push(info.curls[r.f - 1]); r.buf.shift();
        r.line.setAttribute('points', r.buf.map(function (v, k) { return (k * 900 / (N - 1)).toFixed(1) + ',' + (31 - Math.max(-0.2, v) * 26).toFixed(1); }).join(' '));
        r.line.setAttribute('stroke', info.active === r.f - 1 ? '#1F2E78' : '#5C5F6B');
        r.line.setAttribute('stroke-width', info.active === r.f - 1 ? '2.6' : '1.6');
      });
    });
    return card(c.title, rows.map(function (r) { return r.node; }), el('span', { class: 'hint', text: 'Live from the gloves' }));
  }

  function metricRow(c) {
    var g = el('div', { class: 'metrics' });
    g.style.gridTemplateColumns = 'repeat(' + c.metrics.length + ', minmax(0, 1fr))';
    c.metrics.forEach(function (m) {
      g.appendChild(el('div', { class: 'metric tone-' + m.tone }, [el('span', { class: 'hint', text: m.label }), el('span', { class: 'v' }, [m.value, m.unit ? el('small', { text: m.unit }) : null])]));
    });
    return card(c.title, [g]);
  }

  function checklist(c) {
    return card(c.title, [el('ul', { class: 'list' }, c.items.map(function (i) {
      var icon = el('span', { 'aria-hidden': 'true' });
      icon.innerHTML = i.done
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2F7A57" stroke-width="2.2"><path d="M5 12l5 5 9-10"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6B6E7A" stroke-width="1.8"><circle cx="12" cy="12" r="7"/></svg>';
      return el('li', { class: 'check' }, [icon, i.label + (i.done ? '' : ' (pending)')]);
    }))]);
  }

  function takeList(c) {
    var label = { kept: 'kept', set_aside: 'set aside', recording: 'recording' };
    return card(c.title, [el('ul', { class: 'list' }, c.takes.map(function (t) {
      return el('li', { class: 'take ' + t.status }, [
        el('b', { text: t.name }),
        el('span', { class: 'meta' }, [t.duration + ' · ' + label[t.status], t.note ? el('span', { class: 'note' + (t.status === 'set_aside' ? ' fix' : ''), text: t.note }) : null]),
        el('span', { class: 'sc', text: typeof t.score === 'number' ? String(t.score) : 'live' })
      ]);
    }))], el('span', { class: 'hint', text: 'Consistency vs your typical take' }));
  }

  function scoreboard(c) {
    var a = c.players[0]; var b = c.players[1];
    return card(c.title, [el('div', { class: 'score' }, [
      el('div', {}, [el('div', { class: 'n', text: String(a.score) }), el('div', { class: 'who', text: a.name + ', ' + a.glove + ' glove' })]),
      el('span', { class: 'hint', text: 'to' }),
      el('div', {}, [el('div', { class: 'n', text: String(b.score) }), el('div', { class: 'who', text: b.name + ', ' + b.glove + ' glove' })])
    ])]);
  }

  function callout(c) { return el('div', { class: 'callout ' + c.tone, role: c.tone === 'correction' ? 'alert' : 'note', text: c.text }); }

  function noteField(c) {
    var id = 'note-' + Math.random().toString(36).slice(2, 7);
    return card(null, [el('label', { for: id, style: 'font-weight:700;font-size:19px', text: c.label }), c.hint ? el('p', { class: 'hint', text: c.hint }) : null, el('textarea', { id: id, rows: '3', placeholder: c.placeholder })]);
  }

  function actionBar(c) {
    function btn(a, kind) {
      var b = el('button', { type: 'button', class: 'btn ' + kind, 'data-command': a.command, text: a.label });
      if (a.disabled) b.disabled = true;
      b.addEventListener('click', function () { console.log('[apprentice] command', a.command); });
      return b;
    }
    return el('div', { class: 'actions' }, [btn(c.primary, 'primary')].concat((c.secondary || []).map(function (a) { return btn(a, 'secondary'); })).concat([c.hint ? el('p', { class: 'hint', style: 'text-align:center', text: c.hint }) : null]));
  }

  var REGISTRY = {
    hand_stage: handStage, step_timeline: stepTimeline, finger_lanes: fingerLanes, metric_row: metricRow,
    checklist: checklist, take_list: takeList, scoreboard: scoreboard, callout: callout, note_field: noteField, action_bar: actionBar
  };

  function renderComponent(c) {
    var fn = REGISTRY[c && c.type];
    var node = fn ? fn(c) : el('div', { class: 'error', text: 'Unknown component: ' + (c && c.type) });
    node.setAttribute('data-component', c && c.type);
    return node;
  }

  function render(spec, root) {
    stageListeners = [];
    document.title = spec.header.title + ' · Apprentice';
    var h = spec.header;
    var left = el('div', {}, [
      h.breadcrumbs && h.breadcrumbs.length ? el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb', text: h.breadcrumbs.join(' / ') }) : null,
      el('h1', { text: h.title }),
      el('p', { class: 'sub', text: spec.skill + ' · ' + h.subtitle })
    ]);
    var right = null;
    if (h.stepper) {
      right = el('ol', { class: 'stepper', 'aria-label': 'Lesson steps' }, h.stepper.steps.map(function (s, i) {
        var li = el('li', {}, [el('span', { class: 'num', text: ROMAN[i] || String(i + 1) }), s]);
        if (i === h.stepper.current) li.setAttribute('aria-current', 'step');
        return li;
      }));
    }
    root.innerHTML = '';
    root.appendChild(el('header', { class: 'head' }, [left, right]));
    root.appendChild(el('div', { class: 'cols' }, [
      el('div', { class: 'col-main' }, spec.main.map(renderComponent)),
      el('div', { class: 'col-side' }, spec.side.map(renderComponent))
    ]));
    root.setAttribute('data-rendered', spec.skill);
  }

  window.ApprenticeRenderer = { render: render, registry: Object.keys(REGISTRY) };

  var name = new URLSearchParams(location.search).get('spec');
  var root = document.getElementById('page');
  if (name) {
    fetch('../specs/' + encodeURIComponent(name) + '.json')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (spec) { render(spec, root); })
      .catch(function (err) { root.appendChild(el('div', { class: 'error', text: 'Could not load spec "' + name + '": ' + err.message })); });
  }
})();
