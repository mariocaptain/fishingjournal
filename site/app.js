// ====== Config màu & helpers ======
const COLORS = {
  weekdayBadge: {
    0: { fg: '#8bd5ff', bg: '#4a2b20' }, // Sun (badge có nền riêng cho weekend)
    1: { fg: '#8dd3ff', bg: '#223b4b' }, // Mon
    2: { fg: '#9cffd5', bg: '#203b2e' }, // Tue
    3: { fg: '#c3a6ff', bg: '#2a2742' }, // Wed
    4: { fg: '#ffd39c', bg: '#463825' }, // Thu
    5: { fg: '#ff9ccf', bg: '#422535' }, // Fri
    6: { fg: '#8bd5ff', bg: '#4a2b20' }  // Sat
  },
  weekendHeaderBg: '#7a2b1d',      // nền rõ ràng cho Sat/Sun (header bar)
  weekdayHeaderBg: '#223447',      // nền header chung cho Mon–Fri
  lunarBadge: { fg: '#ffffff', bg: '#c23b3b' },
  headerText: '#cfe8ff',
  cyan: '#89e0ff',
  gridBorder: '#1a1f28',
  cardBg: '#13191f',
  tide: '#87c7ff',
  pressure: '#f0b08a',
  hydro: {
    sea: '#87e4ff',
    watert: '#ffd479',
    wind: '#8bffb0',
    winddir: '#aab4ff',
    wave: '#ffb3a1'
  }
};

const MEANS = {
  sea_level: 0.74,
  water_temp: 27.16,
  wind_speed: 3.48,
  wave_height: 1.11
};

const dpr = Math.max(1, window.devicePixelRatio || 1);

function parseVNDate(ddmmyyyy) {
  const [d,m,y] = ddmmyyyy.split('/').map(Number);
  return new Date(y, m - 1, d);
}
function fmtNum(x, unit='') {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return (Math.round(x * 100) / 100) + unit;
}
function isForecastDay(vnDate) {
  const d = parseVNDate(vnDate);
  const today = new Date();
  today.setHours(0,0,0,0);
  return d.getTime() >= today.getTime(); // hôm nay trở đi là forecast label
}

// ====== Auth (đơn giản, như trước) ======
function ensureAuth() {
  const token = sessionStorage.getItem('fj_auth');
  if (token === 'ok') {
    document.getElementById('login').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    return true;
  }
  document.getElementById('login').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
  return false;
}
function bindLogin() {
  const f = document.getElementById('login-form');
  if (!f) return;
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const u = (document.getElementById('username').value || '').trim();
    const p = (document.getElementById('password').value || '').trim();
    // Bạn đang dùng user/pass tùy ý local – hợp lệ khi cả hai đều không rỗng
    if (u && p) {
      sessionStorage.setItem('fj_auth','ok');
      ensureAuth();
      init(); // render ngay
    } else {
      alert('Please enter username & password');
    }
  });
}

// ====== Canvas utils (chống nhòe) ======
function prepHiDPICanvas(canvas, cssW, cssH) {
  // set attribute (pixel) khớp DPR, set style (CSS) đúng kích thước mong muốn
  canvas.width  = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale ngược để vẽ theo toạ độ CSS
  ctx.clearRect(0,0,cssW,cssH);
  ctx.imageSmoothingEnabled = true;
  return ctx;
}

// ====== Vẽ đồ thị đơn giản ======
function drawLineChart(canvas, series, {height=150, color='#fff', axisColor='#7aa2f7', minY=null, maxY=null}) {
  const w = canvas.clientWidth || canvas.parentElement.clientWidth || 300;
  const ctx = prepHiDPICanvas(canvas, w, height);

  // padding
  const padL = 30, padR = 10, padT = 8, padB = 22;
  const plotW = w - padL - padR;
  const plotH = height - padT - padB;

  // trục
  ctx.strokeStyle = COLORS.gridBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(padL, padT, plotW, plotH);

  if (!series || series.length === 0) return;

  const xs = series.map(p => p.x);
  const ys = series.map(p => p.y);

  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  let yMin = (minY==null) ? Math.min(...ys) : minY;
  let yMax = (maxY==null) ? Math.max(...ys) : maxY;
  if (yMin === yMax) { yMin -= 1; yMax += 1; }

  // Trục X nhãn giờ
  ctx.fillStyle = axisColor;
  ctx.font = '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto';
  ctx.textBaseline = 'top';
  const hours = [0,3,6,9,12,15,18,21,24];
  hours.forEach(h=>{
    const x = padL + ((h - xMin) / (xMax - xMin)) * plotW;
    ctx.fillText((h%24).toString().padStart(2,'0') + ':00', x-14, height-18);
  });

  // Vẽ line
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  series.forEach((p,i)=>{
    const x = padL + ((p.x - xMin) / (xMax - xMin)) * plotW;
    const y = padT + (1 - (p.y - yMin) / (yMax - yMin)) * plotH;
    if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
  });
  ctx.stroke();
}

