// ===== Login hard-code (đổi tùy ý) =====
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

// ===== Helper ngày/giờ =====
function parseDateSmart(s) {
  if (!s || typeof s !== "string") return new Date(NaN);
  if (s.includes("/")) {
    // dd/MM/yyyy
    const [d, m, y] = s.split("/").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  // yyyy-MM-dd
  if (s.includes("-")) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  return new Date(s);
}
function weekdayVi(d) {
  return ["CN", "Th 2", "Th 3", "Th 4", "Th 5", "Th 6", "Th 7"][d.getDay()];
}
function fmtDisplay(d) {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${weekdayVi(d)} • ${dd}/${mm}/${yyyy}`;
}
function localHourDecimal(iso) {
  const t = new Date(iso);
  return t.getHours() + t.getMinutes() / 60;
}

// ===== Pagination =====
let data = [];
let page = 0;
const PAGE_SIZE = 4;

// ====== Khởi tạo và tải dữ liệu ======
async function init() {
  const grid = document.getElementById("grid");
  const pageInfo = document.getElementById("pageInfo");

  try {
    const resp = await fetch("./data.json", { cache: "no-store" });
    if (!resp.ok) throw new Error(`Không tải được data.json (HTTP ${resp.status})`);
    const json = await resp.json();

    // 1) Nếu ETL ghi lỗi
    if (json && json.error) {
      pageInfo.textContent = "";
      grid.innerHTML = `
        <div class="card" style="border-left:6px solid #d33;">
          <h3 style="margin:0">Có lỗi khi cập nhật dữ liệu</h3>
          <div class="meta">${json.error}</div>
          <div class="meta">Mở <a href="./data.json" target="_blank">data.json</a> để xem chi tiết.</div>
        </div>`;
      return;
    }

    // 2) Hỗ trợ nhiều dạng JSON: {days:[...]}, {data:[...]}, hoặc mảng trực tiếp
    let days = [];
    if (Array.isArray(json)) days = json;
    else if (json && Array.isArray(json.days)) days = json.days;
    else if (json && Array.isArray(json.data)) days = json.data;

    if (!Array.isArray(days) || days.length === 0) {
      pageInfo.textContent = "";
      grid.innerHTML = `
        <div class="card" style="border-left:6px solid #999;">
          <h3 style="margin:0">Chưa đọc được dữ liệu</h3>
          <div class="meta">Kiểm tra cấu trúc <a href="./data.json" target="_blank">data.json</a>. 
          Hệ thống mong đợi mảng ngày hoặc {days:[...]}</div>
        </div>`;
      return;
    }

    // 3) Chuẩn hóa tên field cho từng bản ghi
    data = days.map((it) => ({
      vietnam_date: it.vietnam_date || it["Vietnam Date"] || it.date || "",
      lunar_date: it.lunar_date || it["Lunar Date"] || "",
      tidal_data: it.tidal_data || it["Tidal Data"] || it.tide || it.tides || [],
      pressure_data: it.pressure_data || it["Pressure Data"] || it.pressureSeries || it.pressure || [],
      fish_caught: it.fish_caught || it["Fish Caught"] || "",
      user_score: it.user_score || it["User Fishing Score"] || it.score || "",
      user_notes: it.user_notes || it["User Notes"] || ""
    }));

    pageInfo.textContent = `Trang ${page + 1} / ${Math.max(1, Math.ceil(data.length / PAGE_SIZE))} • Tổng ngày: ${data.length}`;
    render();

    document.getElementById("prev").onclick = () => {
      page = Math.max(0, page - 1);
      render();
    };
    document.getElementById("next").onclick = () => {
      const maxPage = Math.max(0, Math.ceil(data.length / PAGE_SIZE) - 1);
      page = Math.min(maxPage, page + 1);
      render();
    };
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

// ====== Render trang ======
function render() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  const start = page * PAGE_SIZE;
  const items = data.slice(start, start + PAGE_SIZE);
  document.getElementById("pageInfo").textContent = `Trang ${page + 1} / ${Math.max(1, Math.ceil(data.length / PAGE_SIZE))} • Tổng ngày: ${data.length}`;

  for (const it of items) {
    const d = parseDateSmart(it.vietnam_date);
    const card = document.createElement("div");
    card.className = "card";

    const h = document.createElement("h3");
    h.textContent = fmtDisplay(d) + (it.lunar_date ? ` • ÂL ${it.lunar_date}` : "");
    card.appendChild(h);

    const meta = document.createElement("div");
    meta.className = "meta";
    const score = it.user_score ? `Score: ${it.user_score}` : "Score: -";
    const fish = it.fish_caught ? `Fish: ${it.fish_caught}` : "Fish: -";
    meta.textContent = `${score} • ${fish}`;
    card.appendChild(meta);

    const canvas = document.createElement("canvas");
    canvas.height = 140;
    card.appendChild(canvas);

    const tide = (it.tidal_data || []).slice().sort((a, b) => new Date(a.time) - new Date(b.time));
    const points = tide.map((p) => ({ x: localHourDecimal(p.time), y: p.height, t: p.type || "" }));

    const ctx = canvas.getContext("2d");
    new Chart(ctx, {
      type: "line",
      data: {
        datasets: [{
          label: "Tide (m)",
          data: points,
          parsing: false,
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: 24,
            ticks: { stepSize: 3, callback: (v) => `${v}:00` }
          },
          y: { beginAtZero: false }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => (items.length ? `${items[0].parsed.x.toFixed(2)}h` : ""),
              label: (ctx) => {
                const t = points[ctx.dataIndex]?.t ?? "";
                const v = ctx.parsed.y;
                return `${t ? t + " • " : ""}${v?.toFixed(2)} m`;
              }
            }
          }
        }
      }
    });

    const presBox = document.createElement("div");
    presBox.className = "pressure";
    const lines = (it.pressure_data || [])
      .slice()
      .sort((a, b) => new Date(a.time) - new Date(b.time))
      .map((p) => {
        const t = new Date(p.time);
        const hh = String(t.getHours()).padStart(2, "0");
        const mm = String(t.getMinutes()).padStart(2, "0");
        return `${hh}:${mm} → ${p.pressure}`;
      });
    presBox.textContent = lines.length ? lines.join("\n") : "(không có dữ liệu áp suất)";
    card.appendChild(presBox);

    grid.appendChild(card);
  }
}
