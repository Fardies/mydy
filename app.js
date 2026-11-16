/* MYDY Homestay: app logic
   Needs firebase-config.js to be loaded first. */

(function(){
  var LOCAL_KEY = 'mydy-bookings-v1';

  var MONTH = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DAY = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var DAY_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  var CANCEL_RE = /❎|❌|✖|✗|✘|\bbatal\b|\bcancel(led)?\b/gi;

  // Earthy paddy-field colours for guests: bg = box, bd = dot, tx = text
  var PALETTE = [
    { bg:'#e3ecd5', bd:'#7fa35f', tx:'#3d5f2a' },
    { bg:'#f5ebc8', bd:'#c9a64b', tx:'#7a5e14' },
    { bg:'#e1ebf0', bd:'#7fa3b8', tx:'#3b6580' },
    { bg:'#f4e1d6', bd:'#c98563', tx:'#8a4527' },
    { bg:'#dcebe6', bd:'#6fa596', tx:'#2f6457' },
    { bg:'#e9e4f0', bd:'#9a8bb8', tx:'#544478' },
    { bg:'#ebebd3', bd:'#a3a35a', tx:'#5e5e22' },
    { bg:'#f3e2e4', bd:'#c48a92', tx:'#87424d' }
  ];

  var VIEWS = ['login', 'home', 'add', 'calendar', 'bookings', 'backup', 'import'];

  // ---- which storage? ----
  var CLOUD = !!(FIREBASE_CONFIG.apiKey && window.firebase);
  var auth = null, db = null, user = null, unsubscribe = null;
  var syncState = CLOUD ? 'connecting' : 'local';

  var allStays = [];   // everything, including deleted ones (so a re-paste won't bring them back)
  var stays = [];      // what the app shows (not deleted)
  var viewY, viewM, selected = null;
  var editingId = null, nights = 1;
  var modalHandlers = {};
  var currentView = 'home';

  // ---------- helpers ----------
  function $(id){ return document.getElementById(id); }
  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function todayDate(){ var n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  function addDays(d, n){ var r = new Date(d); r.setDate(r.getDate() + n); return r; }
  function diffDays(a, b){ return Math.round((b - a) / 86400000); }
  function same(a, b){ return +a === +b; }
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function iso(d){ return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fromIso(s){ var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function fmt(d){ return d.getDate() + ' ' + MONTH[d.getMonth()]; }
  function fmtLong(d){ return DAY[d.getDay()] + ', ' + d.getDate() + ' ' + MONTH_FULL[d.getMonth()] + ' ' + d.getFullYear(); }
  function plural(n, w){ return n + ' ' + w + (n === 1 ? '' : 's'); }
  function lengthLabel(s){ return plural(s.nights, 'night') + ' · ' + (s.nights + 1) + 'D' + s.nights + 'N'; }
  function normName(n){ return String(n).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function newId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function getStay(id){ for (var i = 0; i < stays.length; i++) if (stays[i].id === id) return stays[i]; return null; }
  function overlaps(a, startD, endD){ return a.start < endD && startD < a.end; }
  function nameHTML(s){ return '<span class="cap">' + esc(s.name) + '</span>'; }

  function makeStay(o){
    var start = o.start instanceof Date ? o.start : fromIso(o.start);
    var n = Math.max(1, +o.nights || 1);
    return {
      id: o.id || newId(), name: o.name || '', phone: o.phone || '', note: o.note || '',
      cancelled: !!o.cancelled, nights: n, start: start, end: addDays(start, n),
      norm: normName(o.name || ''), by: o.updatedBy || '', deleted: !!o.deleted
    };
  }
  // plain object that gets saved
  function toData(s){
    return { name: s.name, phone: s.phone || '', note: s.note || '', cancelled: !!s.cancelled,
             nights: s.nights, start: s.start instanceof Date ? iso(s.start) : s.start, deleted: !!s.deleted };
  }

  var toastTimer;
  function toast(text){
    var t = $('toast'); t.textContent = text; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2600);
  }
  function fail(err){ toast('Could not save: ' + (err && err.message ? err.message : 'please try again')); }

  /* =================================================================
     STORAGE: Firebase (shared) or this phone only
     ================================================================= */
  function refresh(){ stays = allStays.filter(function(s){ return !s.deleted; }); }
  function localSave(){
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(allStays.map(function(s){ var d = toData(s); d.id = s.id; return d; }))); } catch(e){}
  }
  function localLoad(){
    try { var raw = localStorage.getItem(LOCAL_KEY); return raw ? JSON.parse(raw).map(makeStay) : []; } catch(e){ return []; }
  }
  function localDone(){ refresh(); localSave(); renderAll(); return Promise.resolve(); }
  function findAny(id){ for (var i = 0; i < allStays.length; i++) if (allStays[i].id === id) return allStays[i]; return null; }
  function stamp(d){
    if (CLOUD){
      d.updatedBy = user ? user.email : '';
      d.updatedAt = firebase.firestore.FieldValue.serverTimestamp();
    }
    return d;
  }
  // change some fields of a booking (local mode)
  function localPatch(id, fields){
    var s = findAny(id); if (!s) return;
    var d = Object.assign(toData(s), fields, { id: id, updatedBy: s.by });
    allStays = allStays.map(function(x){ return x.id === id ? makeStay(d) : x; });
  }

  // add (id = null) or update a booking
  function saveStay(id, s){
    var data = stamp(toData(s));
    if (CLOUD){
      var col = db.collection('bookings');
      return (id ? col.doc(id).set(data) : col.add(data)).catch(fail);
    }
    var fresh = makeStay(Object.assign({}, data, { id: id || newId() }));
    if (id) allStays = allStays.map(function(x){ return x.id === id ? fresh : x; });
    else allStays.push(fresh);
    return localDone();
  }
  function setCancelled(id, value){
    if (CLOUD) return db.collection('bookings').doc(id).update(stamp({ cancelled: value })).catch(fail);
    localPatch(id, { cancelled: value });
    return localDone();
  }
  // "Delete" hides the booking but remembers it, so pasting an old list won't bring it back
  function deleteStay(id){
    if (CLOUD) return db.collection('bookings').doc(id).update(stamp({ deleted: true })).catch(fail);
    localPatch(id, { deleted: true });
    return localDone();
  }
  function addMany(list){
    if (!list.length) return Promise.resolve();
    if (CLOUD){
      var batch = db.batch();
      list.forEach(function(s){ batch.set(db.collection('bookings').doc(), stamp(toData(s))); });
      return batch.commit().catch(fail);
    }
    list.forEach(function(s){ allStays.push(s); });
    return localDone();
  }
  // changes = [{ id, fields }]
  function updateMany(changes){
    if (!changes.length) return Promise.resolve();
    if (CLOUD){
      var batch = db.batch();
      changes.forEach(function(c){ batch.update(db.collection('bookings').doc(c.id), stamp(Object.assign({}, c.fields))); });
      return batch.commit().catch(fail);
    }
    changes.forEach(function(c){ localPatch(c.id, c.fields); });
    return localDone();
  }

  function listen(){
    if (unsubscribe) unsubscribe();
    unsubscribe = db.collection('bookings').onSnapshot({ includeMetadataChanges: true }, function(snap){
      allStays = snap.docs.map(function(doc){ var d = doc.data(); d.id = doc.id; return makeStay(d); });
      refresh();
      syncState = snap.metadata.fromCache ? 'offline' : 'live';
      renderAll();
    }, function(err){
      syncState = 'offline';
      toast('Cannot load bookings: ' + err.message);
      renderSync();
    });
  }

  function renderSync(){
    var el = $('syncLabel');
    if (syncState === 'local'){ el.className = 'sync'; el.textContent = 'Saved on this phone only'; }
    else if (syncState === 'live'){ el.className = 'sync live'; el.textContent = 'Live · shared with family' + (user && user.email === 'test mode' ? ' · TEST MODE (no sign-in)' : ''); }
    else if (syncState === 'offline'){ el.className = 'sync off'; el.textContent = 'Offline · changes will sync later'; }
    else { el.className = 'sync off'; el.textContent = 'Connecting…'; }
  }

  // Each active booking gets its own colour in date order,
  // so guests next to each other never share a colour.
  function assignColors(){
    var list = stays.filter(function(s){ return !s.cancelled; })
                    .sort(function(a, b){ return a.start - b.start; });
    list.forEach(function(s, i){ s.color = PALETTE[i % PALETTE.length]; });
    stays.forEach(function(s){ if (s.cancelled) s.color = null; });
  }
  function dot(s){ return s.color ? '<span class="dot" style="background:' + s.color.bd + '"></span>' : ''; }

  // Who (if anyone) took the dates of a cancelled booking
  function takenBy(s){
    return stays.filter(function(x){ return !x.cancelled && x.id !== s.id && overlaps(x, s.start, s.end); });
  }

  // ---------- pages ----------
  function showView(v){
    if (CLOUD && !user) v = 'login';
    else if (VIEWS.indexOf(v) < 0 || v === 'login') v = 'home';
    currentView = v;
    VIEWS.forEach(function(name){ $('v-' + name).hidden = (name !== v); });
    try { window.scrollTo(0, 0); } catch(e){}
    if (v === 'calendar' || v === 'bookings') renderCalendar();
  }
  function go(v){
    showView(v);
    try { if (location.hash.slice(1) !== v) location.hash = v; } catch(e){}
  }
  window.addEventListener('hashchange', function(){ showView(location.hash.slice(1)); });

  document.addEventListener('click', function(e){
    var b = e.target.closest('[data-go]');
    if (!b) return;
    if (b.getAttribute('data-reset')){ resetForm(); $('fMsg').textContent = ''; }
    go(b.getAttribute('data-go'));
    if (b.getAttribute('data-go') === 'add') setTimeout(function(){ $('fName').focus(); }, 300);
  });

  // ---------- read an old handwritten list ----------
  // Works out the year when the list doesn't say it.
  // 1) Header like "Tetamu bulan 12/2026" -> use that year. If a date's month is
  //    far before the header month (e.g. 1/1 under bulan 12), it's the next year.
  // 2) No header -> pick the year that puts the date closest to today
  //    (in December, "3/1" means January next year).
  function guessYear(day, mon, headY, headM){
    if (headY){
      if (headM - mon > 6) return headY + 1;   // header Dec, line Jan -> next year
      if (mon - headM > 6) return headY - 1;   // header Jan, line Dec -> last year
      return headY;
    }
    var t = todayDate(), best = t.getFullYear(), bestGap = Infinity;
    [t.getFullYear() - 1, t.getFullYear(), t.getFullYear() + 1].forEach(function(y){
      var gap = Math.abs(diffDays(t, new Date(y, mon - 1, day)));
      if (gap < bestGap){ bestGap = gap; best = y; }
    });
    return best;
  }

  function parse(text){
    var headY = null, headM = null;
    var list = [], skipped = [];

    text.split(/\r?\n/).forEach(function(raw){
      var line = raw.trim();
      if (!line) return;
      // header with month + year: "Tetamu bulan 11/2026"
      var h = line.match(/(?:bulan|guests|month)\s*(\d{1,2})\s*[\/\-.]\s*(\d{2,4})/i);
      if (h){ headM = +h[1]; headY = +h[2] < 100 ? 2000 + +h[2] : +h[2]; return; }
      // header with month only: "Tetamu bulan 1" -> year is guessed
      var h2 = line.match(/(?:bulan|guests|month)\s*(\d{1,2})\s*$/i);
      if (h2){ headM = +h2[1]; headY = guessYear(15, headM, null, null); return; }
      var m = line.match(/^(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?(.*)$/);
      if (!m){ skipped.push(line); return; }
      var day = +m[1], mon = +m[2];
      var yr = m[3] ? +m[3] : guessYear(day, mon, headY, headM);
      if (yr < 100) yr += 2000;
      var date = new Date(yr, mon - 1, day);
      if (date.getMonth() !== mon - 1 || date.getDate() !== day){ skipped.push(line); return; }
      var rest = m[4] || '';
      CANCEL_RE.lastIndex = 0;
      var cancelled = CANCEL_RE.test(rest);
      var name = rest.replace(CANCEL_RE, '').replace(/[✅✔☑️]/g, '')
                     .replace(/^[\s.\-:,_~>]+/, '').replace(/[\s.\-:,_~]+$/, '').replace(/\s+/g, ' ').trim();
      if (!name) return;
      var norm = normName(name);
      if (!list.some(function(n){ return same(n.date, date) && n.norm === norm; }))
        list.push({ date: date, name: name, norm: norm, cancelled: cancelled });
    });

    list.sort(function(a, b){ return a.date - b.date; });
    var result = [];
    list.forEach(function(n){
      var s = null;
      for (var i = 0; i < result.length; i++){
        var r = result[i];
        if (r.norm === n.norm && r.cancelled === n.cancelled && same(r.end, n.date)){ s = r; break; }
      }
      if (s){ s.nights++; s.end = addDays(s.end, 1); }
      else result.push(makeStay({ name: n.name, cancelled: n.cancelled, start: n.date, nights: 1 }));
    });
    return { stays: result, skipped: skipped };
  }

  // ---------- list in the old handwritten style (backup) ----------
  function exportText(){
    var rows = [];
    stays.forEach(function(s){
      for (var i = 0; i < s.nights; i++) rows.push({ d: addDays(s.start, i), s: s });
    });
    rows.sort(function(a, b){ return (a.d - b.d) || ((a.s.cancelled ? 1 : 0) - (b.s.cancelled ? 1 : 0)); });
    var out = [], lastKey = '';
    rows.forEach(function(r){
      var k = (r.d.getMonth() + 1) + '/' + r.d.getFullYear();
      if (k !== lastKey){ if (out.length) out.push(''); out.push('Guests ' + k); lastKey = k; }
      out.push(r.d.getDate() + '/' + (r.d.getMonth() + 1) + '.. ' + r.s.name + (r.s.cancelled ? '❎' : ''));
    });
    return out.join('\n');
  }

  // ---------- what happens on a given day ----------
  function dayInfo(d){
    var r = { checkin: [], staying: [], checkout: [], cancelled: [] };
    stays.forEach(function(s){
      var covers = s.start <= d && d < s.end;
      if (s.cancelled){ if (covers) r.cancelled.push(s); return; }
      if (same(s.start, d)) r.checkin.push(s);
      else if (covers) r.staying.push(s);
      if (same(s.end, d)) r.checkout.push(s);
    });
    return r;
  }

  function extra(s){
    var bits = [];
    if (s.phone) bits.push(esc(s.phone));
    if (s.note) bits.push(esc(s.note));
    return bits.length ? '<div class="meta">' + bits.join(' · ') + '</div>' : '';
  }

  // id = booking id; when given, the row can be tapped to edit / cancel / delete
  function row(tag, cls, nameHtml, metaHtml, rowCls, id){
    return '<div class="row' + (rowCls ? ' ' + rowCls : '') + (id ? ' tap" data-id="' + id : '') + '"><span class="tag ' + cls + '">' + tag + '</span>' +
           '<div style="flex:1"><div class="nm">' + nameHtml + '</div>' + (metaHtml || '') + '</div>' +
           (id ? '<svg class="ico rchev"><use href="#i-chev"/></svg>' : '') + '</div>';
  }

  function dayHTML(d){
    var info = dayInfo(d), html = '';
    info.checkout.forEach(function(s){
      html += row('Check-out', 't-out', nameHTML(s), '<div class="meta">Came ' + fmt(s.start) + ' · ' + plural(s.nights, 'night') + '</div>', '', s.id);
    });
    info.checkin.forEach(function(s){
      html += row('Check-in', 't-in', dot(s) + nameHTML(s), '<div class="meta">' + lengthLabel(s) + ' · leaves ' + fmt(s.end) + '</div>' + extra(s), '', s.id);
    });
    info.staying.forEach(function(s){
      var k = diffDays(s.start, d) + 1;
      html += row('Staying', 't-stay', dot(s) + nameHTML(s), '<div class="meta">Night ' + k + ' of ' + s.nights + ' · leaves ' + fmt(s.end) + '</div>' + extra(s), '', s.id);
    });
    var free = !info.checkin.length && !info.staying.length;
    info.cancelled.forEach(function(s){
      html += row('Cancelled', 't-batal', nameHTML(s), '<div class="meta">' + (free ? 'This date is free again' : 'Date taken by another guest') + '</div>', 'batal', s.id);
    });
    if (free) html += row('Free', 't-free', '<span style="font-weight:500">Open for booking</span>', '');
    return html;
  }

  // ---------- HOME ----------
  function renderHome(){
    var t = todayDate(), tm = addDays(t, 1);
    $('todayLabel').textContent = fmtLong(t);
    $('todayDate').textContent = fmt(t);
    $('tomorrowDate').textContent = fmt(tm);
    $('todayCard').innerHTML = dayHTML(t);
    $('tomorrowCard').innerHTML = dayHTML(tm);
    renderSync();

    var a = dayInfo(t), b = dayInfo(tm), html = '';
    function names(list){ return list.map(function(s){ return nameHTML(s); }).join(', '); }
    if (a.checkin.length)
      html += '<div class="notice"><div class="nl">Check-in today</div><div class="nv">' + names(a.checkin) + '</div><div class="ns">' + a.checkin.map(lengthLabel).join(' / ') + '</div></div>';
    if (a.checkout.length)
      html += '<div class="notice out"><div class="nl">Check-out today</div><div class="nv">' + names(a.checkout) + '</div><div class="ns">Get the house ready for the next guest</div></div>';
    if (b.checkin.length)
      html += '<div class="notice"><div class="nl">Check-in tomorrow</div><div class="nv">' + names(b.checkin) + '</div><div class="ns">' + fmtLong(tm) + ' · ' + b.checkin.map(lengthLabel).join(' / ') + '</div></div>';
    if (!html) html = '<div class="notice calm"><div class="nl">All quiet</div><div class="nv">No check-ins or check-outs</div><div class="ns">Today and tomorrow</div></div>';
    $('alertBox').innerHTML = html;

    var ms = monthStats(t.getFullYear(), t.getMonth());
    $('linkCalSub').textContent = MONTH_FULL[t.getMonth()] + ' · ' + ms.booked + ' booked, ' + (ms.daysIn - ms.booked) + ' free';
    var upcoming = stays.filter(function(s){ return !s.cancelled && s.start > t; }).length;
    $('linkListSub').textContent = upcoming + ' upcoming';
  }

  // label on the right of each booking in the list
  function statusPill(s){
    var t = todayDate();
    if (s.cancelled){
      var by = takenBy(s);
      return by.length ? '<span class="pill done">Cancelled · taken by <span class="cap">' + esc(by[0].name.split(' ')[0]) + '</span></span>'
                       : '<span class="pill done">Cancelled · free</span>';
    }
    if (s.end <= t) return '<span class="pill done">Done</span>';
    var gap = diffDays(t, s.start);
    if (gap < 0) return '<span class="pill now">Staying now</span>';
    if (gap === 0) return '<span class="pill today">Today</span>';
    if (gap === 1) return '<span class="pill today">Tomorrow</span>';
    return '<span class="pill">In ' + gap + ' days</span>';
  }

  // ---------- simple month numbers ----------
  function monthStats(y, m){
    var daysIn = new Date(y, m + 1, 0).getDate(), booked = 0;
    for (var d = 1; d <= daysIn; d++){
      var info = dayInfo(new Date(y, m, d));
      if (info.checkin.length || info.staying.length) booked++;
    }
    var starts = stays.filter(function(s){ return s.start.getFullYear() === y && s.start.getMonth() === m; });
    var active = starts.filter(function(s){ return !s.cancelled; }).length;
    return { daysIn: daysIn, booked: booked, pct: Math.round(booked / daysIn * 100), bookings: active, cancelled: starts.length - active };
  }

  // ---------- CALENDAR (+ booking list, same month) ----------
  function renderCalendar(){
    var t = todayDate();
    $('monthTitle').textContent = MONTH_FULL[viewM] + ' ' + viewY;

    var ms = monthStats(viewY, viewM);
    $('monthSummary').innerHTML =
      '<div class="m1"><b>' + ms.booked + '</b> of ' + ms.daysIn + ' nights booked</div>' +
      '<div class="bar"><i style="width:' + ms.pct + '%"></i></div>' +
      '<div class="m2">' + ms.pct + '% full · ' + plural(ms.bookings, 'booking') + ' · ' + ms.cancelled + ' cancelled</div>';

    var first = new Date(viewY, viewM, 1);
    var daysIn = ms.daysIn;
    var html = DAY_SHORT.map(function(h){ return '<div class="dow">' + h + '</div>'; }).join('');
    for (var i = 0; i < first.getDay(); i++) html += '<div class="cell blank"></div>';

    for (var d = 1; d <= daysIn; d++){
      var date = new Date(viewY, viewM, d);
      var info = dayInfo(date);
      var guests = info.checkin.concat(info.staying);
      var cls = 'cell', label = '', style = '', gStyle = '';
      if (guests.length){
        label = guests[0].name.split(' ')[0];
        var c = guests[0].color || PALETTE[0];
        style = ' style="background:' + c.bg + '"';
        gStyle = ' style="color:' + c.tx + '"';
      } else if (info.cancelled.length){
        cls += ' freed'; label = info.cancelled[0].name.split(' ')[0];
      } else {
        cls += ' empty';
      }
      if (same(date, t)) cls += ' today';
      if (selected && same(date, selected)) cls += ' sel';
      html += '<div class="' + cls + '" data-d="' + d + '"' + style + '><div class="n">' + d + '</div><div class="g"' + gStyle + '>' + esc(label) + '</div></div>';
    }
    $('calendar').innerHTML = html;

    if (selected && selected.getMonth() === viewM && selected.getFullYear() === viewY){
      var si = dayInfo(selected);
      var free = !si.checkin.length && !si.staying.length;
      $('selectedDay').innerHTML = '<div class="dayname" style="margin-bottom:4px">' + fmtLong(selected) + '</div>' + dayHTML(selected) +
        (free ? '<button class="btn" id="addOnDay">Add guest on this date</button>' : '');
    } else {
      $('selectedDay').innerHTML = '<div class="tip">Tap a date to see details or add a guest.</div>';
    }
    renderMonthList();
  }

  function renderMonthList(){
    $('listTitle').textContent = MONTH_FULL[viewM] + ' ' + viewY;
    var list = stays.filter(function(s){ return s.start.getMonth() === viewM && s.start.getFullYear() === viewY; })
                    .sort(function(a, b){ return (a.start - b.start) || ((a.cancelled ? 1 : 0) - (b.cancelled ? 1 : 0)); });
    if (!list.length){ $('monthList').innerHTML = '<div class="tip" style="padding:10px 0">No bookings this month.</div>'; return; }
    $('monthList').innerHTML = list.map(function(s){
      return '<div class="item' + (s.cancelled ? ' batal' : '') + '" data-id="' + s.id + '"><div>' +
             '<div class="nm">' + dot(s) + nameHTML(s) + '</div>' +
             '<div class="meta">' + fmt(s.start) + ' → ' + fmt(s.end) + ' · ' + lengthLabel(s) + '</div>' +
             extra(s) + '</div>' + statusPill(s) + '</div>';
    }).join('');
  }

  function renderAll(){
    assignColors();
    renderHome();
    renderCalendar();
    $('exportText').value = exportText();
    updatePreview();
  }

  // ---------- pop-up sheet ----------
  function openModal(html, handlers){
    $('sheet').innerHTML = html;
    modalHandlers = handlers || {};
    $('modal').classList.remove('hidden');
  }
  function closeModal(){ $('modal').classList.add('hidden'); modalHandlers = {}; }
  $('modal').addEventListener('click', function(e){
    if (e.target === $('modal')){ closeModal(); return; }
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var fn = modalHandlers[b.getAttribute('data-act')];
    closeModal();
    if (fn) fn();
  });

  function openActions(id){
    var s = getStay(id); if (!s) return;
    var status = '';
    if (s.cancelled){
      var by = takenBy(s);
      status = '<br><b>Cancelled</b> · ' + (by.length ? 'dates taken by <span class="cap">' + esc(by.map(function(x){ return x.name; }).join(', ')) + '</span>' : 'dates still free');
    }
    var who = s.by ? '<div class="tip" style="margin-top:6px">Last changed by ' + esc(s.by) + '</div>' : '';
    openModal(
      '<h3 class="cap">' + esc(s.name) + '</h3>' +
      '<div class="tip">Check-in ' + fmtLong(s.start) + '<br>Check-out ' + fmtLong(s.end) + '<br>' + lengthLabel(s) + status + '</div>' +
      extra(s) + who +
      '<button class="btn" data-act="edit">Edit</button>' +
      (s.cancelled ? '<button class="btn ghost" data-act="toggle">Restore booking</button>'
                   : '<button class="btn ghost" data-act="toggle">Cancel booking</button>') +
      '<button class="btn danger" data-act="del">Delete</button>' +
      '<button class="btn grey" data-act="close">Close</button>',
      {
        edit: function(){ startEdit(s.id); },
        toggle: function(){
          if (s.cancelled){
            var by = takenBy(s);
            var restore = function(){ setCancelled(s.id, false).then(function(){ toast(s.name + ' restored'); }); };
            if (by.length){
              openModal('<h3>Dates already taken</h3><div class="tip"><span class="cap">' + esc(by.map(function(x){ return x.name + ' (' + fmt(x.start) + ' → ' + fmt(x.end) + ')'; }).join(', ')) +
                '</span> already booked these dates. Restore anyway?</div>' +
                '<button class="btn" data-act="yes">Restore anyway</button><button class="btn grey" data-act="no">No</button>',
                { yes: restore });
              return;
            }
            restore();
          } else {
            setCancelled(s.id, true).then(function(){ toast(s.name + ' cancelled · date is free again'); });
          }
        },
        del: function(){
          openModal('<h3>Delete this booking?</h3><div class="tip"><span class="cap">' + esc(s.name) + '</span>, ' + fmt(s.start) + '. This can\'t be undone.</div>' +
            '<button class="btn danger" data-act="yes">Yes, delete</button><button class="btn grey" data-act="no">No</button>',
            { yes: function(){ deleteStay(s.id).then(function(){ toast('Deleted'); }); } });
        }
      });
  }

  // ---------- add / edit form ----------
  // Set both dates at once: check-in + number of nights
  function setDates(startD, n){
    $('fDate').value = iso(startD);
    $('fOut').value = iso(addDays(startD, Math.max(1, n)));
    syncNights();
  }
  // Work out the nights from the two dates (shown only, not typed)
  function syncNights(){
    var a = $('fDate').value, b = $('fOut').value, box = $('fStay');
    if (a) $('fOut').min = iso(addDays(fromIso(a), 1));
    nights = (a && b) ? diffDays(fromIso(a), fromIso(b)) : 0;
    if (!a || !b){ box.className = 'staylen'; box.innerHTML = '<span>Choose both dates</span>'; }
    else if (nights < 1){ box.className = 'staylen bad'; box.innerHTML = '<b>Check-out must be after check-in</b>'; }
    else { box.className = 'staylen'; box.innerHTML = '<b>' + plural(nights, 'night') + '</b><span>' + (nights + 1) + ' days · ' + (nights + 1) + 'D' + nights + 'N</span>'; }
    updatePreview();
  }

  // active bookings that overlap (cancelled ones never block a date)
  function clashes(startD, n, ignoreId){
    var endD = addDays(startD, n);
    return stays.filter(function(s){ return !s.cancelled && s.id !== ignoreId && overlaps(s, startD, endD); });
  }
  function cancelledOn(startD, n, ignoreId){
    var endD = addDays(startD, n);
    return stays.filter(function(s){ return s.cancelled && s.id !== ignoreId && overlaps(s, startD, endD); });
  }

  function updatePreview(){
    var p = $('fPreview');
    var v = $('fDate').value;
    if (!v || nights < 1){ p.className = 'preview'; p.style.display = 'none'; return; }
    p.style.display = '';
    var startD = fromIso(v), endD = addDays(startD, nights);
    var c = clashes(startD, nights, editingId);
    if (c.length){
      p.className = 'preview warn';
      p.innerHTML = 'Overlaps with <span class="cap">' + c.map(function(s){ return esc(s.name) + ' (' + fmt(s.start) + ' → ' + fmt(s.end) + ')'; }).join(', ') + '</span>';
      return;
    }
    // no clash: only show a note if a cancelled guest had these dates
    var cx = cancelledOn(startD, nights, editingId);
    if (cx.length){
      p.className = 'preview';
      p.innerHTML = '<span class="cap">' + esc(cx.map(function(s){ return s.name; }).join(', ')) + '</span> cancelled these dates, so they\'re free to book.';
    } else {
      p.style.display = 'none';
    }
  }

  function resetForm(){
    editingId = null;
    $('formTitle').textContent = 'Add guest';
    $('fSave').textContent = 'Save';
    $('fCancel').style.display = 'none';
    $('fName').value = ''; $('fPhone').value = ''; $('fNote').value = '';
    setDates(todayDate(), 1);
  }

  function startEdit(id){
    var s = getStay(id); if (!s) return;
    editingId = id;
    $('formTitle').textContent = 'Edit booking';
    $('fSave').textContent = 'Save changes';
    $('fCancel').style.display = 'block';
    $('fName').value = s.name; $('fPhone').value = s.phone; $('fNote').value = s.note;
    setDates(s.start, s.nights);
    $('fMsg').textContent = '';
    go('add');
  }

  function commitForm(){
    var name = $('fName').value.replace(/\s+/g, ' ').trim();
    var startD = fromIso($('fDate').value);
    var wasEditing = !!editingId;
    var old = wasEditing ? getStay(editingId) : null;
    var s = { name: name, start: startD, nights: nights, phone: $('fPhone').value.trim(), note: $('fNote').value.trim(),
              cancelled: old ? old.cancelled : false };
    var n = nights;
    $('fSave').disabled = true;
    saveStay(editingId, s).then(function(){
      $('fSave').disabled = false;
      viewY = startD.getFullYear(); viewM = startD.getMonth(); selected = startD;
      toast('Saved · ' + name + ', ' + fmt(startD) + ', ' + plural(n, 'night'));
      resetForm();
      if (wasEditing){ go('bookings'); return; }
      $('fMsg').className = 'msg ok';
      $('fMsg').textContent = name + ' saved. You can add another guest.';
    });
  }

  $('fSave').addEventListener('click', function(){
    var msg = $('fMsg');
    msg.className = 'msg warn';
    if (!$('fName').value.trim()){ msg.textContent = 'Please enter the guest\'s name.'; $('fName').focus(); return; }
    if (!$('fDate').value){ msg.textContent = 'Please choose a check-in date.'; return; }
    if (!$('fOut').value){ msg.textContent = 'Please choose a check-out date.'; return; }
    if (nights < 1){ msg.textContent = 'Check-out must be after check-in.'; return; }
    msg.textContent = '';
    var c = clashes(fromIso($('fDate').value), nights, editingId);
    if (c.length){
      openModal('<h3>Dates overlap</h3><div class="tip">Already booked: <span class="cap">' +
        c.map(function(s){ return '<b>' + esc(s.name) + '</b> (' + fmt(s.start) + ' → ' + fmt(s.end) + ')'; }).join(', ') +
        '</span></div><button class="btn" data-act="yes">Save anyway</button><button class="btn grey" data-act="no">Go back</button>',
        { yes: commitForm });
      return;
    }
    commitForm();
  });
  $('fCancel').addEventListener('click', function(){ resetForm(); $('fMsg').textContent = ''; go('bookings'); });
  // when check-in changes, keep the same length of stay (or 1 night)
  var lastNights = 1;
  function onCheckIn(){
    var a = $('fDate').value; if (!a) { syncNights(); return; }
    var b = $('fOut').value;
    if (!b || fromIso(b) <= fromIso(a)) $('fOut').value = iso(addDays(fromIso(a), Math.max(1, lastNights)));
    syncNights();
  }
  function onCheckOut(){ syncNights(); if (nights >= 1) lastNights = nights; }
  $('fDate').addEventListener('change', onCheckIn);
  $('fDate').addEventListener('input', onCheckIn);
  $('fOut').addEventListener('change', onCheckOut);
  $('fOut').addEventListener('input', onCheckOut);

  // ---------- calendar + list buttons ----------
  function prevMonth(){ viewM--; if (viewM < 0){ viewM = 11; viewY--; } renderCalendar(); }
  function nextMonth(){ viewM++; if (viewM > 11){ viewM = 0; viewY++; } renderCalendar(); }
  $('prevMonth').addEventListener('click', prevMonth);
  $('nextMonth').addEventListener('click', nextMonth);
  $('listPrev').addEventListener('click', prevMonth);
  $('listNext').addEventListener('click', nextMonth);

  $('calendar').addEventListener('click', function(e){
    var cell = e.target.closest('.cell[data-d]');
    if (!cell) return;
    selected = new Date(viewY, viewM, +cell.getAttribute('data-d'));
    renderCalendar();
    try { $('selectedDay').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch(err){}
  });

  function tapRow(e){
    var r = e.target.closest('[data-id]');
    if (r) openActions(r.getAttribute('data-id'));
  }
  $('selectedDay').addEventListener('click', function(e){
    if (e.target.id === 'addOnDay' && selected){
      resetForm();
      setDates(selected, 1);
      $('fMsg').textContent = '';
      go('add');
      setTimeout(function(){ $('fName').focus(); }, 300);
      return;
    }
    tapRow(e);
  });
  $('todayCard').addEventListener('click', tapRow);
  $('tomorrowCard').addEventListener('click', tapRow);
  $('monthList').addEventListener('click', tapRow);

  // ---------- backup + import ----------
  $('copyBtn').addEventListener('click', function(){
    var text = $('exportText').value;
    try {
      navigator.clipboard.writeText(text).then(function(){ toast('List copied'); },
        function(){ $('exportText').select(); toast('Press and hold the list to copy'); });
    } catch(e){ $('exportText').select(); toast('Press and hold the list to copy'); }
  });

  /* Smart paste: compares the pasted list with what's saved.
     - same booking again        -> skipped quietly
     - same guest, more nights   -> stay is made longer
     - same guest, now has ❎     -> booking is cancelled
     - new guest on a free date  -> added
     - new guest on a date that already has a guest -> skipped (shown in a small "show" list)
     - booking deleted in the app -> stays deleted
     Nothing is ever shortened or un-cancelled by a paste. */
  function planImport(parsed){
    // working copy, so changes in this paste are seen by later lines
    var work = allStays.map(function(s){ return { ref: s, start: s.start, end: s.end, cancelled: s.cancelled, deleted: s.deleted, norm: s.norm }; });
    var plan = { add: [], update: [], same: 0, busy: [] };
    var changed = {};   // id -> { fields, labels[] }

    parsed.slice().sort(function(a, b){ return a.start - b.start; }).forEach(function(p){
      // same guest, overlapping or right next to the pasted nights
      var matches = work.filter(function(w){ return w.norm === p.norm && w.start <= p.end && p.start <= w.end; });
      matches.sort(function(a, b){ return (a.deleted ? 1 : 0) - (b.deleted ? 1 : 0); });
      var w = matches[0];

      if (w){
        if (w.deleted){ plan.same++; return; }                       // deleted on purpose
        var id = w.ref.id, c = changed[id] || (changed[id] = { fields: {}, labels: [] });
        if (p.cancelled){
          if (!w.cancelled && p.start <= w.start && p.end >= w.end){  // whole stay now has ❎
            w.cancelled = true; c.fields.cancelled = true; c.labels.push('cancelled');
          } else plan.same++;
          return;
        }
        if (w.cancelled){ plan.same++; return; }                    // never un-cancel from a paste
        var ns = p.start < w.start ? p.start : w.start;
        var ne = p.end > w.end ? p.end : w.end;
        if (+ns !== +w.start || +ne !== +w.end){
          var before = diffDays(w.start, w.end), after = diffDays(ns, ne);
          w.start = ns; w.end = ne;
          c.fields.start = iso(ns); c.fields.nights = after;
          c.labels = c.labels.filter(function(l){ return l.indexOf('night') < 0; });
          c.labels.push(plural(before, 'night').replace(/ nights?/, '') + ' → ' + plural(after, 'night'));
        } else plan.same++;
        return;
      }

      // a different guest already has (some of) these nights
      if (!p.cancelled && work.some(function(x){ return !x.deleted && !x.cancelled && x.start < p.end && p.start < x.end; })){
        plan.busy.push(p); return;
      }
      plan.add.push(p);
      work.push({ ref: p, start: p.start, end: p.end, cancelled: p.cancelled, deleted: false, norm: p.norm });
    });

    Object.keys(changed).forEach(function(id){
      if (changed[id].labels.length) plan.update.push({ id: id, fields: changed[id].fields, labels: changed[id].labels });
    });
    return plan;
  }

  $('saveBtn').addEventListener('click', function(){
    var res = parse($('input').value);
    var plan = planImport(res.stays);
    $('saveBtn').disabled = true;

    Promise.all([addMany(plan.add), updateMany(plan.update.map(function(u){ return { id: u.id, fields: u.fields }; }))]).then(function(){
      $('saveBtn').disabled = false;
      var el = $('saveMsg'), html = '';
      var parts = [];
      if (plan.add.length) parts.push(plan.add.length + ' new');
      if (plan.update.length) parts.push(plan.update.length + ' updated');
      if (plan.same) parts.push(plan.same + ' already saved');

      if (!plan.add.length && !plan.update.length){
        html = '<div class="msg ok">Nothing new. Everything is already saved.</div>';
      } else {
        html = '<div class="msg ok">Done · ' + parts.join(' · ') + '</div><div class="tip" style="margin-top:6px">';
        plan.add.slice().sort(function(a, b){ return a.start - b.start; }).forEach(function(s){
          html += '+ ' + fmt(s.start) + ' ' + s.start.getFullYear() + ' · <span class="cap">' + esc(s.name) + '</span> · ' + plural(s.nights, 'night') + (s.cancelled ? ' (cancelled)' : '') + '<br>';
        });
        plan.update.forEach(function(u){
          var st = getStay(u.id);
          html += '✎ <span class="cap">' + esc(st ? st.name : '') + '</span>' + (st ? ' (' + fmt(st.start) + ')' : '') + ': ' + u.labels.join(', ') + '<br>';
        });
        html += 'Wrong date? Tap the booking in Bookings and choose Edit.</div>';
      }
      if (plan.busy.length){
        html += '<details style="margin-top:10px"><summary class="tip" style="cursor:pointer">' + plural(plan.busy.length, 'line') + ' skipped: date already has a guest</summary><div class="tip" style="margin-top:4px">' +
          plan.busy.map(function(s){ return fmt(s.start) + ' · <span class="cap">' + esc(s.name) + '</span>'; }).join('<br>') +
          '<br>If this guest is real, add them with Add guest.</div></details>';
      }
      if (res.skipped.length)
        html += '<div class="msg warn">These lines couldn\'t be read (check the date):<br>' + res.skipped.map(esc).join('<br>') + '</div>';
      el.className = '';
      el.innerHTML = html;
      $('input').value = '';
    });
  });

  // ---------- sign in / out ----------
  $('lBtn').addEventListener('click', function(){
    var email = $('lEmail').value.trim(), pass = $('lPass').value;
    $('lMsg').textContent = '';
    if (!email || !pass){ $('lMsg').textContent = 'Please enter your email and password.'; return; }
    $('lBtn').disabled = true;
    auth.signInWithEmailAndPassword(email, pass).catch(function(){
      $('lMsg').textContent = 'Wrong email or password.';
    }).then(function(){ $('lBtn').disabled = false; });
  });
  $('lPass').addEventListener('keydown', function(e){ if (e.key === 'Enter') $('lBtn').click(); });
  $('signOutBtn').addEventListener('click', function(){ if (auth) auth.signOut(); });

  document.addEventListener('visibilitychange', function(){ if (!document.hidden) renderAll(); });

  // ---------- start ----------
  var t = todayDate();
  viewY = t.getFullYear(); viewM = t.getMonth();
  resetForm();

  function startHash(){ try { return location.hash.slice(1); } catch(e){ return ''; } }

  if (CLOUD){
    firebase.initializeApp(FIREBASE_CONFIG);
    auth = firebase.auth();
    db = firebase.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(function(){}); // works offline too

    // TEST MODE: REQUIRE_SIGN_IN = false in firebase-config.js -> no sign-in page
    if (typeof REQUIRE_SIGN_IN !== 'undefined' && REQUIRE_SIGN_IN === false){
      user = { email: 'test mode' };
      $('signOutBtn').hidden = true;
      listen();
      renderAll();
      showView(startHash());
      return;
    }

    auth.onAuthStateChanged(function(u){
      user = u;
      if (u){
        $('signOutBtn').hidden = false;
        $('signOutBtn').textContent = 'Signed in as ' + u.email + ' · Sign out';
        listen();
        showView(startHash());
      } else {
        if (unsubscribe){ unsubscribe(); unsubscribe = null; }
        allStays = []; stays = [];
        $('signOutBtn').hidden = true;
        showView('login');
      }
      renderAll();
    });
  } else {
    allStays = localLoad();
    refresh();
    renderAll();
    showView(startHash());
  }
})();