// ====== Render 1 cell ======
function weekdayBadgeEl(date, vnDate, lunarDDMM) {
  const wd = date.getDay(); // 0..6
  const scheme = COLORS.weekdayBadge[wd];
  const el = document.createElement('div');
  el.className = 'cell-header';
  el.style.background = (wd===0||wd===6) ? COLORS.weekendHeaderBg : COLORS.weekdayHeaderBg;

  const left = document.createElement('div');
  left.className = 'left';

  const wSpan = document.createElement('span');
  wSpan.className = 'weekday';
  wSpan.textContent = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][wd];
  wSpan.style.color = scheme.fg;
  wSpan.style.background = scheme.bg;

  const gDate = document.createElement('span');
  gDate.className = 'gdate';
  gDate.textContent = vnDate;
  gDate.style.color = COLORS.cyan;

  const lBadge = document.createElement('span');
  lBadge.className = 'lunar';
  lBadge.textContent = lunarDDMM;
  lBadge.style.color = COLORS.lunarBadge.fg;
  lBadge.style.background = COLORS.lunarBadge.bg;

  left.appendChild(wSpan);
  left.appendChild(gDate);
  left.appendChild(lBadge);

  const right = document.createElement('div');
  right.className = 'right';

  if (isForecastDay(vnDate)) {
    const f = document.createElement('span');
    f.className = 'forecast';
    f.textContent = 'Forecast';
    right.appendChild(f);
  }

  el.appendChild(left);
  el.appendChild(right);
  return el;
}

function renderCell(day) {
  const vnDate = day.vietnam_date;
  const date = parseVNDate(vnDate);
  const lunar = day.lunar_date;

  const card = document.createElement('div');
  card.className = 'cell';

  // Header
  card.appendChild(weekdayBadgeEl(date, vnDate, lunar));

  // Chart area
  const wrap = document.createElement('div');
  wrap.className = 'charts';

  // Tide (chuyển time → giờ, height)
  const tide = (day.tidal_data||[]).map(t=>{
    const hh = new Date(t.time).getHours();
    return {x: hh, y: Number(t.height)};
  });
  const tideCanvas = document.createElement('canvas');
  tideCanvas.className = 'chart';
  wrap.appendChild(tideCanvas);
  drawLineChart(tideCanvas, tide, {height: 150, color: COLORS.tide, axisColor:'#88ddff'});

  // Pressure (time → giờ, pressure hPa)
  const pres = (day.pressure_data||[]).map(p=>{
    const hh = new Date(p.time).getHours();
    return {x: hh, y: Number(p.pressure)};
  });
  const presCanvas = document.createElement('canvas');
  presCanvas.className = 'chart small';
  wrap.appendChild(presCanvas);
  drawLineChart(presCanvas, pres, {height: 120, color: COLORS.pressure, axisColor:'#ffccaa'});

  // Hydro text
  const sea = Number(day.sea_level ?? 0) || 0;
  const wtemp = Number(day.water_temperature ?? 0) || 0;
  const wspd = Number(day.wind_speed ?? 0) || 0;
  const wdir = Number(day.wind_direction ?? 0) || 0;
  const wave = Number(day.wave_height ?? 0) || 0;

  const hydro = document.createElement('div');
  hydro.className = 'hydro';
  hydro.innerHTML =
    `<span style="color:${COLORS.hydro.sea}">Sea Level: ${fmtNum(sea,'m')} # ${MEANS.sea_level}m</span>
     <span style="color:${COLORS.hydro.watert}">Water Temp: ${fmtNum(wtemp,'°C')} # ${MEANS.water_temp}°C</span>
     <span style="color:${COLORS.hydro.wind}">Wind Speed: ${fmtNum(wspd,' m/s')} # ${MEANS.wind_speed} m/s</span>
     <span style="color:${COLORS.hydro.winddir}">Wind Dir: ${fmtNum(wdir,'°')}</span>
     <span style="color:${COLORS.hydro.wave}">Wave: ${fmtNum(wave,'m')} # ${MEANS.wave_height}m</span>`;

  card.appendChild(wrap);
  card.appendChild(hydro);
  return card;
}

