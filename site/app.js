/* ===== Login bootstrap ===== */
(function () {
  function onLoginClick(e) {
    e.preventDefault();
    const u = document.getElementById("user")?.value?.trim() ?? "";
    const p = document.getElementById("pass")?.value ?? "";
    if (u === "danang" && p === "lap-an-123") {
      document.getElementById("login")?.classList.add("hidden");
      document.getElementById("app")?.classList.remove("hidden");
      init();
    } else {
      alert("Sai thông tin!");
    }
  }
  const wire = () => document.getElementById("btnLogin")?.addEventListener("click", onLoginClick);
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", wire) : wire();
})();

/* ===== Globals ===== */
const PAGE_SIZE = 10; // 2 cột x 5 hàng
let ALL = [];
let page = 0;
const charts = new Map();

/* ===== Utils ===== */
function wdShort(dstr) {
  const [dd,MM,yyyy] = dstr.split("/").map(Number);
  const d = new Date(yyyy,MM-1,dd);
  return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
}
function toHM(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
}
const num = v => (Number.isFinite(+v) ? +v : null);

/* ===== Init ===== */
async function init(){
  const grid = document.getElementById("grid");
  const pageInfo = document.getElementById("pageInfo");
  try{
    const r = await fetch("./data.json", {cache:"no-store"});
    const j = await r.json();
    if (j?.error) {
      grid.innerHTML = `<div class="card"><pre>${j.error}</pre></div>`;
      pageInfo.textContent = "";
      return;
    }

    // JSON đã được ETL khử trùng lặp ngày.
    ALL = Array.isArray(j?.days) ? j.days : [];

    // về trang cuối
    page = Math.max(0, Math.ceil(ALL.length/PAGE_SIZE)-1);

    document.getElementById("prev").onclick = ()=>{ page=Math.max(0,page-1); render(); };
    document.getElementById("next").onclick = ()=>{ page=Math.min(Math.max(0,Math.ceil(ALL.length/PAGE_SIZE)-1),page+1); render(); };

    render();
    window.addEventListener("resize", () => render());
  }catch(e){
    grid.innerHTML = `<div class="card"><pre>${String(e)}</pre></div>`;
  }
}

