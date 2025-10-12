/* ===== Login demo (có thể thay bằng auth thật) ===== */
const VALID_USER = "danang";
const VALID_PASS = "lap-an-123";

const elLogin = document.getElementById("login");
const elApp   = document.getElementById("app");
document.getElementById("btnLogin").onclick = () => {
  const u = document.getElementById("user").value.trim();
  const p = document.getElementById("pass").value;
  if (u === VALID_USER && p === VALID_PASS) {
    elLogin.classList.add("hidden");
    elApp.classList.remove("hidden");
    init();
  } else alert("Sai thông tin!");
};

/* ===== Paging & constants ===== */
const PAGE_SIZE = 10;   // 2 cột x 5 hàng
const TIDE_H = 150;
const PRES_H = 120;
let ALL = [];
let page = 0;

/* ===== Utils ===== */
function wdNameShort(dstr){ // dd/MM/yyyy -> Mon/Tue/...
  const [dd,MM,yyyy] = dstr.split("/").map(Number);
  const d = new Date(yyyy,MM-1,dd);
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
}
function toHM(iso){
  const d = new Date(iso);
  return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}
function num(v){
  const f = Number(v);
  return Number.isFinite(f) ? f : null;
}

/* ===== Canvas mini chart (thuần JS, không cần Chart.js) ===== */
function drawLine(canvas, points, opts){
  const ctx = canvas.getContext("2d");
  const W = canvas.width = canvas.clientWidth;
  const H = canvas.height = canvas.clientHeight;
  ctx.clearRect(0,0,W,H);

  // khung
  ctx.strokeStyle = "#2a2f36";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5,0.5,W-1,H-1);

  if (!points.length) return;

  // scale
  const xs = points.map(p=>p.x.getTime());
  const ys = points.map(p=>p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const padL=36, padB=18, padR=8, padT=8;
  const SX = (x)=> padL + ( (x - xMin) / (xMax - xMin || 1) ) * (W - padL - padR);
  const SY = (y)=> H - padB - ( (y - yMin) / (yMax - yMin || 1) ) * (H - padT - padB);

  // trục Y (nhãn cam)
  ctx.fillStyle = "#ce9178";
  ctx.font = "10px ui-monospace, monospace";
  const y0 = yMin, y1 = yMax, yMid = (y0+y1)/2;
  [y0,yMid,y1].forEach(val=>{
    const yy = SY(val); 
    ctx.beginPath(); ctx.moveTo(padL-4,yy); ctx.lineTo(W-padR,yy); ctx.strokeStyle="#1b2229"; ctx.stroke();
    ctx.fillText(val.toFixed(2), 4, yy+3);
  });

  // trục X (nhãn cyan)
  ctx.fillStyle = "#9cdcfe";
  points.forEach((p,i)=>{
    if (i%Math.ceil(points.length/6)===0){
      const xx = SX(p.x.getTime());
      ctx.fillText(p.label || toHM(p.x), xx-12, H-5);
    }
  });

  // đường
  ctx.strokeStyle = opts?.stroke || "#58a6ff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  points.forEach((p,i)=>{
    const xx = SX(p.x.getTime()), yy = SY(p.y);
    if (i===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
  });
  ctx.stroke();
}

/* ===== Render ===== */
async function init(){
  const grid = document.getElementById("grid");
  const pageInfo = document.getElementById("pageInfo");

  try{
    const r = await fetch("./data.json", {cache:"no-store"});
    const j = await r.json();

    if (j.error){
      grid.innerHTML = `<div class="card"><pre>${j.error}</pre></div>`;
      pageInfo.textContent = "";
      return;
    }

    // j.days đã gồm history + forecast (đã sort)
    ALL = Array.isArray(j.days)? j.days : [];
    const last = Math.max(0, Math.ceil(ALL.length/PAGE_SIZE)-1);
    page = last;

    // nút điều hướng
    document.getElementById("prev").onclick = ()=>{ page=Math.max(0,page-1); render(); };
    document.getElementById("next").onclick = ()=>{ page=Math.min(last,page+1); render(); };

    render();
  }catch(e){
    grid.innerHTML = `<div class="card"><pre>${String(e)}</pre></div>`;
  }
}

function render(){
  const grid = document.getElementById("grid");
  const pageInfo = document.getElementById("pageInfo");

  const maxPage = Math.max(0, Math.ceil(ALL.length/PAGE_SIZE)-1);
  const start = page*PAGE_SIZE;
  const slice = ALL.slice(start, start+PAGE_SIZE);

  grid.innerHTML = "";
  pageInfo.textContent = `Trang ${page+1} / ${maxPage+1} • Tổng ngày: ${ALL.length}`;

  slice.forEach(d=>{
    const card = document.createElement("div");
    card.className = "card";

    // tiêu đề ngày
    const wd = wdNameShort(d.vietnam_date);
    const title = document.createElement("div");
    title.className = `title day-${wd.toLowerCase()} ${/Sun|Sat/.test(wd)?"is-weekend":""}`;
    title.innerHTML = `
      <span class="wd">${wd}</span>
      <span class="greg">${d.vietnam_date}</span>
      <span class="lunar">${d.lunar_date}</span>
      ${d.is_forecast?'<span class="forecast-tag">Forecast</span>':''}
    `;
    card.appendChild(title);

    // canvas tide
    const c1wrap = document.createElement("div"); c1wrap.className="canvas-wrap tide";
    const c1 = document.createElement("canvas"); c1.style.height = TIDE_H+"px"; c1wrap.appendChild(c1);
    card.appendChild(c1wrap);

    // dữ liệu thủy triều
    const pts1 = (d.tidal_data||[])
      .map(x => ({ x:new Date(x.time), y:num(x.height), label: toHM(x.time) }))
      .filter(p => p.y!==null);
    drawLine(c1, pts1, {stroke:"#79c0ff"});

    // canvas pressure
    const c2wrap = document.createElement("div"); c2wrap.className="canvas-wrap pressure";
    const c2 = document.createElement("canvas"); c2.style.height = PRES_H+"px"; c2wrap.appendChild(c2);
    card.appendChild(c2wrap);

    const pts2 = (d.pressure_data||[])
      .sort((a,b)=> new Date(a.time)-new Date(b.time))
      .map(x => ({ x:new Date(x.time), y:num(x.pressure), label: toHM(x.time) }))
      .filter(p => p.y!==null);
    drawLine(c2, pts2, {stroke:"#d2a8ff"});

    grid.appendChild(card);
  });
}
