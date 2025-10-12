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

// ===== Helper ngày/giờ =====
function parseDDMMYYYY(s) {
  const [d,m,y] = s.split("/").map(Number);
  return new Date(y, m-1, d);
}
function weekdayVi(d) {
  return ["CN","Th 2","Th 3","Th 4","Th 5","Th 6","Th 7"][d.getDay()];
}
function fmtDisplay(d) {
  const dd = String(d.getDate()).padStart(2,"0");
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const yyyy = d.getFullYear();
  return `${weekdayVi(d)} • ${dd}/${mm}/${yyyy}`;
}
function localHourDecimal(iso) {
  const t = new Date(iso);
  return t.getHours() + t.getMinutes()/60;
}

// ===== Pagination =====
let data = [];
let page = 0;
const PAGE_SIZE = 4;

async function init() {
  const resp = await fetch("./data.json", {cache:"no-store"});
  const json = await resp.json();

  // Nếu cron/ETL lỗi → hiển thị banner lỗi
  if (json.error) {
    const grid = document.getElementById("grid");
    document.getElementById("pageInfo").textContent = "";
    grid.innerHTML = `
      <div class="card" style="border-left:6px solid #d33;">
        <h3 style="margin:0">Có lỗi khi cập nhật dữ liệu</h3>
        <div class="meta">${json.error}</div>
        <div class="meta">Thường là do vượt quota API. Hệ thống sẽ tự thử lại với key dự phòng vào lần chạy kế tiếp.</div>
      </div>
    `;
    return;
  }

  data = json.days || [];
  render();
  document.getElementById("prev").onclick = () => { page=Math.max(0,page-1); render(); };
  document.getElementById("next").onclick = () => {
    const maxPage = Math.max(0, Math.ceil(data.length/PAGE_SIZE)-1);
    page=Math.min(maxPage,page+1); render();
  };
}

function render() {
  const grid = document.getElementById("grid");
  grid.innerHTML = "";
  const start = page*PAGE_SIZE;
  const items = data.slice(start, start+PAGE_SIZE);
  document.getElementById("pageInfo").textContent = `Trang ${page+1} / ${Math.max(1, Math.ceil(data.length/PAGE_SIZE))}`;

  for (const it of items) {
    const d = parseDDMMYYYY(it.vietnam_date);
    const card = document.createElement("div");
    card.className = "card";

    const h = document.createElement("h3");
    h.textContent = fmtDisplay(d) + (it.lunar_date ? ` • ÂL ${it.lunar_date}` : "");
    card.appendChild(h);

    const meta = document.createElement("div");
    meta.className = "meta";
    const score = it.user_score ? `Score: ${it.user_score}` : "Score: -";
    const fish  = it.fish_caught ? `Fish: ${it.fish_caught}` : "Fish: -";
    meta.textContent = `${score} • ${fish}`;
    card.appendChild(meta);

    const canvas = document.createElement("canvas");
    canvas.height = 140;
    card.appendChild(canvas);

    const tide = (it.tidal_data || []).slice().sort((a,b) => new Date(a.time) - new Date(b.time));
    const points = tide.map(p => ({ x: localHourDecimal(p.time), y: p.height, t: p.type || "" }));

    const ctx = canvas.getContext("2d");
    new Chart(ctx, {
      type: "line",
      data: { datasets: [{ label: "Tide (m)", data: points, parsing:false, borderWidth:2, pointRadius:3, tension:0.3 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
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
                return `${t? t+" • " : ""}${v?.toFixed(2)} m`;
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
      .sort((a,b) => new Date(a.time) - new Date(b.time))
      .map(p => {
        const t = new Date(p.time);
        const hh = String(t.getHours()).padStart(2,"0");
        const mm = String(t.getMinutes()).padStart(2,"0");
        return `${hh}:${mm} → ${p.pressure}`;
      });
    presBox.textContent = lines.length ? lines.join("\n") : "(không có dữ liệu áp suất)";
    card.appendChild(presBox);

    document.getElementById("grid").appendChild(card);
  }
}