/* ===== Render page ===== */
function render(){
  const grid = document.getElementById("grid");
  const pageInfo = document.getElementById("pageInfo");
  const last = Math.max(0, Math.ceil(ALL.length/PAGE_SIZE)-1);
  const start = page*PAGE_SIZE;
  const slice = ALL.slice(start, start+PAGE_SIZE);

  // destroy old charts
  charts.forEach(c=>{ try{ c.destroy(); }catch{} });
  charts.clear();

  grid.innerHTML = "";
  pageInfo.textContent = `Trang ${page+1} / ${last+1} • Tổng ngày: ${ALL.length}`;

  slice.forEach(d => {
    const card = document.createElement("div"); card.className = "card";

    const wd = wdShort(d.vietnam_date);
    const title = document.createElement("div");
    title.className = `title day-${wd.toLowerCase()} ${/Sun|Sat/.test(wd)?"is-weekend":"is-weekday"}`;
    title.innerHTML = `
      <span class="wd">${wd}</span>
      <span class="greg">${d.vietnam_date}</span>
      <span class="lunar">${d.lunar_date}</span>
      ${d.is_forecast ? '<span class="forecast-tag">Forecast</span>' : ''}
    `;
    card.appendChild(title);

    // TIDE chart (Chart.js)
    const wrap1 = document.createElement("div"); wrap1.className = "canvas-wrap";
    const cv1 = document.createElement("canvas"); wrap1.appendChild(cv1);
    card.appendChild(wrap1);

    const tdata = Array.isArray(d.tidal_data) ? d.tidal_data : (d["Tidal Data"]||[]);
    const tidePts = (tdata||[])
      .map(x => ({ x: new Date(x.time), y: num(x.height), _type: x.type }))
      .filter(p=>p.y!==null).sort((a,b)=>a.x-b.x);

    const tideChart = new Chart(cv1.getContext("2d"), {
      type: "line",
      data: { datasets: [{ data: tidePts, borderWidth: 2, pointRadius: 2, tension: 0.3 }] },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: "time", time: { unit: "hour" }, ticks: { color: "#9cdcfe" } },
          y: {
            ticks: { color: "#ce9178" },
            // tránh “zoom quá sát”: gợi ý biên độ tối thiểu 1m
            suggestedMin: (()=>{ const ys=tidePts.map(p=>p.y); if(!ys.length) return 0; const mn=Math.min(...ys), mx=Math.max(...ys); const span=Math.max(1, mx-mn); return (mn+mx)/2 - span/2; })(),
            suggestedMax: (()=>{ const ys=tidePts.map(p=>p.y); if(!ys.length) return 1; const mn=Math.min(...ys), mx=Math.max(...ys); const span=Math.max(1, mx-mn); return (mn+mx)/2 + span/2; })(),
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items)=> items.length? toHM(items[0].raw.x) : "",
              label: (ctx)=> {
                const t = ctx.raw?._type ? ctx.raw._type + " • " : "";
                return `${t}${(ctx.parsed.y??0).toFixed(2)} m`;
              }
            }
          }
        }
      }
    });
    charts.set(d.vietnam_date+"_tide", tideChart);

    // PRESSURE chart
    const wrap2 = document.createElement("div"); wrap2.className = "canvas-wrap";
    const cv2 = document.createElement("canvas"); wrap2.appendChild(cv2);
    card.appendChild(wrap2);

    const pdata = Array.isArray(d.pressure_data) ? d.pressure_data : (d["Pressure Data"]||[]);
    const presPts = (pdata||[])
      .map(x=>({ x: new Date(x.time), y: num(x.pressure) }))
      .filter(p=>p.y!==null).sort((a,b)=>a.x-b.x);

    const presChart = new Chart(cv2.getContext("2d"), {
      type: "line",
      data: { datasets: [{ data: presPts, borderWidth: 2, pointRadius: 0, tension: 0.2 }] },
      options: {
        animation: false, responsive: true, maintainAspectRatio: false,
        scales: {
          x: { type: "time", time: { unit: "hour" }, ticks: { color: "#9cdcfe" } },
          y: {
            ticks: { color: "#ce9178" },
            // biên độ tối thiểu ~3 hPa
            suggestedMin: (()=>{ const ys=presPts.map(p=>p.y); if(!ys.length) return 1000; const mn=Math.min(...ys), mx=Math.max(...ys); const span=Math.max(3, mx-mn); return (mn+mx)/2 - span/2; })(),
            suggestedMax: (()=>{ const ys=presPts.map(p=>p.y); if(!ys.length) return 1010; const mn=Math.min(...ys), mx=Math.max(...ys); const span=Math.max(3, mx-mn); return (mn+mx)/2 + span/2; })(),
          }
        },
        plugins: { legend: { display: false } }
      }
    });
    charts.set(d.vietnam_date+"_press", presChart);

    // Hydro info
    const mean = { sea_level:0.74, water_temperature:27.16, wind_speed:3.48, wave_height:1.11 };
    const hydro = document.createElement("div"); hydro.className = "hydro";
    const sl  = d.sea_level, wt = d.water_temperature, ws = d.wind_speed, wd = d.wind_direction, wh = d.wave_height;
    hydro.innerHTML = `
      <span class="sea">Sea Level: ${isFinite(sl)?sl.toFixed(2)+"m":"—"} <span class="mean"># ${mean.sea_level.toFixed(2)}m</span></span>
      <span class="temp">Water Temp: ${isFinite(wt)?wt.toFixed(2)+"°C":"—"} <span class="mean"># ${mean.water_temperature.toFixed(2)}°C</span></span>
      <span class="ws">Wind Speed: ${isFinite(ws)?ws.toFixed(2)+" m/s":"—"} <span class="mean"># ${mean.wind_speed.toFixed(2)} m/s</span></span>
      <span class="wd">Wind Dir: ${isFinite(wd)?wd.toFixed(0)+"°":"—"}</span>
      <span class="wave">Wave: ${isFinite(wh)?wh.toFixed(2)+"m":"—"} <span class="mean"># ${mean.wave_height.toFixed(2)}m</span></span>
    `;
    card.appendChild(hydro);

    grid.appendChild(card);
  });
}
