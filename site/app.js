// ===== Login hard-code =====
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

// ===== Helpers =====
function parseDateSmart(s) {
  if (!s || typeof s !== "string") return new Date(NaN);
  if (s.includes("/")) { const [d,m,y] = s.split("/").map(Number); return new Date(y, (m||1)-1, d||1); }
  if (s.includes("-")) { const [y,m,d] = s.split("-").map(Number); return new Date(y, (m||1)-1, d||1); }
  return new Date(s);
}
function weekdayVi(d) { return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][d.getDay()]; }
function fmtDisplay(d) {
  const dd=String(d.getDate()).padStart(2,"0"), mm=String(d.getMonth()+1).padStart(2,"0"), yyyy=d.getFullYear();
  return `${weekdayVi(d)} • ${dd}/${mm}/${yyyy}`;
}
function localHourDecimal(iso) { const t = new Date(iso); return t.getHours() + t.getMinutes()/60; }

// ===== Pagination & state =====
let data = [];
let page = 0;
const PAGE_SIZE = 4;
const CHART_HEIGHT = 120;
const charts = new Map(); // key: date -> Chart instance

// ===== LocalStorage for edits =====
const LS_KEY = "fj_overrides"; // { "dd/MM/yyyy": { user_score, fish_caught } }
function loadOverrides(){ try{ return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }catch{ return {}; } }
function saveOverrides(obj){ localStorage.setItem(LS_KEY, JSON.stringify(obj)); }
function applyOverrides(item){
  const ov = loadOverrides()[item.vietnam_date];
  if (!ov) return item;
  return {...item,
    user_score: ov.user_score ?? item.user_score,
    fish_caught: ov.fish_caught ?? item.fish_caught
  };
}

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
        <div class="card" style="border-left:6px solid #d33;">
          <h3 style="margin:0">Có lỗi khi cập nhật dữ liệu</h3>
          <div class="meta" style="white-space:pre-wrap">${json.error}</div>
          <div class="meta">Mở <a href="./data.json" target="_blank">data.json</a> để xem chi tiết.</div>
        </div>`;
      return;
    }

    let days = [];
    if (Array.isArray(json)) days = json;
    else if (json && Array.isArray(json.days)) days = json.days;
    else if (json && Array.isArray(json.data)) days = json.data;

    if (!Array.isArray(days) || days.length === 0) {
      pageInfo.textContent = "";
      grid.innerHTML = `
        <div class="card" style="border-left:6px solid #999;">
          <h3 style="margin:0">Chưa đọc được dữ liệu</h3>
          <div class="meta">Kiểm tra cấu trúc <a href="./data.json" target="_blank">data.json</a>.</div>
        </div>`;
      return;
    }

    // Chuẩn hoá + áp overrides
    data = days.map((it) => ({
      vietnam_date: it.vietnam_date || it["Vietnam Date"] || it.date || "",
      lunar_date: it.lunar_date || it["Lunar Date"] || "",
      tidal_data: it.tidal_data || it["Tidal Data"] || it.tide || it.tides || [],
      pressure_data: it.pressure_data || it["Pressure Data"] || it.pressureSeries || it.pressure || [],
      fish_caught: it.fish_caught || it["Fish Caught"] || "",
      user_score: it.user_score || it["User Fishing Score"] || it.score || "",
      user_notes: it.user_notes || it["User Notes"] || ""
    })).map(applyOverrides);

    // Mặc định nhảy tới trang cuối (gần hiện tại)
    const lastPage = Math.max(0, Math.ceil(data.length / PAGE_SIZE) - 1);
    page = lastPage;

    render();
    document.getElementById("prev").onclick = () => { page = Math.max(0, page - 1); render(); };
    document.getElementById("next").onclick = () => {
      const maxPage = Math.max(0, Math.ceil(data.length/PAGE_SIZE)-1);
      page = Math.min(maxPage, page + 1); render();
    };
    // Nút Last
    if (!document.getElementById("btnLast")) {
      const btn = document.createElement("button");
      btn.id = "btnLast"; btn.textContent = "Last";
      btn.onclick = () => { page = Math.max(0, Math.ceil(data.length/PAGE_SIZE)-1); render(); };
      document.querySelector("header div").appendChild(btn);
    }
  } catch (e) {
    pageInfo.textContent = "";
    grid.innerHTML = `
      <div class="card" style="border-left:6px solid #d33;">
        <h3 style="margin:0">Không thể tải dữ liệu</h3>
        <div class="meta">${String(e)}</div>
        <div class="meta">Kiểm tra <a href="./data.json" target="_blank">data.json</a> (Ctrl+F5 để bỏ cache).</div>
      </div>`;
  }
}

// ===== Render =====
function render() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  const start = page * PAGE_SIZE;
  const items = data.slice(start, start + PAGE_SIZE);
  document.getElementById("pageInfo").textContent =
    `Trang ${page + 1} / ${Math.max(1, Math.ceil(data.length / PAGE_SIZE))} • Tổng ngày: ${data.length}`;

  // Hủy chart cũ (tránh memory leak)
  charts.forEach((ch) => { try { ch.destroy(); } catch {} });
  charts.clear();

  for (const it of items) {
    const d = parseDateSmart(it.vietnam_date);
    const card = document.createElement("div");
    card.className = "card";

    const h = document.createElement("h3");
    h.textContent = fmtDisplay(d) + (it.lunar_date ? ` • Âm Lịch: ${it.lunar_date}` : "");
    card.appendChild(h);

    // Meta + nút Edit
    const meta = document.createElement("div");
    meta.className = "meta";
    const score = it.user_score ? `Score: ${it.user_score}` : "Score: -";
    const fish  = it.fish_caught ? `Fish: ${it.fish_caught}` : "Fish: -";
    meta.textContent = `${score} • ${fish}`;
    card.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "actions";
    const btnEdit = document.createElement("button");
    btnEdit.textContent = "Edit";
    btnEdit.onclick = () => editInline(it.vietnam_date);
    actions.appendChild(btnEdit);
    card.appendChild(actions);

    // Chart tide — cố định chiều cao
    const wrap = document.createElement("div");
    wrap.className = "canvas-wrap";
    const canvas = document.createElement("canvas");
    wrap.appendChild(canvas);
    card.appendChild(wrap);

    const tide = (it.tidal_data || []).slice().sort((a,b) => new Date(a.time) - new Date(b.time));
    const points = tide.map(p => ({ x: localHourDecimal(p.time), y: p.height, t: p.type || "" }));

    const ctx = canvas.getContext("2d");
    const chart = new Chart(ctx, {
      type: "line",
      data: { datasets: [{ label: "Tide (m)", data: points, parsing:false, borderWidth:2, pointRadius:3, tension:0.3 }] },
      options: {
        animation: false, // chống “trôi xuống”
        responsive: false, // ta tự cố định kích thước
        maintainAspectRatio: false,
        scales: {
          x: { type:"linear", min:0, max:24, ticks:{ stepSize: 3, callback:(v)=>`${v}:00` } },
          y: { beginAtZero: false }
        },
        plugins: {
          legend: { display:false },
          tooltip: {
            callbacks: {
              title: (items)=> items.length? `${items[0].parsed.x.toFixed(2)}h` : "",
              label: (ctx)=>{
                const t = points[ctx.dataIndex]?.t ?? "";
                const v = ctx.parsed.y;
                return `${t? t+" • " : ""}${(v ?? 0).toFixed(2)} m`;
              }
            }
          }
        }
      }
    });
    charts.set(it.vietnam_date, chart);

    // Áp suất
    const presBox = document.createElement("div");
    presBox.className = "pressure";
    const lines = (it.pressure_data || [])
      .slice()
      .sort((a,b) => new Date(a.time) - new Date(b.time))
      .map(p => {
        const t = new Date(p.time);
        const hh = String(t.getHours()).padStart(2,"0");
        const mm = String(t.getMinutes()).padStart(2,"0");
        return `${hh}:${mm} → ${p.pressure}`;
      });
    presBox.textContent = lines.length ? lines.join("\n") : "(không có dữ liệu áp suất)";
    card.appendChild(presBox);

    grid.appendChild(card);
  }
}

// ===== Inline edit (LocalStorage) =====
function editInline(dateStr){
  const ov = loadOverrides();
  const cur = ov[dateStr] || {};
  const s = prompt(`Nhập Score cho ${dateStr} (bỏ trống để xoá)`, cur.user_score ?? "");
  if (s === null) return; // cancel
  const f = prompt(`Nhập Fish cho ${dateStr} (bỏ trống để xoá)`, cur.fish_caught ?? "");
  if (f === null) return;

  ov[dateStr] = {
    user_score: (s || "").trim(),
    fish_caught: (f || "").trim()
  };
  // nếu cả hai đều rỗng → xoá override để gọn
  if (!ov[dateStr].user_score && !ov[dateStr].fish_caught) delete ov[dateStr];
  saveOverrides(ov);

  // update data tại chỗ rồi re-render trang hiện tại
  const idx = data.findIndex(x => x.vietnam_date === dateStr);
  if (idx >= 0) {
    data[idx] = applyOverrides(data[idx]);
    render();
  }
}