// ====== Dedupe & phân trang ======
function dedupeDays(days) {
  // Nếu data.json (lịch sử build cũ) có ngày trùng nhau → giữ 1 bản
  const map = new Map();
  for (const d of days) {
    const key = d.vietnam_date;
    if (!map.has(key)) map.set(key, d);
    else {
      // ưu tiên record có nhiều điểm hơn
      const a = map.get(key);
      const scoreA = (a.tidal_data?.length||0) + (a.pressure_data?.length||0);
      const scoreB = (d.tidal_data?.length||0) + (d.pressure_data?.length||0);
      if (scoreB > scoreA) map.set(key, d);
    }
  }
  return Array.from(map.values()).sort((a,b)=>{
    return parseVNDate(a.vietnam_date) - parseVNDate(b.vietnam_date);
  });
}

function paginate(days, page, pageSize=10) {
  const total = days.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const p = Math.min(Math.max(1, page), pages);
  const start = (p-1)*pageSize;
  return {
    page: p,
    pages,
    total,
    slice: days.slice(start, start+pageSize)
  };
}

// ====== Render chính ======
async function init() {
  if (!ensureAuth()) return;

  const res = await fetch('./data.json', {cache:'no-store'});
  const payload = await res.json();
  if (payload.error) {
    document.getElementById('grid').innerHTML =
      `<pre class="error">${payload.error}</pre>`;
    return;
  }

  // map lại structure nếu trường tên khác
  const daysRaw = (payload.days || payload) // nếu để thẳng là mảng
    .map(d => ({
      vietnam_date: d.vietnam_date || d['Vietnam Date'],
      lunar_date:   d.lunar_date   || d['Lunar Date'],
      tidal_data:   d.tidal_data   || d['Tidal Data'] || [],
      pressure_data:d.pressure_data|| d['Pressure Data'] || [],
      sea_level:    d.sea_level    || d['Sea Level'] || 0,
      water_temperature: d.water_temperature || d['Water Temperature'] || 0,
      wind_speed:   d.wind_speed   || d['Wind Speed'] || 0,
      wind_direction:d.wind_direction|| d['Wind Direction'] || 0,
      wave_height:  d.wave_height  || d['Wave Height'] || 0
    }));

  const days = dedupeDays(daysRaw);

  // điều hướng đơn giản bằng hash ?page=
  const params = new URLSearchParams(location.search);
  let page = Number(params.get('page') || '1');

  const nav = document.getElementById('nav');
  function renderPage(p) {
    const {page:cur, pages, total, slice} = paginate(days, p, 10);
    page = cur;

    // header nav
    nav.querySelector('.counter').textContent = `Trang ${cur} / ${pages} • Tổng ngày: ${total}`;
    const btnPrev = nav.querySelector('.prev');
    const btnNext = nav.querySelector('.next');
    btnPrev.disabled = cur<=1;
    btnNext.disabled = cur>=pages;
    btnPrev.onclick = ()=>{ renderPage(cur-1); };
    btnNext.onclick = ()=>{ renderPage(cur+1); };

    // grid
    const grid = document.getElementById('grid');
    grid.innerHTML = '';
    slice.forEach(d => grid.appendChild(renderCell(d)));

    // scroll to top mỗi lần đổi trang
    window.scrollTo({top:0, behavior:'instant'});
    history.replaceState(null,'',`?page=${cur}`);
  }

  renderPage(page);
}

// ====== Khởi chạy ======
document.addEventListener('DOMContentLoaded', () => {
  bindLogin();
  ensureAuth() && init();
});
