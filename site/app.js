/* ===== Login demo ===== */
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

/* ===== Paging & consts ===== */
const PAGE_SIZE = 10;          // 2 cột x 5 hàng
const TIDE_H = 150;
const PRES_H = 120;
let ALL = [];
let page = 0;

/* ===== Utils ===== */
function wdNameShort(dstr){
  const [dd,MM,yyyy] = dstr.split("/").map(Number);
  const d = new Date(yyyy,MM-1,dd);
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
}
function toHM(iso){
  const d = new Date(iso);
  return d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
}
const num = v => Number.isFinite(+v) ? +v : null;

/* ===== Tiny canvas line chart (no lib) ===== */
function drawLine(canvas, points, opts){
  const wrap = canvas.parentElement;               // <- lấy kích thước từ wrapper
  const W = canvas.width  = Math.max(10, wrap.clientWidth);
  const H = canvas.height = Math.max(10, wrap.clientHeight);
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,W,H);

  // khung
  ctx.strokeStyle = "#2a2f36"; ctx.lineWidth = 1;
  ctx.strokeRect(0.5,0.5,W-1,H-1);

  if (!points.length) return;

  // scale
  const xs = points.map(p=>p.x.getTime());
  const ys = points.map(p=>p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const padL=36, padB=18, padR=8, padT=8;
  const SX = (x)=> padL + ((x-xMin)/(xMax-xMin||1))*(W-padL-padR);
  const SY = (y)=> H - padB - ((y-yMin)/(yMax-yMin||1))*(H-padT-padB);

  // trục Y (nhãn cam)
  ctx.fillStyle = "#ce9178"; ctx.font = "10px ui-monospace, monospace";
  const y0=yMin, y1=yMax, yMid=(y0+y1)/2;
  [y0,yMid,y1].forEach(v=>{
    const yy=SY(v);
    ctx.beginPath(); ctx.moveTo(padL-4,yy); ctx.lineTo(W-padR,yy); ctx.strokeStyle="#1b2229"; ctx.stroke();
    ctx.fillText(v.toFixed(2), 4, yy+3);
  });

  // trục X (nhãn cyan)
  ctx.fillStyle = "#9cdcfe";
  const step = Math.max(1, Math.ceil(points.length/6));
  points.forEach((p,i)=>{
    if (i%step===0){ const xx=SX(p.x.getTime()); ctx.fillText(p.label||toHM(p.x), xx-12, H-5); }
  });

  // đường
  ctx.strokeStyle = (opts && opts.stroke) || "#58a6ff";
  ctx.lineWidth = 1.5; ctx.beginPath();
  points.forEach((p,i)=>{ const xx=SX(p.x.getTime()), yy=SY(p.y); i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy); });
  ctx.stroke();
}

/* ===== Render ===== */
async function init(){
  const grid = document.getElementById("grid");
  const pageInfo = document.getElementById("pageInfo");

  try{
    const r = await fetch("./data.json", {cache:"no-store"});
    const j = await r.json();

    if (j && j.error){
      grid.innerHTML = `<div class="card"><pre>${j.error}</pre></div>`;
      pageInfo.textContent = "";
      return;
    }

    // `days` đã gồm lịch sử và forecast (ETL đã nối & sort)
    ALL = Array.isArray(j?.days) ? j.days : [];

    // về trang cuối cùng (gần hiện tại/forecast)
    page = Math.max(0, Math.ceil(ALL.length/PAGE_SIZE)-1);

    // điều hướng
    document.getElementById("prev").onclick = ()=>{ page=Math.max(0,page-1); render(); };
    document.getElementById("next").onclick = ()=>{
      const last = Math.max(0, Math.ceil(ALL.length/PAGE_SIZE)-1);
      page=Math.min(last,page+1); render();
    };

    render();
    // re-draw khi resize để canvas có width/height mới
    window.addEventListener("resize", ()=>render());
  }catch(e){
    grid.innerHTML = `<div class="card"><pre>${String(e)}</pre></div>`;
  }
}

function render(){
  const grid = document.getElementById("grid");
  const pageInfo = document.getElementById("pageInfo");

  const last = Math.max(0, Math.ceil(ALL.length/PAGE_SIZE)-1);
  const start = page*PAGE_SIZE;
  const slice = ALL.slice(start, start+PAGE_SIZE);

  grid.innerHTML = "";
  pageInfo.textContent = `Trang ${page+1} / ${last+1} • Tổng ngày: ${ALL.length}`;

  slice.forEach(d=>{
    const card = document.createElement("div");
    card.className = "card";

    // header ngày
    const wd = wdNameShort(d.vietnam_date);
    const title = document.createElement("div");
    title.className = `title day-${wd.toLowerCase()} ${/Sun|Sat/.test(wd)?"is-weekend":"is-weekday"}`;
    title.innerHTML = `
      <span class="wd">${wd}</span>
      <span class="greg">${d.vietnam_date}</span>
      <span class="lunar">${d.lunar_date}</span>
      ${d.is_forecast?'<span class="forecast-tag">Forecast</span>':''}
    `;
    card.appendChild(title);

    // TIDE
    const wrap1 = document.createElement("div"); wrap1.className="canvas-wrap tide";
    const cv1 = document.createElement("canvas"); wrap1.appendChild(cv1);
    card.appendChild(wrap1);

    // dữ liệu tidal: nhận nhiều key cho chắc
    const tdata = Array.isArray(d.tidal_data) ? d.tidal_data : (d["Tidal Data"]||[]);
    const tidePts = (tdata||[])
      .map(x=>{
        const t = x.time || x.timestamp || x.t || x.dateTime || x.datetime;
        const h = x.height ?? x.h;
        return { x:new Date(t), y:num(h), label: toHM(t) };
      })
      .filter(p=>p.y!==null)
      .sort((a,b)=>a.x-b.x);
    drawLine(cv1, tidePts, {stroke:"#79c0ff"});

    // PRESSURE
    const wrap2 = document.createElement("div"); wrap2.className="canvas-wrap pressure";
    const cv2 = document.createElement("canvas"); wrap2.appendChild(cv2);
    card.appendChild(wrap2);

    const pdata = Array.isArray(d.pressure_data) ? d.pressure_data : (d["Pressure Data"]||[]);
    const presPts = (pdata||[])
      .map(x=>{
        const t = x.time || x.timestamp || x.t || x.dateTime || x.datetime;
        const v = x.pressure ?? x.p;
        return { x:new Date(t), y:num(v), label: toHM(t) };
      })
      .filter(p=>p.y!==null)
      .sort((a,b)=>a.x-b.x);
    drawLine(cv2, presPts, {stroke:"#d2a8ff"});

    grid.appendChild(card);
  });
}
