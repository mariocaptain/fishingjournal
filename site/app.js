// ===== Simple Login (demo) =====
const VALID_USER = "danang";
const VALID_PASS = "lap-an-123";

const loginBox = document.getElementById("login");
const appBox = document.getElementById("app");
document.getElementById("btnLogin").onclick = () => {
  const u = document.getElementById("user").value.trim();
  const p = document.getElementById("pass").value;
  if (u === VALID_USER && p === VALID_PASS) {
    loginBox.classList.add("hidden");
    appBox.classList.remove("hidden");
    init();
  } else {
    alert("Sai thông tin!");
  }
};

// ===== Paging & chart sizes =====
let data = [];
let page = 0;
const PAGE_SIZE = 10;              // 2 cột x 5 hàng
const TIDE_CHART_HEIGHT = 150;     // yêu cầu mới
const PRESSURE_CHART_HEIGHT = 120; // yêu cầu mới
const charts = new Map();          // date -> Chart instance

// ===== Init =====
async function init() {
  const grid = document.getElementById("grid");
  const pageInfo = document.getElementById("pageInfo");

  try {
    const resp = await fetch("./data.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`Không tải được data.json (HTTP ${resp.status})`);
    const json = await resp.json();

    if (json && json.error) {
      pageInfo.textContent = "";
      grid.innerHTML = `
        <div class="card"><pre style="white-space:pre-wrap">${json.error}</pre></div>`;
      return;
    }

    const days = Array.isArray(json?.days) ? json.days : [];
    const forecast = Array.isArray(json?.forecast) ? json.forecast : [];

    // Chuẩn hoá dữ liệu hiển thị
    data = [...days, ...forecast].map((it) => ({
      vietnam_date: it.vietnam_date || it["Vietnam Date"] || it.date || "",
      lunar_date: it.lunar_date || it["Lunar Date"] || "",
      tidal_data: it.tidal_data || it["Tidal Data"] || it.tide || it.tides || [],
      pressure_data: it.pressure_data || it["Pressure Data"] || it.pressureSeries || it.pressure || [],
      is_forecast: !!it.is_forecast
    }));

    // Mặc định nhảy tới trang cuối (gần hiện tại)
    const lastPage = Math.max(0, Math.ceil(data.length / PAGE_SIZE) - 1);
    page = lastPage;

    render();
    document.getElementById("prev").onclick = () => { page = Math.max(0, page - 1); render(); };
    document.getElementById("next").onclick = () => {
      const maxPage = Math.max(0, Math.ceil(data.length/PAGE_SIZE)-1);
      page = Math.min(maxPage, page + 1); render();
    };

    // Nút Last (tiện nhảy tới forecast mới nhất)
    if (!document.getElementById("btnLast")) {
      const btn = document.createElement("button");
      btn.id = "btnLast"; btn.textContent = "Last";
      btn.onclick = () => { page = Math.max(0, Math.ceil(data.length/PAGE_SIZE)-1); render(); };
      document.querySelector("header div").appendChild(btn);
    }

  } catch (e) {
    grid.innerHTML = `<div class="card"><pre>${String(e)}</pre></div>`;
  }
}

function weekdayName(dstr) {
  // dstr: dd/MM/yyyy
  const [dd,MM,yyyy] = dstr.split("/").map(Number);
  const d = new Date(yyyy, MM-1, dd);
  const names = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return names[d.getDay()];
}

function render() {
  const grid = document.getElementById("grid");
  const pageInfo = document.getElementById("pageInfo");
  // clean old charts
  charts.forEach(ch => ch?.destroy?.());
  charts.clear();

  const start = page * PAGE_SIZE;
  const slice = data.slice(start, start + PAGE_SIZE);

  grid.innerHTML = "";
  pageInfo.textContent = `Trang ${page+1} / ${Math.max(1, Math.ceil(data.length/PAGE_SIZE))} • Tổng ngày: ${data.length}`;

  for (const it of slice) {
    const card = document.createElement("div");
    card.className = "card";

    const wname = weekdayName(it.vietnam_date);
    const h3 = document.createElement("h3");
    h3.className = `title day-${wname.toLowerCase()} ${/Sunday|Saturday/.test(wname) ? "is-weekend" : ""}`;
    h3.textContent = `${wname} • ${it.vietnam_date} • Âm lịch: ${it.lunar_date}${it.is_forecast ? " • Forecast" : ""}`;
    card.appendChild(h3);

    // --- TIDE CHART ---
    const wrap1 = document.createElement("div");
    wrap1.className = "canvas-wrap tide";
    const cv1 = document.createElement("canvas");
    cv1.height = TIDE_CHART_HEIGHT;
    wrap1.appendChild(cv1);
    card.appendChild(wrap1);

    const points = (it.tidal_data || [])
      .map(x => ({ t: x.time, h: Number(x.height), type: x.type }))
      .filter(x => Number.isFinite(x.h))
      .map(x => ({ x: new Date(x.t), y: x.h, t: new Date(x.t).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) }));

    const tideChart = new Chart(cv1.getContext("2d"), {
      type: "line",
      data: {
        datasets: [{
          data: points, pointRadius: 2, tension: 0.35
        }]
      },
      options: {
        responsive: true,
        parsing: false,
        maintainAspectRatio: false,
        scales: {
          x: { type: "time", time: { unit: "hour" }, ticks: { color: "#9cdcfe" } },   // horizontal axis labels color
          y: { ticks: { color: "#ce9178" } }                                          // vertical axis labels color
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items)=> items.length? `${items[0].parsed.x.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}` : "",
              label: (ctx)=> `${(ctx.parsed.y ?? 0).toFixed(2)} m`
            }
          }
        }
      }
    });
    charts.set(it.vietnam_date+"_tide", tideChart);

    // --- PRESSURE CHART (120px) ---
    const wrap2 = document.createElement("div");
    wrap2.className = "canvas-wrap pressure";
    const cv2 = document.createElement("canvas");
    cv2.height = PRESSURE_CHART_HEIGHT;
    wrap2.appendChild(cv2);
    card.appendChild(wrap2);

    const presPts = (it.pressure_data || [])
      .slice()
      .sort((a,b) => new Date(a.time) - new Date(b.time))
      .map(p => ({ x: new Date(p.time), y: Number(p.pressure) }))
      .filter(p => Number.isFinite(p.y));

    const presChart = new Chart(cv2.getContext("2d"), {
      type: "line",
      data: { datasets: [{ data: presPts, pointRadius: 0, tension: 0.2 }] },
      options: {
        responsive: true,
        parsing: false,
        maintainAspectRatio: false,
        scales: {
          x: { type: "time", time: { unit: "hour" }, ticks: { color: "#9cdcfe" } },
          y: { ticks: { color: "#ce9178" } }
        },
        plugins: { legend: { display: false } }
      }
    });
    charts.set(it.vietnam_date+"_press", presChart);

    grid.appendChild(card);
  }
}
